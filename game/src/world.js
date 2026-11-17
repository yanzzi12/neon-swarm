// The simulation: NEON SWARM's rules and state, with no drawing and no browser in it.
// The player ship, five enemy kinds, both bullet streams, particles, score popups and
// power-ups all live in pools allocated once at boot. step() advances one fixed step and
// returns what happened as bit flags, so the caller can react (sound, announcements)
// without the world knowing about screens or speakers.

import {
  BANNER_TIME,
  COMBO_MAX_MULT,
  COMBO_PER_TIER,
  COMBO_WINDOW,
  EBULLET,
  FIELD,
  INTERMISSION,
  MAX_ALIVE_BASE,
  MAX_ALIVE_PER_WAVE,
  PLAYER,
  POOLS,
  POWERUP,
  RAPID,
  SHIELD,
} from './config.js';

export const ENEMY_CHASER = 0;
export const ENEMY_WANDERER = 1;
export const ENEMY_SPLITTER = 2;
export const ENEMY_DASHER = 3;
export const ENEMY_MINI = 4;

export const POWER_RAPID = 0;
export const POWER_SHIELD = 1;
export const POWER_HEART = 2;

export const EVENT_SHOT = 1;
export const EVENT_KILL = 2;
export const EVENT_PLAYER_HIT = 4;
export const EVENT_OVER = 8;
export const EVENT_POWERUP = 16;
export const EVENT_WAVE = 32;
export const EVENT_ENEMY_SHOT = 64;
export const EVENT_SHIELD_HIT = 128;

/** Per-kind hull, speed, size and base score. Minis are a splitter's children, never queued. */
const KINDS = [
  { hp: 2, speed: 138, radius: 14, score: 50 }, // chaser
  { hp: 3, speed: 92, radius: 16, score: 100 }, // wanderer (shooter)
  { hp: 5, speed: 62, radius: 23, score: 150 }, // splitter
  { hp: 2, speed: 96, radius: 13, score: 100 }, // dasher
  { hp: 1, speed: 205, radius: 9, score: 25 }, // mini
];

const TAU = Math.PI * 2;

function makePool(size, factory) {
  const pool = [];
  for (let index = 0; index < size; index += 1) pool.push(factory());
  return pool;
}

