// BREAKPORT — hand-in program (Node 22, standard library only).
//
// The game itself is the static file tree in game/: the browser loads it as ES
// modules with three.js resolved through the import map in game/index.html, so
// there is nothing to build. This program's one job is the hand-in: copy game/
// and screenshots/ from beside this file into the output directory and write
// dossier.json there with buildDossier from vendor/makefun-threejs.ts, the
// summary the judge reads. It runs twice and must write identical bytes both
// times, so it does no timestamps, no randomness and no network access.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Play the game locally with: node serve.ts   (then open http://localhost:8091)

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The caps mirror the scorer's own gate: only text_max_bytes shapes the bytes
// buildDossier writes; the rest make this program refuse a tree the scorer
// would refuse anyway (too many screenshots, an oversized game/ tree).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
