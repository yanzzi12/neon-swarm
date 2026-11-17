// Drawing only: the world's state and the current screen in, pixels out. Everything is
// vector art drawn in code — glowing polygon ships and geometric enemies over a parallax
// starfield — with canvas text for the HUD and panels. The static backdrop (gradient,
// nebulae, grid) is painted once per resize onto an offscreen canvas; the frame itself
// only translates by the (deterministic) screen shake and draws what moves.

import { BANNER_TIME, COMBO_WINDOW, FIELD, FONT, PALETTE, PLAYER, POWERUP } from './config.js';
import {
  ENEMY_DASHER,
  ENEMY_SPLITTER,
  ENEMY_WANDERER,
  POWER_HEART,
  POWER_RAPID,
  POWER_SHIELD,
  enemyColorOf,
} from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const TAU = Math.PI * 2;

function cachedLabel(prefix) {
  let value = -1;
  let text = '';
  return function label(next) {
    if (next !== value) {
      value = next;
      text = prefix + next;
    }
    return text;
  };
}

/** A regular polygon path centred on the origin; rotation is the caller's transform. */
function polygon(context, sides, radius) {
  context.beginPath();
  for (let index = 0; index < sides; index += 1) {
    const angle = (index / sides) * TAU - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

/** The power-up glyphs, shared by the falling pickups and the title screen's legend. */
export function drawPowerupGlyph(context, type, x, y, radius) {
  context.save();
  context.translate(x, y);
  if (type === POWER_RAPID) {
    context.fillStyle = PALETTE.rapid;
    context.beginPath();
    context.moveTo(3, -radius);
    context.lineTo(-radius * 0.75, radius * 0.25);
    context.lineTo(-1, radius * 0.25);
    context.lineTo(-3, radius);
    context.lineTo(radius * 0.75, -radius * 0.25);
    context.lineTo(1, -radius * 0.25);
    context.closePath();
    context.fill();
  } else if (type === POWER_SHIELD) {
    context.strokeStyle = PALETTE.shield;
    context.lineWidth = 2.5;
    context.beginPath();
    context.moveTo(0, -radius);
    context.lineTo(radius * 0.8, -radius * 0.55);
    context.lineTo(radius * 0.8, radius * 0.2);
    context.quadraticCurveTo(radius * 0.8, radius * 0.8, 0, radius);
    context.quadraticCurveTo(-radius * 0.8, radius * 0.8, -radius * 0.8, radius * 0.2);
    context.lineTo(-radius * 0.8, -radius * 0.55);
    context.closePath();
    context.stroke();
  } else {
    context.fillStyle = PALETTE.heart;
    const r = radius;
    context.beginPath();
    context.moveTo(0, r * 0.85);
    context.bezierCurveTo(-r * 1.25, -r * 0.1, -r * 0.62, -r * 0.95, 0, -r * 0.38);
    context.bezierCurveTo(r * 0.62, -r * 0.95, r * 1.25, -r * 0.1, 0, r * 0.85);
    context.fill();
  }
  context.restore();
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const backdrop = document.createElement('canvas');
  const scoreLabel = cachedLabel('SCORE ');
  const bestLabel = cachedLabel('BEST ');
  const waveLabel = cachedLabel('WAVE ');
  const comboLabel = cachedLabel('COMBO x');
  const finalLabel = cachedLabel('SCORE ');
  const reachedLabel = cachedLabel('WAVE REACHED: ');

  const fonts = new Map();
  function text(value, x, y, size, color, align, weight = 600, glow = 0) {
    const key = `${weight}:${size}`;
    if (!fonts.has(key)) fonts.set(key, `${weight} ${size}px ${FONT}`);
    context.font = fonts.get(key);
    context.fillStyle = color;
    context.textAlign = align;
    if (glow > 0) {
      context.shadowColor = color;
      context.shadowBlur = glow;
    }
    context.fillText(value, x, y);
    if (glow > 0) context.shadowBlur = 0;
  }

  function paintBackdrop() {
    backdrop.width = FIELD.width;
    backdrop.height = FIELD.height;
    const bg = backdrop.getContext('2d');
    const gradient = bg.createLinearGradient(0, 0, 0, FIELD.height);
    gradient.addColorStop(0, '#070818');
    gradient.addColorStop(0.55, PALETTE.bg);
    gradient.addColorStop(1, '#03030a');
    bg.fillStyle = gradient;
    bg.fillRect(0, 0, FIELD.width, FIELD.height);
    const nebula = (x, y, radius, color) => {
      const radial = bg.createRadialGradient(x, y, 0, x, y, radius);
      radial.addColorStop(0, color);
      radial.addColorStop(1, 'rgba(0, 0, 0, 0)');
      bg.fillStyle = radial;
      bg.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    };
    nebula(240, 150, 330, PALETTE.nebulaA);
    nebula(1060, 560, 380, PALETTE.nebulaB);
    nebula(880, 110, 260, PALETTE.nebulaC);
    bg.strokeStyle = PALETTE.grid;
    bg.lineWidth = 1;
    bg.beginPath();
    for (let x = 64; x < FIELD.width; x += 64) {
      bg.moveTo(x + 0.5, 0);
      bg.lineTo(x + 0.5, FIELD.height);
    }
    for (let y = 64; y < FIELD.height; y += 64) {
      bg.moveTo(0, y + 0.5);
      bg.lineTo(FIELD.width, y + 0.5);
    }
    bg.stroke();
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  function drawStars(state) {
    const drift = [4, 9, 17];
    for (const star of state.stars) {
      const x = ((star.x - state.time * drift[star.layer]) % FIELD.width + FIELD.width) % FIELD.width;
      const twinkle = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(state.time * 2.2 + star.phase));
      context.globalAlpha = twinkle * (0.35 + star.layer * 0.3);
      context.fillStyle = star.layer === 2 ? '#cfe9ff' : '#8fb7e8';
      context.fillRect(x, star.y, star.size, star.size);
    }
    context.globalAlpha = 1;
  }

  function drawShip(state) {
    const player = state.player;
    if (!player.alive) return;
    if (player.invulnerable > 0 && Math.floor(player.invulnerable * 12) % 2 === 1) {
      // Blink while invulnerable after a hit.
    } else {
      context.save();
      context.translate(player.x, player.y);
      context.rotate(player.angle);
      if (player.thrust === 1) {
        const flame = 12 + Math.sin(state.time * 42) * 4 + Math.sin(state.time * 71) * 2;
        context.fillStyle = 'rgba(255, 160, 60, 0.85)';
        context.beginPath();
        context.moveTo(-11, 5);
        context.lineTo(-11 - flame, 0);
        context.lineTo(-11, -5);
        context.closePath();
        context.fill();
      }
      context.shadowColor = PALETTE.player;
      context.shadowBlur = 16;
      context.fillStyle = PALETTE.player;
      context.beginPath();
      context.moveTo(19, 0);
      context.lineTo(-8, 7);
      context.lineTo(-13, 12);
      context.lineTo(-10, 0);
      context.lineTo(-13, -12);
      context.lineTo(-8, -7);
      context.closePath();
      context.fill();
      context.shadowBlur = 0;
      context.fillStyle = PALETTE.playerCore;
      context.beginPath();
      context.arc(3, 0, 3.6, 0, TAU);
      context.fill();
      context.restore();
    }
    if (player.shield > 0 && player.shieldHits > 0) {
      context.save();
      context.translate(player.x, player.y);
      context.strokeStyle = PALETTE.shield;
      context.globalAlpha = 0.55 + 0.3 * Math.sin(state.time * 5);
      context.lineWidth = 2;
      context.shadowColor = PALETTE.shield;
      context.shadowBlur = 12;
      context.beginPath();
      context.arc(0, 0, PLAYER.radius + 11, 0, TAU);
      context.stroke();
      context.restore();
      context.globalAlpha = 1;
    }
  }

  function drawEnemy(enemy, state) {
    const color = enemy.flash > 0 ? '#ffffff' : enemyColorOf(enemy.type);
    context.save();
    context.translate(enemy.x, enemy.y);
    const scale = enemy.spawnIn > 0 ? 1 - enemy.spawnIn / 0.38 : 1;
    context.scale(scale, scale);
    context.shadowColor = enemyColorOf(enemy.type);
    context.shadowBlur = 14;
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 2.4;
    if (enemy.type === 0) {
      // Chaser: a dart triangle flying at the player.
      context.rotate(enemy.angle);
      context.beginPath();
      context.moveTo(15, 0);
      context.lineTo(-11, 10);
      context.lineTo(-6, 0);
      context.lineTo(-11, -10);
      context.closePath();
      context.globalAlpha = 0.28;
      context.fill();
      context.globalAlpha = 1;
      context.stroke();
    } else if (enemy.type === ENEMY_WANDERER) {
      // Wanderer: a rotating square with a gun core.
      context.rotate(state.time * 0.9 + enemy.seed);
      context.globalAlpha = 0.25;
      polygon(context, 4, enemy.radius);
      context.fill();
      context.globalAlpha = 1;
      polygon(context, 4, enemy.radius);
      context.stroke();
      context.rotate(-(state.time * 0.9 + enemy.seed) + enemy.angle);
      context.beginPath();
      context.arc(0, 0, 5, 0, TAU);
      context.fill();
    } else if (enemy.type === ENEMY_SPLITTER) {
      // Splitter: a big hexagon that pulses as it lumbers.
      context.rotate(state.time * 0.5 + enemy.seed);
      const pulse = 1 + Math.sin(enemy.age * 3) * 0.05;
      context.scale(pulse, pulse);
      context.globalAlpha = 0.22;
      polygon(context, 6, enemy.radius);
      context.fill();
      context.globalAlpha = 1;
      polygon(context, 6, enemy.radius);
      context.stroke();
      polygon(context, 6, enemy.radius * 0.55);
      context.stroke();
    } else if (enemy.type === ENEMY_DASHER) {
      // Dasher: a slim diamond; it flashes white-hot while telegraphing its dash.
      context.rotate(enemy.angle);
      if (enemy.mode === 1) {
        context.strokeStyle = Math.floor(state.time * 14) % 2 === 0 ? '#ffffff' : enemyColorOf(enemy.type);
        // The telegraph line: where it is about to go.
        context.globalAlpha = 0.3;
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(330, 0);
        context.stroke();
        context.globalAlpha = 1;
        context.lineWidth = 2.4;
      }
      context.beginPath();
      context.moveTo(17, 0);
      context.lineTo(0, 8);
      context.lineTo(-17, 0);
      context.lineTo(0, -8);
      context.closePath();
      context.globalAlpha = 0.3;
      context.fill();
      context.globalAlpha = 1;
      context.stroke();
    } else {
      // Mini: a small, fast triangle.
      context.rotate(enemy.angle);
      context.beginPath();
      context.moveTo(10, 0);
      context.lineTo(-8, 7);
      context.lineTo(-8, -7);
      context.closePath();
      context.globalAlpha = 0.3;
      context.fill();
      context.globalAlpha = 1;
      context.stroke();
    }
    context.restore();
    if (enemy.spawnIn > 0) {
      // Spawn warning ring, shrinking as the enemy materialises.
      context.save();
      context.translate(enemy.x, enemy.y);
      context.strokeStyle = enemyColorOf(enemy.type);
      context.globalAlpha = 0.5;
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(0, 0, enemy.radius + 16 * (enemy.spawnIn / 0.38), 0, TAU);
      context.stroke();
      context.restore();
      context.globalAlpha = 1;
    }
    if (enemy.hp < enemy.maxHp && enemy.spawnIn <= 0) {
      const width = enemy.radius * 2;
      context.fillStyle = 'rgba(255, 255, 255, 0.22)';
      context.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 10, width, 3);
      context.fillStyle = enemyColorOf(enemy.type);
      context.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 10, width * (enemy.hp / enemy.maxHp), 3);
    }
  }

  function drawPowerup(item, state) {
    const bob = Math.sin(item.age * 3.2) * 3;
    const blink = item.life < 2 ? Math.floor(item.life * 8) % 2 === 0 : true;
    if (!blink) return;
    context.save();
    context.translate(item.x, item.y + bob);
    const color = item.type === POWER_RAPID ? PALETTE.rapid : item.type === POWER_SHIELD ? PALETTE.shield : PALETTE.heart;
    context.strokeStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 12;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(0, 0, POWERUP.radius + 3 + Math.sin(state.time * 4) * 1.5, 0, TAU);
    context.stroke();
    context.shadowBlur = 0;
    drawPowerupGlyph(context, item.type, 0, 0, 10);
    context.restore();
  }

  function drawField(state) {
    context.drawImage(backdrop, 0, 0);
    drawStars(state);
    for (const item of state.powerups) if (item.active) drawPowerup(item, state);
    for (const bullet of state.ebullets) {
      if (!bullet.active) continue;
      context.save();
      context.shadowColor = PALETTE.ebullet;
      context.shadowBlur = 10;
      context.fillStyle = PALETTE.ebullet;
      context.beginPath();
      context.arc(bullet.x, bullet.y, 5, 0, TAU);
      context.fill();
      context.restore();
    }
    for (const enemy of state.enemies) if (enemy.active) drawEnemy(enemy, state);
    for (const bullet of state.bullets) {
      if (!bullet.active) continue;
      context.save();
      context.translate(bullet.x, bullet.y);
      context.rotate(Math.atan2(bullet.vy, bullet.vx));
      context.shadowColor = PALETTE.player;
      context.shadowBlur = 9;
      context.fillStyle = PALETTE.bullet;
      context.beginPath();
      context.ellipse(0, 0, 8, 2.6, 0, 0, TAU);
      context.fill();
      context.restore();
    }
    drawShip(state);
    for (const particle of state.particles) {
      if (!particle.active) continue;
      context.globalAlpha = Math.max(0, particle.life / particle.maxLife);
      context.fillStyle = particle.color;
      context.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
    }
    context.globalAlpha = 1;
    for (const popup of state.popups) {
      if (!popup.active) continue;
      context.globalAlpha = Math.min(1, (popup.life / popup.maxLife) * 1.6);
      context.textBaseline = 'middle';
      text(popup.text, popup.x, popup.y, popup.size, popup.color, 'center', 700);
    }
    context.globalAlpha = 1;
  }

  function drawHearts(state) {
    const player = state.player;
    for (let index = 0; index < PLAYER.hp; index += 1) {
      const x = FIELD.width - 30 - index * 30;
      const y = 32;
      context.save();
      context.translate(x, y);
      context.rotate(-Math.PI / 2);
      context.fillStyle = index < player.hp ? PALETTE.player : 'rgba(125, 141, 176, 0.25)';
      if (index < player.hp) {
        context.shadowColor = PALETTE.player;
        context.shadowBlur = 8;
      }
      context.beginPath();
      context.moveTo(10, 0);
      context.lineTo(-7, 6);
      context.lineTo(-7, -6);
      context.closePath();
      context.fill();
      context.restore();
    }
  }

  function drawHud(state, best) {
    context.textBaseline = 'top';
    text(scoreLabel(state.score), 24, 16, 27, PALETTE.text, 'left', 800);
    text(bestLabel(best), 24, 48, 15, PALETTE.muted, 'left', 600);
    text(waveLabel(Math.max(1, state.wave)), FIELD.width / 2, 16, 24, PALETTE.text, 'center', 800);
    drawHearts(state);
    if (state.combo > 1) {
      const x = 24;
      const y = 78;
      text(comboLabel(state.mult), x, y, 20, state.mult >= 4 ? '#ffe74d' : PALETTE.text, 'left', 800, state.mult >= 4 ? 10 : 0);
      context.fillStyle = 'rgba(255, 255, 255, 0.16)';
      context.fillRect(x, y + 27, 130, 5);
      context.fillStyle = state.mult >= 4 ? '#ffe74d' : PALETTE.panelEdge;
      context.fillRect(x, y + 27, 130 * Math.max(0, state.comboTimer / COMBO_WINDOW), 5);
      context.textBaseline = 'top';
      text(`CHAIN ${state.combo}`, x + 140, y + 1, 15, PALETTE.muted, 'left', 600);
    }
    const player = state.player;
    let tagY = FIELD.height - 30;
    if (player.rapid > 0) {
      text(`RAPID ${player.rapid.toFixed(1)}`, 24, tagY, 16, PALETTE.rapid, 'left', 700);
      tagY -= 22;
    }
    if (player.shield > 0) {
      text(`SHIELD ${player.shieldHits} HIT${player.shieldHits === 1 ? '' : 'S'}`, 24, tagY, 16, PALETTE.shield, 'left', 700);
    }
  }

  function drawBanner(state) {
    if (state.bannerTimer <= 0) return;
    const alpha = Math.min(1, state.bannerTimer / 0.5, (BANNER_TIME - state.bannerTimer) / 0.25 + 0.2);
    context.globalAlpha = Math.max(0, Math.min(1, alpha));
    context.textBaseline = 'middle';
    text(state.bannerText, FIELD.width / 2, 150, 44, PALETTE.text, 'center', 800, 18);
    context.globalAlpha = 1;
  }

  function drawVignette(state) {
    if (state.hurtFlash > 0) {
      const alpha = Math.min(0.5, state.hurtFlash * 1.1);
      const gradient = context.createRadialGradient(
        FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.32,
        FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.78,
      );
      gradient.addColorStop(0, 'rgba(255, 46, 77, 0)');
      gradient.addColorStop(1, `rgba(255, 46, 77, ${alpha})`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, FIELD.width, FIELD.height);
      // A bright tick on the edge the damage came from.
      const x = FIELD.width / 2 + Math.cos(state.hurtAngle) * (FIELD.width * 0.44);
      const y = FIELD.height / 2 + Math.sin(state.hurtAngle) * (FIELD.height * 0.4);
      context.save();
      context.translate(x, y);
      context.rotate(state.hurtAngle);
      context.fillStyle = `rgba(255, 46, 77, ${alpha + 0.25})`;
      context.beginPath();
      context.moveTo(14, 0);
      context.lineTo(-10, 11);
      context.lineTo(-10, -11);
      context.closePath();
      context.fill();
      context.restore();
    } else if (state.player.alive && state.player.hp === 1) {
      const alpha = 0.1 + 0.07 * Math.sin(state.time * 4);
      const gradient = context.createRadialGradient(
        FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.36,
        FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.8,
      );
      gradient.addColorStop(0, 'rgba(255, 46, 77, 0)');
      gradient.addColorStop(1, `rgba(255, 46, 77, ${alpha})`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, FIELD.width, FIELD.height);
    }
  }

  function drawPanel(height) {
    const width = 660;
    const x = (FIELD.width - width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = PALETTE.panel;
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.shadowColor = PALETTE.panelEdge;
    context.shadowBlur = 18;
    context.beginPath();
    context.roundRect(x, y, width, height, 14);
    context.fill();
    context.stroke();
    context.shadowBlur = 0;
    return { x, y, width, height };
  }

  function drawTitle(state, best) {
    const panel = drawPanel(430);
    const cx = FIELD.width / 2;
    context.textBaseline = 'alphabetic';
    text('NEON SWARM', cx, panel.y + 92, 62, PALETTE.player, 'center', 800, 26);
    text('TWIN-STICK ARENA SURVIVAL', cx, panel.y + 126, 17, PALETTE.muted, 'center', 700);
    text('WASD / ARROWS — move      MOUSE — aim      HOLD CLICK — fire', cx, panel.y + 176, 18, PALETTE.text, 'center', 600);
    text('Chain kills to raise your combo multiplier. Do not get touched.', cx, panel.y + 206, 16, PALETTE.muted, 'center', 400);
    const legend = [
      [POWER_RAPID, 'RAPID FIRE', PALETTE.rapid],
      [POWER_SHIELD, 'SHIELD', PALETTE.shield],
      [POWER_HEART, 'REPAIR +1', PALETTE.heart],
    ];
    for (let index = 0; index < legend.length; index += 1) {
      const [type, label, color] = legend[index];
      const lx = cx - 190 + index * 150;
      drawPowerupGlyph(context, type, lx, panel.y + 248, 13);
      text(label, lx + 22, panel.y + 254, 15, color, 'left', 700);
    }
    text('P pause · R restart · M mute', cx, panel.y + 300, 15, PALETTE.muted, 'center', 400);
    if (best > 0) text(bestLabel(best), cx, panel.y + 332, 17, PALETTE.text, 'center', 700);
    const blink = Math.floor(state.time * 1.6) % 2 === 0;
    if (blink) text('CLICK OR PRESS ENTER TO LAUNCH', cx, panel.y + 382, 21, '#ffe74d', 'center', 800, 12);
  }

  function drawPaused(state) {
    const panel = drawPanel(250);
    const cx = FIELD.width / 2;
    context.textBaseline = 'alphabetic';
    text('PAUSED', cx, panel.y + 88, 46, PALETTE.text, 'center', 800, 16);
    text('The swarm waits for no one. Well — just this once.', cx, panel.y + 132, 17, PALETTE.muted, 'center', 400);
    text(scoreLabel(state.score), cx, panel.y + 168, 20, PALETTE.text, 'center', 700);
    text('P / ESC — resume      R — restart', cx, panel.y + 214, 18, '#ffe74d', 'center', 700);
  }

  function drawOver(state, best) {
    const panel = drawPanel(330);
    const cx = FIELD.width / 2;
    context.textBaseline = 'alphabetic';
    text('GAME OVER', cx, panel.y + 84, 52, PALETTE.danger, 'center', 800, 22);
    text(finalLabel(state.score), cx, panel.y + 140, 30, PALETTE.text, 'center', 800);
    text(bestLabel(best), cx, panel.y + 176, 19, PALETTE.muted, 'center', 600);
    text(reachedLabel(Math.max(1, state.wave)), cx, panel.y + 208, 19, PALETTE.muted, 'center', 600);
    text(`BEST COMBO CHAIN: ${state.bestCombo}`, cx, panel.y + 238, 19, PALETTE.muted, 'center', 600);
    const blink = Math.floor(state.time * 1.6) % 2 === 0;
    if (blink) text('PRESS R, ENTER OR CLICK TO RETRY', cx, panel.y + 292, 20, '#ffe74d', 'center', 800, 12);
  }

  /** Paint one frame: the field, then the HUD, overlays and the screen's panel if any. */
  function draw(state, screen, best, muted) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const shakeX = state.shake > 0 ? state.shake * (Math.sin(state.time * 131.7) + 0.6 * Math.sin(state.time * 297.3)) / 1.6 : 0;
    const shakeY = state.shake > 0 ? state.shake * (Math.cos(state.time * 149.1) + 0.6 * Math.sin(state.time * 271.9)) / 1.6 : 0;
    context.setTransform(view.scale, 0, 0, view.scale, view.x + shakeX * view.scale, view.y + shakeY * view.scale);
    drawField(state);
    if (screen === SCREEN_TITLE) {
      drawTitle(state, best);
    } else {
      drawHud(state, best);
      drawBanner(state);
      drawVignette(state);
      if (screen === SCREEN_PAUSED) drawPaused(state);
      else if (screen === SCREEN_OVER) drawOver(state, best);
    }
    if (muted) {
      context.textBaseline = 'top';
      text('MUTED (M)', FIELD.width - 24, FIELD.height - 34, 14, PALETTE.muted, 'right', 600);
    }
  }

  paintBackdrop();
  resize();
  window.addEventListener('resize', () => {
    resize();
    paintBackdrop();
  });

  return {
    draw,
    /** Convert client (CSS pixel) coordinates to world coordinates, for aiming. */
    toWorld(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const px = (clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
      const py = (clientY - rect.top) * (canvas.height / Math.max(1, rect.height));
      return { x: (px - view.x) / view.scale, y: (py - view.y) / view.scale };
    },
  };
}
