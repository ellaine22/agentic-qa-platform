// node --test test/
// These pin the behaviours the whole platform's trustworthiness rests on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, load, save } from '../src/orchestrator/store.js';
import { reset } from '../src/orchestrator/workspace.js';
import { taggedCases } from '../src/agents/coverage.js';
import { testcases, flags } from '../src/connectors/index.js';
import * as planner from '../src/agents/planner.js';
import * as caseWriter from '../src/agents/caseWriter.js';
import * as executor from '../src/agents/executor.js';
import { decideGate } from '../src/orchestrator/store.js';

test('a spec block containing a TODO does not count as automation', () => {
  reset();
  const tagged = taggedCases();
  // Hand-written regression specs are finished.
  assert.equal(tagged.get('WEB-AUTH-001').draft, false, 'finished spec should not be a draft');

  // Write a draft spec and confirm it is excluded.
  const draftPath = path.join(ROOT, 'cypress/e2e/web/_draft.cy.js');
  fs.writeFileSync(draftPath, `describe('d', () => {\n  it('@case:WEB-CART-004 draft', () => {\n    // TODO write this assertion: something\n  });\n});\n`);
  const after = taggedCases();
  assert.equal(after.get('WEB-CART-004').draft, true, 'a TODO block must be a draft');
  fs.unlinkSync(draftPath);
});

test('a tag pointing at no case is reported as dead automation, not coverage', () => {
  const ids = new Set(testcases.all().map(c => c.id));
  const tagged = taggedCases();
  assert.ok(tagged.has('WEB-CAT-009'), 'the legacy tag should still be found');
  assert.ok(!ids.has('WEB-CAT-009'), 'and should not resolve to a case');
});

test('every flag treatment resolves to a distinct test identity', () => {
  const flag = flags.get('express_checkout');
  const identities = flag.treatments.map(t => t.testIdentity.username);
  assert.equal(new Set(identities).size, identities.length,
    'treatments sharing an identity cannot produce a real comparison');
});

test('a pass with no evidence is never auto-accepted', async () => {
  reset();
  let db = load();
  await planner.run(db, 'SWAG-101');
  decideGate(db, db.gates.find(g => g.type === 'plan_approval').id, { decision: 'approved', by: 'test' });
  save(db);

  db = load();
  await caseWriter.run(db, 'SWAG-101');
  decideGate(db, db.gates.find(g => g.type === 'case_review').id, { decision: 'approved', by: 'test' });
  save(db);

  db = load();
  const { run } = await executor.run(db, 'SWAG-101', { driver: 'replay', platform: 'web' });
  save(db);

  for (const r of run.results) {
    if (r.autoAccepted) {
      assert.ok(r.evidence.length > 0, `${r.caseId} was auto-accepted with no evidence`);
      assert.equal(r.verdict, 'pass');
    }
  }
});

test('high-risk checkout cases are always reviewed by a person', async () => {
  const db = load();
  const run = db.runs.at(-1);
  const checkout = run.results.filter(r => r.area === 'checkout');
  assert.ok(checkout.length > 0, 'the run should include checkout cases');
  for (const r of checkout) {
    assert.ok(!r.autoAccepted, `${r.caseId} in an always-review area was auto-accepted`);
  }
});

test('a case pinned to one treatment is not run in the other', async () => {
  const db = load();
  const run = db.runs.at(-1);
  const all = testcases.all();
  for (const r of run.results) {
    const c = all.find(x => x.id === r.caseId);
    if (c?.treatment) assert.equal(r.treatment, c.treatment, `${c.id} ran in the wrong treatment`);
  }
});
