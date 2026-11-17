// Every tuning number and colour for NEON SWARM in one place. The playfield is a fixed
// 1280x720 logical arena; the renderer scales it to the window, so no rule below depends
// on the screen size.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

export const PLAYER = {
  radius: 13,
  speed: 345,
  accel: 2600,
  hp: 5,
  invulnerable: 1.4,
  fireInterval: 0.145,
  bulletSpeed: 820,
  bulletLife: 0.95,
  bulletRadius: 4,
};

/** Rapid-fire power-up: a much shorter fire interval and hotter bullets while it lasts. */
export const RAPID = { duration: 8, fireInterval: 0.068, bulletSpeed: 980 };

/** Shield power-up: a ring that eats hits before the hull does. */
export const SHIELD = { duration: 10, hits: 2 };

/** Kills chained inside this window raise the combo; the multiplier grows with the chain. */
export const COMBO_WINDOW = 3.0;
export const COMBO_PER_TIER = 8;
export const COMBO_MAX_MULT = 8;

/** Enemy bullets: one speed and size for every shooter, so they read as one threat. */
export const EBULLET = { speed: 305, radius: 5, life: 4.5 };

export const POWERUP = {
  radius: 15,
  dropChance: 0.12,
  life: 9,
  drift: 26,
};

/** Pool sizes: every entity lives in a pool allocated once at boot; nothing allocates mid-game. */
export const POOLS = {
  bullets: 320,
  ebullets: 160,
  enemies: 96,
  particles: 640,
  popups: 48,
  powerups: 24,
};

/** How many enemies may be alive at once in a wave (plus a small growth per wave). */
export const MAX_ALIVE_BASE = 13;
export const MAX_ALIVE_PER_WAVE = 1;

/** Seconds between waves, and how long the WAVE banner stays up. */
export const INTERMISSION = 2.4;
export const BANNER_TIME = 1.7;

export const PALETTE = {
  backdrop: '#020208',
  bg: '#05060f',
  grid: 'rgba(64, 90, 180, 0.13)',
  nebulaA: 'rgba(38, 20, 92, 0.55)',
  nebulaB: 'rgba(8, 60, 92, 0.45)',
  nebulaC: 'rgba(92, 14, 62, 0.38)',
  player: '#59f7ff',
  playerCore: '#eaffff',
  bullet: '#aefcff',
  ebullet: '#ff5470',
  chaser: '#ff3d7e',
  wanderer: '#ff9f2e',
  splitter: '#2bff88',
  dasher: '#37b6ff',
  mini: '#c6ff4d',
  rapid: '#ffe74d',
  shield: '#57c8ff',
  heart: '#ff5e7a',
  text: '#eaf6ff',
  muted: '#7d8db0',
  panel: 'rgba(7, 11, 26, 0.88)',
  panelEdge: '#2de2ff',
  danger: '#ff2e4d',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'neon-swarm.best';
