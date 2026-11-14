// Coverage agent. Four layers, all computed, none hand-maintained:
//
//   requirements - acceptance criteria with at least one linked case
//   cases        - cases with an @case tag found in a spec file
//   features     - routes and screens exercised by at least one covered case
//   code         - statement coverage from an instrumented run (read from an
//                  nyc/istanbul summary when one exists)
//
// Gaps are ranked by risk = churn, defect history and traffic, so the list is
// ordered by what is worth testing next rather than alphabetically.

import fs from 'node:fs';
import path from 'node:path';
import { testcases, git, jira, config, inventory } from '../connectors/index.js';
import { ROOT, logEvent } from '../orchestrator/store.js';

const CASE_TAG = /@case:([A-Z0-9-]+)/g;

// A tag alone is not coverage. A spec block that still carries a TODO has not
// been finished by an engineer, so it is recorded as a draft and counted
// separately. This is the difference between "the agent wrote something" and
// "this case is actually tested".
export function taggedCases() {
  const map = new Map();

  const record = (id, path, draft) => {
    if (!map.has(id)) map.set(id, { specs: [], draft: true });
    const entry = map.get(id);
    entry.specs.push(path);
    // Any one finished block is enough to call the case automated.
    if (!draft) entry.draft = false;
  };

  for (const spec of git.specs()) {
    const isJs = spec.path.endsWith('.cy.js');
    if (isJs) {
      // Split on test blocks so a TODO in one test does not condemn its neighbours.
      const blocks = spec.text.split(/\n(?=\s*it\()/);
      for (const block of blocks) {
        for (const m of block.matchAll(CASE_TAG)) record(m[1], spec.path, /TODO/.test(block));
      }
    } else {
      // Maestro flows are tagged at file level.
      for (const m of spec.text.matchAll(CASE_TAG)) record(m[1], spec.path, /TODO/.test(spec.text));
    }
  }
  return map;
}

const isAutomated = (tagged, id) => Boolean(tagged.get(id) && !tagged.get(id).draft);

function codeCoverage() {
  // Produced by an instrumented build: `nyc report --reporter=json-summary`.
  const file = path.join(ROOT, 'out/coverage/coverage-summary.json');
  if (!fs.existsSync(file)) return null;
  const summary = JSON.parse(fs.readFileSync(file, 'utf8'));
  const total = summary.total ?? {};
  return {
    statements: total.statements?.pct ?? null,
    branches: total.branches?.pct ?? null,
    source: path.relative(ROOT, file)
  };
}

function riskScore(entry) {
  const w = config.coverage.riskWeights;
  // Normalised against the loose ceilings these signals sit under in practice.
  const churn = Math.min(entry.churn30d / 30, 1);
  const defects = Math.min(entry.defects90d / 5, 1);
  const traffic = entry.traffic / 100;
  return Number((churn * w.churn + defects * w.defects + traffic * w.traffic).toFixed(3));
}

export function compute(db, { epicKeys = [] } = {}) {
  const all = testcases.all();
  const tagged = taggedCases();
  const inv = inventory();

  // --- cases ---
  const caseRows = all.map(c => ({
    id: c.id,
    platform: c.platform,
    area: c.area,
    priority: c.priority,
    risk: c.risk,
    source: c.source,
    flag: c.flag ?? null,
    treatment: c.treatment ?? null,
    automated: isAutomated(tagged, c.id),
    draft: Boolean(tagged.get(c.id)?.draft),
    specs: tagged.get(c.id)?.specs ?? []
  }));
  const automated = caseRows.filter(c => c.automated);
  const drafts = caseRows.filter(c => c.draft);

  // Tags that point at a case that no longer exists: dead automation.
  const orphanTags = [...tagged.keys()].filter(id => !all.find(c => c.id === id))
    .map(id => ({ id, specs: tagged.get(id).specs }));

  // --- requirements ---
  const requirements = [];
  for (const key of epicKeys) {
    let epic;
    try { epic = jira.getEpic(key); } catch { continue; }
    for (const story of epic.stories) {
      const linked = all.filter(c => (c.stories ?? []).includes(story.key));
      requirements.push({
        epic: epic.key,
        story: story.key,
        summary: story.summary,
        platform: story.platform,
        criteria: story.acceptanceCriteria.length,
        linkedCases: linked.map(c => c.id),
        covered: linked.length > 0,
        automatedCases: linked.filter(c => isAutomated(tagged, c.id)).length
      });
    }
  }

  // --- features ---
  const featureRows = [];
  for (const platform of ['web', 'mobile']) {
    for (const entry of inv[platform]) {
      const caseIds = inv.featureToCases[entry.route] ?? [];
      const covered = caseIds.length > 0;
      featureRows.push({
        platform,
        route: entry.route,
        feature: entry.feature,
        area: entry.area,
        caseIds,
        covered,
        automatedCases: caseIds.filter(id => isAutomated(tagged, id)).length,
        risk: riskScore(entry)
      });
    }
  }

  const gaps = featureRows
    .filter(f => !f.covered || f.automatedCases === 0)
    .sort((a, b) => b.risk - a.risk)
    .map(f => ({
      route: f.route,
      platform: f.platform,
      feature: f.feature,
      risk: f.risk,
      reason: !f.covered ? 'no test case exercises this feature' : 'cases exist but none are automated'
    }));

  const ratio = (n, d) => (d === 0 ? 0 : Number((n / d).toFixed(4)));

  const snapshot = {
    at: new Date().toISOString(),
    requirements: {
      total: requirements.length,
      covered: requirements.filter(r => r.covered).length,
      ratio: ratio(requirements.filter(r => r.covered).length, requirements.length),
      target: config.coverage.targets.requirements,
      rows: requirements
    },
    cases: {
      total: caseRows.length,
      automated: automated.length,
      draft: drafts.length,
      ratio: ratio(automated.length, caseRows.length),
      target: config.coverage.targets.cases,
      byPlatform: ['web', 'mobile'].map(p => {
        const subset = caseRows.filter(c => c.platform === p);
        return { platform: p, total: subset.length, automated: subset.filter(c => c.automated).length, draft: subset.filter(c => c.draft).length, ratio: ratio(subset.filter(c => c.automated).length, subset.length) };
      }),
      byArea: [...new Set(caseRows.map(c => c.area))].map(area => {
        const subset = caseRows.filter(c => c.area === area);
        return { area, total: subset.length, automated: subset.filter(c => c.automated).length, draft: subset.filter(c => c.draft).length, ratio: ratio(subset.filter(c => c.automated).length, subset.length) };
      }).sort((a, b) => a.ratio - b.ratio),
      rows: caseRows,
      orphanTags
    },
    features: {
      total: featureRows.length,
      covered: featureRows.filter(f => f.covered).length,
      ratio: ratio(featureRows.filter(f => f.covered).length, featureRows.length),
      target: config.coverage.targets.features,
      rows: featureRows
    },
    code: codeCoverage(),
    gaps
  };

  db.coverage.push({
    at: snapshot.at,
    requirements: snapshot.requirements.ratio,
    cases: snapshot.cases.ratio,
    features: snapshot.features.ratio,
    code: snapshot.code?.statements ?? null,
    totalCases: snapshot.cases.total,
    automatedCases: snapshot.cases.automated,
    draftCases: snapshot.cases.draft
  });
  logEvent(db, { actor: 'coverage', action: 'snapshot', subject: 'all', detail: `cases ${(snapshot.cases.ratio * 100).toFixed(0)}%` });

  return snapshot;
}
