// Case writer agent: approved plan -> project test cases (one per acceptance
// criterion per treatment) plus the regression cases pulled into the project
// run because the tech investigation says they are in the blast radius.

import { jira, flags, testcases, confluence } from '../connectors/index.js';
import { complete } from '../llm/index.js';
import { getCaseFile, advance, openGate, isApproved, logEvent } from '../orchestrator/store.js';

// Areas named in the tech investigation's risk list drag their regression cases in.
function blastRadius(epic, docs) {
  const areas = new Set(epic.stories.map(s => s.area));
  const tech = docs.find(d => d.id.startsWith('TECH'));
  if (tech) {
    const body = tech.body.toLowerCase();
    for (const area of ['catalog', 'cart', 'auth', 'checkout', 'account', 'navigation']) {
      if (body.includes(area)) areas.add(area);
    }
  }
  return areas;
}

export async function run(db, key) {
  const cf = getCaseFile(db, key);
  if (!isApproved(db, key, 'plan_approval')) {
    throw new Error(`Plan for ${key} is not approved yet. Approve the plan_approval gate first: qa gates`);
  }

  const epic = jira.getEpic(key);
  const docs = (epic.confluence ?? []).map(id => confluence.getPage(id)).filter(Boolean);
  const flag = epic.flag ? flags.get(epic.flag) : null;

  const result = await complete({ task: 'test-cases', context: { epic, flag } });

  // Every generated case must cite a source story. One without is dropped and
  // reported, not silently kept.
  const valid = [];
  const unsourced = [];
  for (const c of result.cases) {
    if (!c.stories?.length) unsourced.push(c); else valid.push(c);
  }

  // Persist project cases into the repository, split by platform, as their own
  // reviewable file.
  const written = [];
  for (const platform of ['web', 'mobile']) {
    const subset = valid.filter(c => c.platform === platform);
    if (!subset.length) continue;
    written.push(testcases.writeProjectFile(`project-${key.toLowerCase()}`, {
      area: epic.stories.find(s => s.platform === platform)?.area ?? 'project',
      platform,
      epic: epic.key,
      flag: epic.flag ?? null,
      cases: subset
    }));
  }

  // Regression selection: existing cases whose area is in the blast radius.
  const areas = blastRadius(epic, docs);
  const regression = testcases.all()
    .filter(c => c.source === 'regression')
    .filter(c => areas.has(c.area) || (c.platform === 'mobile' && areas.has('checkout')))
    .filter(c => epic.platforms.includes(c.platform));

  cf.cases = valid.map(c => c.id);
  cf.regressionImpact = regression.map(c => c.id);
  cf.caseFiles = written;
  advance(db, key, 'case-design');
  logEvent(db, { actor: 'case-writer', action: 'cases-generated', subject: key, detail: `${valid.length} project, ${regression.length} regression` });

  const gate = openGate(db, {
    key,
    type: 'case_review',
    role: 'qa-lead',
    summary: `Spot-check ${valid.length} generated cases and ${regression.length} selected regression cases for ${key}`,
    payload: {
      files: written,
      projectCases: valid.length,
      regressionCases: regression.length,
      byTreatment: flag ? Object.fromEntries(flag.treatments.map(t => [t.key, valid.filter(c => c.treatment === t.key).length])) : null,
      unsourced: unsourced.map(c => c.title)
    }
  });

  return { generated: valid, regression, written, unsourced, gate };
}
