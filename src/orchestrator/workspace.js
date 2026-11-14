// Restores the prototype to its seeded state so `qa demo` is repeatable.
//
// The agents genuinely mutate the workspace: they write test case files, spec
// files and flag state. That is the point, and it is also why a prototype needs
// a way back. Everything generated lives in known places:
//
//   data/testcases/**/project-*.yaml   written by the case writer
//   cypress/e2e/web/*.cy.js            written by the automation agent
//   data/flags.json                    mutated by promotion
//   out/                               reports, evidence, published pages

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, reset as resetStore } from './store.js';

const SEED = path.join(ROOT, 'data/fixtures/seed');

const GENERATED_DIRS = [
  { dir: 'data/testcases/web', match: /^project-.*\.ya?ml$/ },
  { dir: 'data/testcases/mobile', match: /^project-.*\.ya?ml$/ },
  { dir: 'cypress/e2e/web', match: /\.cy\.js$/ }
];

export function reset({ keepReports = false } = {}) {
  const removed = [];

  for (const { dir, match } of GENERATED_DIRS) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full)) {
      if (match.test(f)) { fs.unlinkSync(path.join(full, f)); removed.push(path.join(dir, f)); }
    }
  }

  // Seeded flag state and the two treatment specs the promotion step consumes.
  fs.copyFileSync(path.join(SEED, 'flags.json'), path.join(ROOT, 'data/flags.json'));
  fs.mkdirSync(path.join(ROOT, 'cypress/e2e/web'), { recursive: true });
  for (const spec of ['sorted-catalog-on.cy.js', 'sorted-catalog-off.cy.js']) {
    fs.copyFileSync(path.join(SEED, spec), path.join(ROOT, 'cypress/e2e/web', spec));
  }

  if (!keepReports) {
    const out = path.join(ROOT, 'out');
    if (fs.existsSync(out)) fs.rmSync(out, { recursive: true, force: true });
  }

  resetStore();
  return { removed, restored: ['data/flags.json', 'cypress/e2e/web/sorted-catalog-on.cy.js', 'cypress/e2e/web/sorted-catalog-off.cy.js'] };
}
