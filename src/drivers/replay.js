// Replay driver: executes cases against recorded behaviour of the public demo
// site instead of a live browser. Deterministic, offline, and honest about it:
// every result it produces is labelled driver "replay" and its evidence says
// "recorded", never "captured".
//
// Use it to develop and demo the pipeline. Use the cypress driver for real runs.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../orchestrator/store.js';

const behaviours = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/replay/behaviours.json'), 'utf8'));

function matches(defect, testCase) {
  const w = defect.when ?? {};
  if (w.area && w.area !== testCase.area) return false;
  if (w.tagsInclude && !w.tagsInclude.some(t => (testCase.tags ?? []).includes(t))) return false;
  if (w.titleMatches) {
    const haystack = [testCase.title, ...(testCase.steps ?? []).map(s => `${s.action} ${s.expect}`)]
      .join(' ')
      .toLowerCase();
    if (!w.titleMatches.some(m => haystack.includes(m.toLowerCase()))) return false;
  }
  return true;
}

function confidenceFor(testCase, passed) {
  const text = [testCase.title, ...(testCase.steps ?? []).map(s => s.expect ?? '')].join(' ').toLowerCase();
  let c = passed ? 0.95 : 0.92;
  for (const phrase of behaviours.lowConfidencePhrases) {
    if (text.includes(phrase)) { c -= 0.15; break; }
  }
  if ((testCase.steps ?? []).length > 2) c -= 0.03;
  return Math.max(0.4, Number(c.toFixed(2)));
}

export const name = 'replay';

export async function run({ cases, treatment, identity, runId, platform }) {
  const profile = behaviours.identities[identity?.username] ?? { defects: [] };
  const evidenceDir = path.join(ROOT, 'out', 'evidence', runId);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const results = [];
  for (const testCase of cases) {
    const defect = profile.defects.find(d => matches(d, testCase));
    const passed = !defect;
    const steps = (testCase.steps ?? []).map((s, i) => ({
      action: s.action,
      ok: passed || i < (testCase.steps.length - 1),
      note: !passed && i === testCase.steps.length - 1 ? defect.message : null
    }));

    const evidenceName = `${testCase.id}${treatment ? `-${treatment}` : ''}.json`;
    const evidence = {
      recorded: true,
      driver: 'replay',
      caseId: testCase.id,
      platform,
      treatment: treatment ?? null,
      identity: identity?.username ?? null,
      observed: defect?.observed ?? `All expectations in "${testCase.title}" held for identity ${identity?.username}`,
      steps
    };
    fs.writeFileSync(path.join(evidenceDir, evidenceName), JSON.stringify(evidence, null, 2));

    results.push({
      caseId: testCase.id,
      area: testCase.area,
      platform: testCase.platform,
      risk: testCase.risk,
      treatment: treatment ?? null,
      verdict: passed ? 'pass' : 'fail',
      confidence: confidenceFor(testCase, passed),
      durationMs: (profile.latencyMs ?? 0) + 400 + testCase.id.length * 7,
      steps,
      evidence: [{ type: 'observation', recorded: true, path: path.relative(ROOT, path.join(evidenceDir, evidenceName)) }],
      failure: passed ? null : { signature: defect.signature, message: defect.message },
      driver: 'replay'
    });
  }

  return results;
}
