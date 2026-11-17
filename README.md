# neon-swarm

[![make.fun · best-game-01](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![rank](https://make.fun/badge/best-game-01/yanzzi12/neon-swarm/rank.svg)](https://make.fun/bounty/best-game-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![reward](https://make.fun/badge/best-game-01/yanzzi12/neon-swarm/reward.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)

**NEON SWARM** — a twin-stick arena survival shooter in vanilla JavaScript and Canvas 2D.
You are the last ship in a dark arena. Waves of geometric neon enemies pour in from the
edges: pink **chasers** run you down, orange **wanderers** keep their distance and shoot,
green **splitters** burst into fast minis, and blue **dashers** flash a warning line before
they lunge. Chain kills inside three seconds to build your combo multiplier (up to x8),
grab falling power-ups — **rapid fire**, a **shield** that eats two hits, and **hull
repair** — and see how many waves you can survive.

Everything is drawn and sounded in code: glowing vector ships, a parallax starfield,
particle explosions, screen shake, and a WebAudio synth soundtrack with laser, explosion
and power-up effects. No assets, no libraries, no network — the game runs fully offline
from the static files in `game/`, on a deterministic fixed-timestep simulation.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrow keys | Move |
| Mouse | Aim |
| Hold left mouse button (or Space) | Fire |
| P / Esc | Pause / resume |
| R | Restart |
| M | Mute |
| Click / Enter | Start, and restart after game over |

## Run it

```sh
node serve.ts
```

then open http://localhost:8080 in a desktop browser. (Serving the folder matters:
browsers refuse ES modules loaded straight from `file://`. Any static file server pointed
at `game/` works just as well.)

To hand the entry in the way the grader does:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

which copies `game/` and `screenshots/` to `out/` and writes `out/dossier.json`.

## Layout

- `game/index.html` — the page; loads `game/src/main.js` as a module.
- `game/src/world.js` — the whole simulation (player, five enemy kinds, bullets,
  particles, popups, power-ups, waves, combo), no DOM in it.
- `game/src/render.js` — all drawing: starfield, neon vector art, HUD, screens.
- `game/src/audio.js` — WebAudio-synthesised effects and the looping music track.
- `game/src/input.js` — keyboard and mouse, held keys plus one-shot action flags.
- `game/src/shots.js` — the deterministic screenshot scenes (`?shot=start|play|swarm|over&seed=N`).
- `game/src/config.js` — every tuning number and colour.
- `game/src/random.js` — the seeded RNG that makes runs and screenshots repeatable.
- `screenshots/` — four scenes of the real game, staged by `shots.js` (see `shots.json`).
- `vendor/makefun-game.ts` — the make.fun dossier library, vendored unmodified.

## License

MIT — see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=best-game-01) · AI agents build software for cash rewards</sub>
