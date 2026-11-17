// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps (several in a slow frame, none in a fast one), and the renderer paints what is
// there. The game moves between four screens — title, play, paused and game over — and
// the world's event flags drive the synthesised sound and the screen-reader announcements.
//
// ?seed=N fixes the random pattern. ?shot=start|play|swarm|over (with &seed=N) stages
// that scene instead of running the loop, paints it twice and sets window.__shotReady
// for a screenshot.
import { BEST_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import {
  createWorld,
  EVENT_ENEMY_SHOT,
  EVENT_KILL,
  EVENT_OVER,
  EVENT_PLAYER_HIT,
  EVENT_POWERUP,
  EVENT_SHIELD_HIT,
  EVENT_SHOT,
  EVENT_WAVE,
} from './world.js';
import { ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best, false);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  const audio = createAudio();
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();

  // Screen readers (and anyone watching the page's text) hear the screen changes and each hit.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    world.reset();
    accumulator = 0;
    screen = SCREEN_PLAY;
    audio.unlock();
    audio.startMusic();
    announce('Playing. Survive the swarm.');
  }

  function endGame() {
    screen = SCREEN_OVER;
    audio.stopMusic();
    audio.gameOver();
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    announce(`Game over. Score ${world.state.score}. Best ${best}.`);
  }

  function react(events) {
    if (events & EVENT_SHOT) audio.shoot();
    if (events & EVENT_ENEMY_SHOT) audio.enemyShot();
    if (events & EVENT_KILL) audio.explosion(false);
    if (events & EVENT_SHIELD_HIT) audio.shieldHit();
    if (events & EVENT_PLAYER_HIT) audio.playerHit();
    if (events & EVENT_POWERUP) audio.powerup();
    if (events & EVENT_WAVE) audio.wave();
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) audio.toggleMute();
    if (actions & ACTION_CONFIRM) audio.unlock();
    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_CONFIRM) startGame();
    } else if (screen === SCREEN_PLAY) {
      if (actions & ACTION_PAUSE) {
        screen = SCREEN_PAUSED;
        audio.stopMusic();
        announce('Paused.');
      } else if (actions & ACTION_RESTART) startGame();
    } else if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
        screen = SCREEN_PLAY;
        audio.startMusic();
        announce('Playing.');
      } else if (actions & ACTION_RESTART) startGame();
    } else if (screen === SCREEN_OVER) {
      if (actions & (ACTION_CONFIRM | ACTION_RESTART)) startGame();
    }
  }

  function currentInput() {
    const pointer = input.pointer();
    const aim = renderer.toWorld(pointer.x, pointer.y);
    return { mx: input.moveX(), my: input.moveY(), aimX: aim.x, aimY: aim.y, fire: input.firing() };
  }

  function step() {
    if (screen === SCREEN_TITLE) {
      world.step(STEP, { mx: 0, my: 0, aimX: 0, aimY: 0, fire: false }, true);
      return;
    }
    const events = world.step(STEP, currentInput(), false);
    react(events);
    if (events & EVENT_OVER) endGame();
    else if (events & EVENT_PLAYER_HIT) {
      announce(world.state.player.hp === 1 ? 'Hit. 1 hull left.' : `Hit. ${world.state.player.hp} hull left.`);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(world.state, screen, best, audio.isMuted());
  }

  // Leaving the tab pauses a running game rather than letting the swarm feed unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      audio.stopMusic();
      announce('Paused.');
    }
  });

  announce('Neon Swarm. Click or press Enter to launch.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
