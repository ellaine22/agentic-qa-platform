// Executor agent: runs every in-scope case against every treatment, then
// applies the autonomy policy to decide which verdicts a person must review.
//
// The policy is the trust mechanism of the whole platform:
//   - a failure is always reviewed
//   - a pass below the confidence threshold is always reviewed
//   - an always-review area (payments, auth, pii) is always reviewed
//   - a deterministic sample of the remaining passes is reviewed
//   - a pass with no evidence is downgraded to needs-review, no exceptions

import crypto from 'node:crypto';
import { config, flags, testcases, jira } from '../connectors/index.js';
import { getCaseFile, advance, openGate, isApproved, logEvent } from '../orchestrator/store.js';
import * as replay from '../drivers/replay.js';
import * as cypress from '../drivers/cypress.js';
import * as maestro from '../drivers/maestro.js';

const drivers = { replay, cypress, maestro };

// Stable per-case sampling so a rerun reviews the same sample.
function sampled(caseId, rate) {
  const h = crypto.createHash('sha1').update(caseId).digest()[0];
  return (h / 255) < rate;
}

function applyPolicy(result, testCase, autonomy) {
  const reasons = [];
  if (result.verdict === 'fail') reasons.push('failure');
  if (result.verdict === 'not-automated') reasons.push('no automation for this case');
  if (result.verdict === 'pass') {
    if (result.confidence < autonomy.confidenceThreshold) reasons.push(`confidence ${result.confidence} below ${autonomy.confidenceThreshold}`);
    if (!result.evidence?.length) reasons.push('pass with no evidence');
    if (autonomy.alwaysReview.includes(testCase.area)) reasons.push(`${testCase.area} is an always-review area`);
    if (testCase.risk === 'high' && autonomy.level < 3) reasons.push('high risk case');
    if (!reasons.length && sampled(testCase.id, autonomy.reviewSampleRate)) reasons.push('audit sample');
  }
  const needsReview = reasons.length > 0;
  return {
    ...result,
    verdict: result.verdict === 'pass' && needsReview ? 'needs-review' : result.verdict,
    autoAccepted: result.verdict === 'pass' && !needsReview,
    reviewReasons: reasons
  };
}

function resolveCases(db, key) {
  const cf = getCaseFile(db, key);
  const all = testcases.all();
  const ids = new Set([...cf.cases, ...cf.regressionImpact]);
  const resolved = [...ids].map(id => all.find(c => c.id === id)).filter(Boolean);
  const missing = [...ids].filter(id => !all.find(c => c.id === id));
  return { resolved, missing };
}

export async function run(db, key, { driver = 'replay', platform = 'web' } = {}) {
  const cf = getCaseFile(db, key);
  if (!isApproved(db, key, 'case_review')) {
    throw new Error(`Cases for ${key} are not reviewed yet. Approve the case_review gate first: qa gates`);
  }

  const impl = drivers[driver];
  if (!impl) throw new Error(`Unknown driver "${driver}". Use one of: ${Object.keys(drivers).join(', ')}`);

  const { resolved, missing } = resolveCases(db, key);
  const cases = resolved.filter(c => c.platform === platform);
  if (!cases.length) throw new Error(`No ${platform} cases resolved for ${key}`);

  const epic = jira.getEpic(key);
  const flag = epic.flag ? flags.get(epic.flag) : null;
  const treatments = flag ? flag.treatments.map(t => t.key) : [null];

  const runId = `R-${key}-${Date.now().toString(36)}`;
  const autonomy = config.autonomy;
  const results = [];

  for (const treatment of treatments) {
    const override = treatment ? flags.override(flag.key, treatment) : { identity: null };
    // A case pinned to one treatment is only run in that treatment.
    const applicable = cases.filter(c => !c.treatment || c.treatment === treatment);
    const raw = await impl.run({
      cases: applicable,
      treatment,
      identity: override.identity,
      runId,
      platform,
      baseUrl: config.platforms[platform].baseUrl
    });
    for (const r of raw) {
      const testCase = applicable.find(c => c.id === r.caseId);
      results.push(applyPolicy(r, testCase, autonomy));
    }
  }

  const run = {
    id: runId,
    key,
    platform,
    driver,
    startedAt: new Date().toISOString(),
    autonomyLevel: autonomy.level,
    treatments,
    results,
    missingCases: missing,
    summary: {
      total: results.length,
      pass: results.filter(r => r.verdict === 'pass').length,
      fail: results.filter(r => r.verdict === 'fail').length,
      needsReview: results.filter(r => r.verdict === 'needs-review').length,
      notAutomated: results.filter(r => r.verdict === 'not-automated').length,
      autoAccepted: results.filter(r => r.autoAccepted).length
    }
  };

  db.runs.push(run);
  cf.runs.push(runId);
  advance(db, key, 'project-testing');
  logEvent(db, { actor: 'executor', action: 'run', subject: key, detail: `${runId} ${JSON.stringify(run.summary)}` });

  const gate = openGate(db, {
    key,
    type: 'execution_review',
    role: 'qa-lead',
    summary: `Review run ${runId}: ${run.summary.fail} failures, ${run.summary.needsReview} need review, ${run.summary.autoAccepted} auto-accepted`,
    payload: { runId, summary: run.summary }
  });

  return { run, gate };
}

// Human overturning a verdict. Recorded as evaluation data, not just edited.
export function review(db, runId, caseId, { verdict, by, note, treatment }) {
  const run = db.runs.find(r => r.id === runId);
  if (!run) throw new Error(`No run ${runId}`);
  const result = run.results.find(r => r.caseId === caseId && (!treatment || r.treatment === treatment));
  if (!result) throw new Error(`Run ${runId} has no result for ${caseId}${treatment ? ` (${treatment})` : ''}`);

  result.humanReview = {
    verdict,
    by,
    note: note ?? null,
    at: new Date().toISOString(),
    overturned: verdict !== result.verdict && !(result.verdict === 'needs-review' && verdict === 'pass')
  };
  logEvent(db, { actor: by, action: 'verdict-review', subject: `${runId}/${caseId}`, detail: `${result.verdict} -> ${verdict}` });
  return result;
}
