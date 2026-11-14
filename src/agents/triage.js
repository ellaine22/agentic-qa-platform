// Triage agent: failures from a run -> clusters -> drafted Jira bugs.
// Bugs are drafted, never created. Creation happens when a person approves
// them, which keeps a hallucinated defect out of the backlog.

import { jira, config } from '../connectors/index.js';
import { complete } from '../llm/index.js';
import { getCaseFile, logEvent } from '../orchestrator/store.js';

export async function run(db, key, runId) {
  const cf = getCaseFile(db, key);
  const run = db.runs.find(r => r.id === (runId ?? cf.runs[cf.runs.length - 1]));
  if (!run) throw new Error(`No run to triage for ${key}`);

  const failures = run.results.filter(r => r.verdict === 'fail');
  if (!failures.length) return { clusters: [], bugs: [], run: run.id };

  const { clusters } = await complete({
    task: 'triage',
    context: {
      failures: failures.map(f => ({
        caseId: f.caseId, area: f.area, treatment: f.treatment,
        failure: f.failure, evidence: f.evidence.map(e => e.path)
      }))
    }
  });

  const bugs = [];
  for (const cluster of clusters) {
    // Deduplicate against bugs already drafted for the same signature.
    const existing = db.bugs.find(b => b.signature === cluster.signature && b.key === key);
    if (existing) {
      existing.caseIds = [...new Set([...existing.caseIds, ...cluster.caseIds])];
      existing.seenInRuns = [...new Set([...existing.seenInRuns, run.id])];
      continue;
    }

    const evidence = failures
      .filter(f => cluster.caseIds.includes(f.caseId))
      .flatMap(f => f.evidence.map(e => e.path));

    const draft = jira.draftBug({
      project: config.connectors.jira.projectKey,
      summary: cluster.summary,
      description:
        `Found by the triage agent from run ${run.id}.\n\n` +
        `Failing cases: ${cluster.caseIds.join(', ')}\n` +
        `Treatments: ${cluster.treatments.join(', ') || 'n/a'}\n` +
        `Areas: ${cluster.areas.join(', ')}\n\n` +
        `Signature: ${cluster.signature}\n\n` +
        `Evidence:\n${evidence.map(e => `- ${e}`).join('\n')}`,
      severity: cluster.severity,
      labels: ['agentic-qa', `flag:${cf.flag ?? 'none'}`, ...(cluster.treatmentSpecific ? ['treatment-specific'] : [])],
      evidence
    });

    const bug = {
      id: `BUG-${String(db.bugs.length + 1).padStart(3, '0')}`,
      key,
      signature: cluster.signature,
      summary: cluster.summary,
      severity: cluster.severity,
      treatments: cluster.treatments,
      treatmentSpecific: cluster.treatmentSpecific,
      areas: cluster.areas,
      caseIds: cluster.caseIds,
      seenInRuns: [run.id],
      status: 'draft',
      draft,
      createdAt: new Date().toISOString()
    };
    db.bugs.push(bug);
    cf.bugs.push(bug.id);
    bugs.push(bug);
  }

  logEvent(db, { actor: 'triage', action: 'clustered', subject: key, detail: `${failures.length} failures -> ${clusters.length} clusters` });
  return { clusters, bugs, run: run.id };
}
