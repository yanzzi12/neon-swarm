// The screenshot scenes behind ?shot=start|play|swarm|over. Each one plays the real rules
// forward from a fresh world for a fixed number of steps, steered by an autopilot that aims
// at the nearest enemy (leading its target) and keeps its distance, so the frame is what a
// real game looks like and the same seed always gives the same frame. The 'over' scene
// plays well for a while, then stops dodging — a pilot who gives up is caught, as anyone is.

import { COMBO_WINDOW, FIELD, STEP } from './config.js';
import { ENEMY_SPLITTER, EVENT_OVER, enemyColorOf } from './world.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 5;
const PLAY_SECONDS = 17;
const SWARM_SECONDS = 46;
const OVER_PLAY_SECONDS = 22;
const OVER_GIVEUP_LIMIT = 75;

function nearestEnemy(state) {
  let nearest = null;
  let nearestDist = Infinity;
  for (const enemy of state.enemies) {
    if (!enemy.active || enemy.spawnIn > 0) continue;
    const dx = enemy.x - state.player.x;
    const dy = enemy.y - state.player.y;
    const d = dx * dx + dy * dy;
    if (d < nearestDist) {
      nearestDist = d;
      nearest = enemy;
    }
  }
  return nearest;
}

/** One step of autopilot input: aim (with lead) at the nearest enemy, strafe away from danger. */
function pilotInput(state) {
  const player = state.player;
  const target = nearestEnemy(state);
  let aimX = player.x + 1;
  let aimY = player.y;
  let mx = 0;
  let my = 0;
  if (target !== null) {
    const dist = Math.hypot(target.x - player.x, target.y - player.y);
    const lead = dist / 820;
    aimX = target.x + target.vx * lead;
    aimY = target.y + target.vy * lead;
    // Repulsion from every close enemy, plus a gentle pull back toward the middle.
    for (const enemy of state.enemies) {
      if (!enemy.active) continue;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 210) {
        const weight = (210 - d) / 210;
        mx += (dx / d) * weight * 1.6;
        my += (dy / d) * weight * 1.6;
      }
    }
    for (const bullet of state.ebullets) {
      if (!bullet.active) continue;
      const dx = player.x - bullet.x;
      const dy = player.y - bullet.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 110) {
        mx += (dx / d) * 0.7;
        my += (dy / d) * 0.7;
      }
    }
    mx += (FIELD.width / 2 - player.x) / FIELD.width * 0.35;
    my += (FIELD.height / 2 - player.y) / FIELD.height * 0.35;
  }
  return { mx, my, aimX, aimY, fire: target !== null };
}

/** Aim and fire like the pilot, but hold position: the swarm closes in, which is the photograph. */
function holdInput(state) {
  const input = pilotInput(state);
  input.mx = 0;
  input.my = 0;
  return input;
}

const IDLE_INPUT = { mx: 0, my: 0, aimX: 0, aimY: 0, fire: false };

function runSteps(world, seconds, inputFor) {
  const steps = Math.round(seconds / STEP);
  for (let index = 0; index < steps; index += 1) {
    if (world.step(STEP, inputFor(world.state), false) & EVENT_OVER) return true;
  }
  return false;
}

function countActive(pool) {
  let count = 0;
  for (const item of pool) if (item.active) count += 1;
  return count;
}

/** Keep playing (up to `seconds` more) until the frame is busy enough to photograph. */
function stepUntilRich(world, seconds, minEnemies, minBullets, inputFor = pilotInput, minNear = 0) {
  const steps = Math.round(seconds / STEP);
  for (let index = 0; index < steps; index += 1) {
    const state = world.state;
    let near = 0;
    for (const enemy of state.enemies) {
      if (enemy.active && Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y) < 480) near += 1;
    }
    if (countActive(state.enemies) >= minEnemies && countActive(state.bullets) >= minBullets && near >= minNear) return;
    if (world.step(STEP, inputFor(state), false) & EVENT_OVER) return;
  }
}

/**
 * Set `world` to the named scene and return the screen to draw over it and the best score
 * to show. Names: start (title), play (mid-game), swarm (a late wave at full combo),
 * over (game over). Anything else is start.
 */
export function stageShot(name, world) {
  world.reset();
  if (name === 'play') {
    runSteps(world, PLAY_SECONDS, pilotInput);
    // The pilot is too efficient to leave a crowd standing; hold position and let the next
    // wave arrive around the ship (dodging again if the hull gets low), then take the
    // frame with the arena full.
    stepUntilRich(world, 22, 5, 3, (state) => (state.player.hp <= 2 ? pilotInput(state) : holdInput(state)), 3);
    return { screen: SCREEN_PLAY, best: Math.max(world.state.score, 0) };
  }
  if (name === 'swarm') {
    // A long run in one-second chunks; the pilot is stage-dressed with hull repairs so the
    // scene always reaches the late wave it is meant to show instead of an early game over.
    for (let second = 0; second < SWARM_SECONDS && !world.state.over; second += 1) {
      runSteps(world, 1, pilotInput);
      if (world.state.player.hp < 5) world.state.player.hp = 5;
    }
    const state = world.state;
    if (!state.over) {
      stepUntilRich(world, 6, 5, 2);
      // Stage the crescendo the run was heading for: a fat combo, fresh explosions, and a
      // splitter dying in the middle of its own children.
      state.combo = 27;
      state.comboTimer = COMBO_WINDOW;
      state.mult = 4;
      let splitter = null;
      for (const enemy of state.enemies) {
        if (enemy.active && enemy.type === ENEMY_SPLITTER) splitter = enemy;
      }
      const cx = splitter !== null ? splitter.x : state.player.x + 180;
      const cy = splitter !== null ? splitter.y : state.player.y - 60;
      world.burst(cx, cy, enemyColorOf(ENEMY_SPLITTER), 46, 340, 5.6, 1.15);
      world.burst(cx, cy, '#ffffff', 16, 210, 3.6, 0.8);
      world.burst(state.player.x + 90, state.player.y + 70, '#ff3d7e', 30, 290, 5, 1);
      // A few fresh steps so the clouds expand and the HUD combo bar is live.
      for (let index = 0; index < 7; index += 1) world.step(STEP, pilotInput(state), false);
    }
    return { screen: state.over ? SCREEN_OVER : SCREEN_PLAY, best: state.score };
  }
  if (name === 'over') {
    runSteps(world, OVER_PLAY_SECONDS, pilotInput);
    if (!world.state.over) {
      // Stop dodging and stop shooting: the swarm closes in and finishes the run.
      runSteps(world, OVER_GIVEUP_LIMIT, () => IDLE_INPUT);
    }
    // Let the killing blow's red flash fade and the wreckage drift before the photograph,
    // and land on a moment when the retry prompt (which blinks) is lit.
    if (world.state.over) {
      runSteps(world, 0.7, () => IDLE_INPUT);
      for (let index = 0; index < 50 && Math.floor(world.state.time * 1.6) % 2 !== 0; index += 1) {
        world.step(STEP, IDLE_INPUT, false);
      }
    }
    return { screen: SCREEN_OVER, best: world.state.score };
  }
  for (let index = 0; index < START_SECONDS / STEP; index += 1) world.step(STEP, IDLE_INPUT, true);
  // The title prompt blinks; stage the frame while it is lit.
  for (let index = 0; index < 50 && Math.floor(world.state.time * 1.6) % 2 !== 0; index += 1) {
    world.step(STEP, IDLE_INPUT, true);
  }
  return { screen: SCREEN_TITLE, best: 0 };
}