function freeOf(pool) {
  for (let index = 0; index < pool.length; index += 1) if (!pool[index].active) return pool[index];
  return null;
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function createWorld(random) {
  const player = {
    x: FIELD.width / 2,
    y: FIELD.height / 2,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    hp: PLAYER.hp,
    invulnerable: 0,
    fireTimer: 0,
    rapid: 0,
    shield: 0,
    shieldHits: 0,
    alive: true,
    thrust: 0,
  };
  const bullets = makePool(POOLS.bullets, () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 }));
  const ebullets = makePool(POOLS.ebullets, () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 }));
  const enemies = makePool(POOLS.enemies, () => ({
    active: false, type: 0, x: 0, y: 0, vx: 0, vy: 0, hp: 1, maxHp: 1, radius: 10,
    angle: 0, age: 0, seed: 0, fireTimer: 0, mode: 0, modeTimer: 0, dashVx: 0, dashVy: 0,
    flash: 0, spawnIn: 0,
  }));
  const particles = makePool(POOLS.particles, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2, color: '#ffffff', drag: 2,
  }));
  const popups = makePool(POOLS.popups, () => ({ active: false, x: 0, y: 0, life: 0, maxLife: 1, text: '', color: '#ffffff', size: 18 }));
  const powerups = makePool(POOLS.powerups, () => ({ active: false, type: 0, x: 0, y: 0, age: 0, life: 0 }));
  const stars = [];
  for (let layer = 0; layer < 3; layer += 1) {
    const count = [80, 54, 30][layer];
    for (let index = 0; index < count; index += 1) {
      stars.push({ x: 0, y: 0, layer, size: 1 + layer * 0.8, phase: 0 });
    }
  }

  const state = {
    player, bullets, ebullets, enemies, particles, popups, powerups, stars,
    score: 0, kills: 0, combo: 0, bestCombo: 0, comboTimer: 0, mult: 1,
    wave: 0, phase: 'intermission', phaseTimer: 1.2, spawnQueue: [], spawnTimer: 0,
    elapsed: 0, time: 0, shake: 0, hurtFlash: 0, hurtAngle: 0, lastHitShielded: false,
    bannerText: '', bannerTimer: 0, ambientTimer: 0, over: false,
  };

  function multiplierFor(combo) {
    return Math.min(COMBO_MAX_MULT, 1 + Math.floor(combo / COMBO_PER_TIER));
  }

  function addShake(amount) {
    state.shake = Math.min(17, state.shake + amount);
  }

  function burst(x, y, color, count, speed, size, life) {
    for (let index = 0; index < count; index += 1) {
      const particle = freeOf(particles);
      if (particle === null) return;
      const angle = random() * TAU;
      const velocity = speed * (0.25 + random() * 0.95);
      particle.active = true;
      particle.x = x;
      particle.y = y;
      particle.vx = Math.cos(angle) * velocity;
      particle.vy = Math.sin(angle) * velocity;
      particle.maxLife = life * (0.5 + random() * 0.8);
      particle.life = particle.maxLife;
      particle.size = size * (0.6 + random() * 0.9);
      particle.color = color;
      particle.drag = 2.4;
    }
  }

  function popup(x, y, text, color, size) {
    const item = freeOf(popups);
    if (item === null) return;
    item.active = true;
    item.x = x;
    item.y = y;
    item.maxLife = 0.9;
    item.life = item.maxLife;
    item.text = text;
    item.color = color;
    item.size = size;
  }

  function waveComposition(wave) {
    const queue = [];
    const push = (type, count) => {
      for (let index = 0; index < count; index += 1) queue.push(type);
    };
    push(ENEMY_CHASER, 4 + wave * 2);
    if (wave >= 2) push(ENEMY_WANDERER, 1 + wave);
    if (wave >= 3) push(ENEMY_SPLITTER, 1 + Math.floor(wave / 2));
    if (wave >= 4) push(ENEMY_DASHER, wave - 2);
    // Shuffle with the seeded rng so kinds interleave instead of arriving in blocks.
    for (let index = queue.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      const held = queue[index];
      queue[index] = queue[swap];
      queue[swap] = held;
    }
    return queue;
  }

  function startWave(wave) {
    state.wave = wave;
    state.spawnQueue = waveComposition(wave);
    state.spawnTimer = 0.4;
    state.phase = 'fighting';
    state.bannerText = `WAVE ${wave}`;
    state.bannerTimer = BANNER_TIME;
  }

  function spawnPosition() {
    // On an arena edge, but never within 280 px of the player: nothing materialises on top of you.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const side = Math.floor(random() * 4);
      const x = side === 0 ? 30 : side === 1 ? FIELD.width - 30 : 40 + random() * (FIELD.width - 80);
      const y = side === 2 ? 30 : side === 3 ? FIELD.height - 30 : 40 + random() * (FIELD.height - 80);
      if (dist2(x, y, player.x, player.y) > 280 * 280) return { x, y };
    }
    return { x: FIELD.width / 2, y: 36 };
  }

  function spawnEnemy(type, x, y) {
    const enemy = freeOf(enemies);
    if (enemy === null) return null;
    const kind = KINDS[type];
    const hpBonus = type === ENEMY_MINI ? 0 : Math.floor((state.wave - 1) / 4);
    enemy.active = true;
    enemy.type = type;
    enemy.x = x;
    enemy.y = y;
    enemy.vx = 0;
    enemy.vy = 0;
    enemy.maxHp = kind.hp + hpBonus;
    enemy.hp = enemy.maxHp;
    enemy.radius = kind.radius;
    enemy.angle = random() * TAU;
    enemy.age = 0;
    enemy.seed = random() * 1000;
    enemy.fireTimer = 1 + random() * 1.6;
    enemy.mode = 0;
    enemy.modeTimer = 0;
    enemy.flash = 0;
    enemy.spawnIn = 0.38;
    return enemy;
  }

  function aliveEnemies() {
    let count = 0;
    for (const enemy of enemies) if (enemy.active) count += 1;
    return count;
  }

  function dropPowerup(x, y) {
    const item = freeOf(powerups);
    if (item === null) return;
    let type = random();
    if (type < 0.42) item.type = POWER_RAPID;
    else if (type < 0.78) item.type = POWER_SHIELD;
    else item.type = player.hp < PLAYER.hp ? POWER_HEART : POWER_RAPID;
    item.active = true;
    item.x = x;
    item.y = y;
    item.age = 0;
    item.life = POWERUP.life;
  }

  function killEnemy(enemy, events) {
    enemy.active = false;
    const kind = KINDS[enemy.type];
    burst(enemy.x, enemy.y, enemyColorOf(enemy.type), Math.round(10 + enemy.radius), 260, 3.2, 0.55);
    burst(enemy.x, enemy.y, '#ffffff', 4, 150, 2, 0.3);
    addShake(enemy.type === ENEMY_SPLITTER ? 5 : 2.5);
    state.kills += 1;
    state.combo += 1;
    state.comboTimer = COMBO_WINDOW;
    if (state.combo > state.bestCombo) state.bestCombo = state.combo;
    const before = state.mult;
    state.mult = multiplierFor(state.combo);
    const points = kind.score * state.mult;
    state.score += points;
    popup(enemy.x, enemy.y - enemy.radius - 4, `+${points}`, '#eaf6ff', state.mult >= 4 ? 22 : 17);
    if (state.mult > before) popup(player.x, player.y - 34, `COMBO x${state.mult}`, '#ffe74d', 24);
    if (enemy.type === ENEMY_SPLITTER) {
      for (let index = 0; index < 3; index += 1) {
        const mini = spawnEnemy(ENEMY_MINI, enemy.x, enemy.y);
        if (mini !== null) {
          const angle = (index / 3) * TAU + random() * 0.8;
          mini.vx = Math.cos(angle) * 190;
          mini.vy = Math.sin(angle) * 190;
          mini.spawnIn = 0;
        }
      }
    }
    if (random() < POWERUP.dropChance) dropPowerup(enemy.x, enemy.y);
    return events | EVENT_KILL;
  }

  function damagePlayer(sourceX, sourceY, events) {
    if (player.invulnerable > 0 || !player.alive) return events;
    state.lastHitShielded = false;
    if (player.shield > 0 && player.shieldHits > 0) {
      player.shieldHits -= 1;
      if (player.shieldHits === 0) player.shield = 0;
      player.invulnerable = 0.9;
      state.lastHitShielded = true;
      burst(player.x, player.y, '#57c8ff', 12, 240, 2.6, 0.4);
      popup(player.x, player.y - 30, 'SHIELD HIT', '#57c8ff', 17);
      addShake(4);
      return events | EVENT_SHIELD_HIT;
    }
    player.hp -= 1;
    player.invulnerable = PLAYER.invulnerable;
    state.hurtFlash = 0.4;
    state.hurtAngle = Math.atan2(sourceY - player.y, sourceX - player.x);
    state.combo = 0;
    state.comboTimer = 0;
    state.mult = 1;
    addShake(11);
    burst(player.x, player.y, '#ff2e4d', 16, 280, 3, 0.5);
    popup(player.x, player.y - 30, '-1 HULL', '#ff5e7a', 19);
    if (player.hp <= 0) {
      player.alive = false;
      state.over = true;
      burst(player.x, player.y, '#59f7ff', 60, 380, 3.6, 0.9);
      burst(player.x, player.y, '#ffffff', 24, 240, 2.6, 0.7);
      burst(player.x, player.y, '#ff9f2e', 30, 300, 3, 0.8);
      addShake(17);
      return events | EVENT_PLAYER_HIT | EVENT_OVER;
    }
    return events | EVENT_PLAYER_HIT;
  }

  function fireBullet(angle, speed) {
    const bullet = freeOf(bullets);
    if (bullet === null) return;
    bullet.active = true;
    bullet.x = player.x + Math.cos(angle) * (PLAYER.radius + 6);
    bullet.y = player.y + Math.sin(angle) * (PLAYER.radius + 6);
    bullet.vx = Math.cos(angle) * speed;
    bullet.vy = Math.sin(angle) * speed;
    bullet.life = PLAYER.bulletLife;
    burst(bullet.x, bullet.y, '#aefcff', 1, 40, 1.6, 0.12);
  }

  function fireEnemyBullet(enemy) {
    const bullet = freeOf(ebullets);
    if (bullet === null) return;
    const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
    bullet.active = true;
    bullet.x = enemy.x + Math.cos(angle) * (enemy.radius + 4);
    bullet.y = enemy.y + Math.sin(angle) * (enemy.radius + 4);
    bullet.vx = Math.cos(angle) * EBULLET.speed;
    bullet.vy = Math.sin(angle) * EBULLET.speed;
    bullet.life = EBULLET.life;
  }

  function steer(enemy, targetX, targetY, speed, dt, agility) {
    const angle = Math.atan2(targetY - enemy.y, targetX - enemy.x);
    const blend = Math.min(1, agility * dt);
    enemy.vx += (Math.cos(angle) * speed - enemy.vx) * blend;
    enemy.vy += (Math.sin(angle) * speed - enemy.vy) * blend;
    return angle;
  }

  function stepEnemy(enemy, dt, harmless, events) {
    const kind = KINDS[enemy.type];
    const speedScale = Math.min(1.55, 1 + (state.wave - 1) * 0.055);
    enemy.age += dt;
    if (enemy.flash > 0) enemy.flash = Math.max(0, enemy.flash - dt);
    if (enemy.spawnIn > 0) {
      enemy.spawnIn = Math.max(0, enemy.spawnIn - dt);
      return events;
    }
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distance = Math.hypot(dx, dy) || 1;

    if (harmless) {
      // Title-screen backdrop: drift toward a loose ring around the ship, never touching it.
      const ring = 190 + (enemy.seed % 130);
      const targetX = player.x + Math.cos(enemy.seed + state.time * 0.11) * ring;
      const targetY = player.y + Math.sin(enemy.seed * 1.7 + state.time * 0.09) * ring * 0.72;
      enemy.angle = steer(enemy, targetX, targetY, kind.speed * 0.55, dt, 1.6);
    } else if (enemy.type === ENEMY_CHASER || enemy.type === ENEMY_MINI) {
      enemy.angle = steer(enemy, player.x, player.y, kind.speed * speedScale, dt, 3.2);
    } else if (enemy.type === ENEMY_WANDERER) {
      // Keeps its range and strafes; fires aimed shots on a timer.
      const orbit = Math.sin(enemy.age * 0.7 + enemy.seed) > 0 ? 1 : -1;
      const targetX = player.x + (dx / distance) * -265 + (-dy / distance) * orbit * 120;
      const targetY = player.y + (dy / distance) * -265 + (dx / distance) * orbit * 120;
      enemy.angle = steer(enemy, targetX, targetY, kind.speed * speedScale, dt, 2.2);
      enemy.fireTimer -= dt;
      if (enemy.fireTimer <= 0 && distance < 560 && player.alive) {
        fireEnemyBullet(enemy);
        enemy.fireTimer = 2.1 + random() * 0.9;
        events |= EVENT_ENEMY_SHOT;
      }
    } else if (enemy.type === ENEMY_SPLITTER) {
      enemy.angle = steer(enemy, player.x, player.y, kind.speed * speedScale, dt, 2);
      enemy.angle += Math.sin(enemy.age * 2 + enemy.seed) * 0.2;
    } else if (enemy.type === ENEMY_DASHER) {
      enemy.modeTimer -= dt;
      if (enemy.mode === 0) {
        // Approach until in dash range.
        enemy.angle = steer(enemy, player.x, player.y, kind.speed * speedScale, dt, 2.6);
        if (distance < 330 && enemy.modeTimer <= 0) {
          enemy.mode = 1;
          enemy.modeTimer = 0.55;
        }
      } else if (enemy.mode === 1) {
        // Telegraph: brake, line up on the player, flash.
        enemy.vx *= 1 - Math.min(1, 8 * dt);
        enemy.vy *= 1 - Math.min(1, 8 * dt);
        enemy.angle = Math.atan2(dy, dx);
        if (enemy.modeTimer <= 0) {
          enemy.mode = 2;
          enemy.modeTimer = 0.42;
          enemy.dashVx = Math.cos(enemy.angle) * 660;
          enemy.dashVy = Math.sin(enemy.angle) * 660;
        }
      } else if (enemy.mode === 2) {
        enemy.vx = enemy.dashVx;
        enemy.vy = enemy.dashVy;
        if (enemy.modeTimer <= 0) {
          enemy.mode = 3;
          enemy.modeTimer = 0.9 + random() * 0.5;
        }
      } else {
        enemy.vx *= 1 - Math.min(1, 3.5 * dt);
        enemy.vy *= 1 - Math.min(1, 3.5 * dt);
        if (enemy.modeTimer <= 0) enemy.mode = 0;
      }
    }

    enemy.x += enemy.vx * dt;
    enemy.y += enemy.vy * dt;
    if (enemy.x < enemy.radius) { enemy.x = enemy.radius; enemy.vx = Math.abs(enemy.vx); }
    if (enemy.x > FIELD.width - enemy.radius) { enemy.x = FIELD.width - enemy.radius; enemy.vx = -Math.abs(enemy.vx); }
    if (enemy.y < enemy.radius) { enemy.y = enemy.radius; enemy.vy = Math.abs(enemy.vy); }
    if (enemy.y > FIELD.height - enemy.radius) { enemy.y = FIELD.height - enemy.radius; enemy.vy = -Math.abs(enemy.vy); }

    // Contact: the enemy is destroyed and the hull (or shield) takes the hit.
    if (!harmless && player.alive && player.invulnerable <= 0
      && dist2(enemy.x, enemy.y, player.x, player.y) < (enemy.radius + PLAYER.radius) ** 2) {
      const wasAlive = enemy.active;
      enemy.active = false;
      burst(enemy.x, enemy.y, enemyColorOf(enemy.type), 10, 230, 2.8, 0.45);
      if (wasAlive) events = damagePlayer(enemy.x, enemy.y, events);
    }
    return events;
  }

  function step(dt, input, harmless) {
    let events = 0;
    state.time += dt;
    if (state.shake > 0) state.shake = Math.max(0, state.shake - 34 * dt);
    if (state.hurtFlash > 0) state.hurtFlash = Math.max(0, state.hurtFlash - dt);
    if (state.bannerTimer > 0) state.bannerTimer = Math.max(0, state.bannerTimer - dt);
    if (state.comboTimer > 0) {
      state.comboTimer = Math.max(0, state.comboTimer - dt);
      if (state.comboTimer === 0) {
        state.combo = 0;
        state.mult = 1;
      }
    }

    if (!harmless) {
      state.elapsed += dt;
      // Wave director: spawn the queue, then wait for a clear arena before the next wave.
      if (state.phase === 'intermission') {
        state.phaseTimer -= dt;
        if (state.phaseTimer <= 0) {
          startWave(state.wave + 1);
          events |= EVENT_WAVE;
        }
      } else {
        if (state.spawnQueue.length > 0) {
          state.spawnTimer -= dt;
          const cap = MAX_ALIVE_BASE + state.wave * MAX_ALIVE_PER_WAVE;
          if (state.spawnTimer <= 0 && aliveEnemies() < cap) {
            const position = spawnPosition();
            spawnEnemy(state.spawnQueue.shift(), position.x, position.y);
            state.spawnTimer = Math.max(0.34, 0.85 - state.wave * 0.045);
          }
        } else if (aliveEnemies() === 0 && player.alive) {
          state.phase = 'intermission';
          state.phaseTimer = INTERMISSION;
          popup(FIELD.width / 2, FIELD.height / 2 - 90, 'WAVE CLEAR', '#2bff88', 30);
        }
      }
    } else {
      // Title backdrop: keep a handful of shapes drifting at all times.
      state.ambientTimer -= dt;
      if (state.ambientTimer <= 0 && aliveEnemies() < 7) {
        const position = spawnPosition();
        spawnEnemy(Math.floor(random() * 4), position.x, position.y);
        state.ambientTimer = 0.7;
      }
    }

    // Player.
    if (player.alive) {
      if (harmless) {
        let nearest = null;
        let nearestDist = Infinity;
        for (const enemy of enemies) {
          if (!enemy.active) continue;
          const d = dist2(enemy.x, enemy.y, player.x, player.y);
          if (d < nearestDist) { nearestDist = d; nearest = enemy; }
        }
        if (nearest !== null) {
          const target = Math.atan2(nearest.y - player.y, nearest.x - player.x);
          let delta = target - player.angle;
          while (delta > Math.PI) delta -= TAU;
          while (delta < -Math.PI) delta += TAU;
          player.angle += delta * Math.min(1, 2.4 * dt);
        }
      } else {
        const length = Math.hypot(input.mx, input.my);
        const nx = length > 1 ? input.mx / length : input.mx;
        const ny = length > 1 ? input.my / length : input.my;
        player.vx += nx * PLAYER.accel * dt;
        player.vy += ny * PLAYER.accel * dt;
        const drag = Math.exp(-6.2 * dt);
        if (nx === 0) player.vx *= drag;
        if (ny === 0) player.vy *= drag;
        const speed = Math.hypot(player.vx, player.vy);
        if (speed > PLAYER.speed) {
          player.vx = (player.vx / speed) * PLAYER.speed;
          player.vy = (player.vy / speed) * PLAYER.speed;
        }
        player.x = Math.min(FIELD.width - PLAYER.radius, Math.max(PLAYER.radius, player.x + player.vx * dt));
        player.y = Math.min(FIELD.height - PLAYER.radius, Math.max(PLAYER.radius, player.y + player.vy * dt));
        player.angle = Math.atan2(input.aimY - player.y, input.aimX - player.x);
        player.thrust = length > 0.1 ? 1 : 0;
        if (player.thrust === 1 && random() < 0.5) {
          const exhaust = freeOf(particles);
          if (exhaust !== null) {
            exhaust.active = true;
            exhaust.x = player.x - Math.cos(player.angle) * 0 - player.vx * 0.02 + (random() - 0.5) * 6;
            exhaust.y = player.y - player.vy * 0.02 + (random() - 0.5) * 6;
            exhaust.vx = -player.vx * 0.25 + (random() - 0.5) * 30;
            exhaust.vy = -player.vy * 0.25 + (random() - 0.5) * 30;
            exhaust.maxLife = 0.3;
            exhaust.life = exhaust.maxLife;
            exhaust.size = 2;
            exhaust.color = '#2de2ff';
            exhaust.drag = 1;
          }
        }
        if (player.invulnerable > 0) player.invulnerable = Math.max(0, player.invulnerable - dt);
        if (player.rapid > 0) player.rapid = Math.max(0, player.rapid - dt);
        if (player.shield > 0) {
          player.shield = Math.max(0, player.shield - dt);
          if (player.shield === 0) player.shieldHits = 0;
        }
        player.fireTimer -= dt;
        if (input.fire && player.fireTimer <= 0) {
          const rapid = player.rapid > 0;
          fireBullet(player.angle + (rapid ? (random() - 0.5) * 0.05 : 0), rapid ? RAPID.bulletSpeed : PLAYER.bulletSpeed);
          player.fireTimer = rapid ? RAPID.fireInterval : PLAYER.fireInterval;
          events |= EVENT_SHOT;
        }
      }
    }

    // Enemies.
    for (const enemy of enemies) {
      if (enemy.active) events = stepEnemy(enemy, dt, harmless, events);
    }

    // Player bullets vs enemies.
    for (const bullet of bullets) {
      if (!bullet.active) continue;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.life -= dt;
      if (bullet.life <= 0 || bullet.x < -20 || bullet.x > FIELD.width + 20 || bullet.y < -20 || bullet.y > FIELD.height + 20) {
        bullet.active = false;
        continue;
      }
      if (harmless) continue;
      for (const enemy of enemies) {
        if (!enemy.active || enemy.spawnIn > 0) continue;
        if (dist2(bullet.x, bullet.y, enemy.x, enemy.y) < (enemy.radius + PLAYER.bulletRadius) ** 2) {
          bullet.active = false;
          enemy.hp -= 1;
          enemy.flash = 0.09;
          burst(bullet.x, bullet.y, '#ffffff', 3, 160, 1.8, 0.22);
          if (enemy.hp <= 0) events = killEnemy(enemy, events);
          break;
        }
      }
    }

    // Enemy bullets vs player.
    for (const bullet of ebullets) {
      if (!bullet.active) continue;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.life -= dt;
      if (bullet.life <= 0 || bullet.x < -20 || bullet.x > FIELD.width + 20 || bullet.y < -20 || bullet.y > FIELD.height + 20) {
        bullet.active = false;
        continue;
      }
      if (!harmless && player.alive && player.invulnerable <= 0
        && dist2(bullet.x, bullet.y, player.x, player.y) < (EBULLET.radius + PLAYER.radius) ** 2) {
        bullet.active = false;
        events = damagePlayer(bullet.x, bullet.y, events);
      }
    }

    // Power-ups drift, expire, and are collected on touch.
    for (const item of powerups) {
      if (!item.active) continue;
      item.age += dt;
      item.life -= dt;
      item.y += POWERUP.drift * dt;
      if (item.life <= 0 || item.y > FIELD.height + 24) {
        item.active = false;
        continue;
      }
      if (!harmless && player.alive
        && dist2(item.x, item.y, player.x, player.y) < (POWERUP.radius + PLAYER.radius + 6) ** 2) {
        item.active = false;
        if (item.type === POWER_RAPID) {
          player.rapid = RAPID.duration;
          popup(player.x, player.y - 30, 'RAPID FIRE', '#ffe74d', 20);
        } else if (item.type === POWER_SHIELD) {
          player.shield = SHIELD.duration;
          player.shieldHits = SHIELD.hits;
          popup(player.x, player.y - 30, 'SHIELD UP', '#57c8ff', 20);
        } else {
          player.hp = Math.min(PLAYER.hp, player.hp + 1);
          popup(player.x, player.y - 30, '+1 HULL', '#ff5e7a', 20);
        }
        burst(item.x, item.y, '#ffffff', 10, 170, 2.2, 0.35);
        events |= EVENT_POWERUP;
      }
    }

    // Particles and popups just age.
    for (const particle of particles) {
      if (!particle.active) continue;
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.active = false;
        continue;
      }
      const drag = Math.max(0, 1 - particle.drag * dt);
      particle.vx *= drag;
      particle.vy *= drag;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }
    for (const item of popups) {
      if (!item.active) continue;
      item.life -= dt;
      if (item.life <= 0) {
        item.active = false;
        continue;
      }
      item.y -= 42 * dt;
    }
    return events;
  }

  function reset() {
    player.x = FIELD.width / 2;
    player.y = FIELD.height / 2;
    player.vx = 0;
    player.vy = 0;
    player.angle = -Math.PI / 2;
    player.hp = PLAYER.hp;
    player.invulnerable = 0;
    player.fireTimer = 0;
    player.rapid = 0;
    player.shield = 0;
    player.shieldHits = 0;
    player.alive = true;
    player.thrust = 0;
    for (const pool of [bullets, ebullets, enemies, particles, popups, powerups]) {
      for (const item of pool) item.active = false;
    }
    for (const star of stars) {
      star.x = random() * FIELD.width;
      star.y = random() * FIELD.height;
      star.phase = random() * TAU;
    }
    state.score = 0;
    state.kills = 0;
    state.combo = 0;
    state.bestCombo = 0;
    state.comboTimer = 0;
    state.mult = 1;
    state.wave = 0;
    state.phase = 'intermission';
    state.phaseTimer = 1.1;
    state.spawnQueue = [];
    state.spawnTimer = 0;
    state.elapsed = 0;
    state.time = 0;
    state.shake = 0;
    state.hurtFlash = 0;
    state.bannerText = '';
    state.bannerTimer = 0;
    state.ambientTimer = 0;
    state.over = false;
    state.lastHitShielded = false;
  }

  reset();
  return { state, reset, step, burst };
}

/** The neon colour an enemy kind is drawn (and explodes) in; kept beside the world for render. */
export function enemyColorOf(type) {
  return ['#ff3d7e', '#ff9f2e', '#2bff88', '#37b6ff', '#c6ff4d'][type] ?? '#ffffff';
}
