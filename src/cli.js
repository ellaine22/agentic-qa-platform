#!/usr/bin/env node
// qa — the orchestrator's command line.
//
//   qa intake SWAG-101            plan the project from its epic
//   qa gates                      what is waiting on a person
//   qa gate approve G-001 --by me
//   qa cases SWAG-101             generate project cases + regression selection
//   qa run SWAG-101 [--driver replay|cypress|maestro] [--platform web|mobile]
//   qa review R-... WEB-101-001 --verdict pass --by me [--treatment express]
//   qa triage SWAG-101
//   qa release SWAG-101
//   qa rollout                    scan flags for promotions and flag debt
//   qa promote express_checkout express
//   qa automate SWAG-101 [--platform web]
//   qa coverage [--epic SWAG-101]
//   qa report
//   qa demo                       run the whole lifecycle end to end
//   qa reset

import { load, save, getCaseFile, decideGate, STAGES } from './orchestrator/store.js';
import { reset as resetWorkspace } from './orchestrator/workspace.js';
import { testcases, config } from './connectors/index.js';
import * as planner from './agents/planner.js';
import * as caseWriter from './agents/caseWriter.js';
import * as executor from './agents/executor.js';
import * as triage from './agents/triage.js';
import * as release from './agents/release.js';
import * as rolloutWatcher from './agents/rolloutWatcher.js';
import * as automation from './agents/automation.js';
import * as coverageAgent from './agents/coverage.js';
import { build as buildDashboard } from './report/dashboard.js';
import { complete } from './llm/index.js';
import { providerName } from './llm/index.js';

const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = argv.slice(1).filter(a => !a.startsWith('--'));
const flagsOf = Object.fromEntries(
  argv.filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    const idx = argv.indexOf(a);
    return [k, v ?? (argv[idx + 1] && !argv[idx + 1].startsWith('--') ? argv[idx + 1] : true)];
  })
);
// Values consumed as `--key value` must not also count as positionals.
const consumed = new Set(Object.values(flagsOf).filter(v => typeof v === 'string'));
const args = positional.filter(p => !consumed.has(p));

const log = (...a) => console.log(...a);
const bold = s => `\x1b[1m${s}\x1b[0m`;
const dim = s => `\x1b[2m${s}\x1b[0m`;

function needKey() {
  const key = args[0];
  if (!key) throw new Error(`This command needs a project key, e.g. ${cmd} SWAG-101`);
  return key;
}

async function main() {
  switch (cmd) {
    case 'intake': {
      const db = load();
      const { page, gate, plan } = await planner.run(db, needKey());
      save(db);
      log(bold(`Test plan published: ${page.url}`));
      log(plan.sections.map(s => `  · ${s.heading}`).join('\n'));
      log(dim(`\nGate ${gate.id} is open: ${gate.summary}`));
      log(dim(`  qa gate approve ${gate.id} --by you`));
      break;
    }

    case 'cases': {
      const db = load();
      const r = await caseWriter.run(db, needKey());
      save(db);
      log(bold(`${r.generated.length} project cases generated, ${r.regression.length} regression cases selected`));
      for (const f of r.written) log(`  wrote ${f}`);
      const byTreatment = {};
      for (const c of r.generated) byTreatment[c.treatment ?? 'none'] = (byTreatment[c.treatment ?? 'none'] ?? 0) + 1;
      log(`  by treatment: ${Object.entries(byTreatment).map(([k, v]) => `${k}=${v}`).join(' ')}`);
      if (r.unsourced.length) log(`  dropped ${r.unsourced.length} case(s) with no source story`);
      log(dim(`\nGate ${r.gate.id} is open: ${r.gate.summary}`));
      break;
    }

    case 'run': {
      const db = load();
      const { run, gate } = await executor.run(db, needKey(), {
        driver: flagsOf.driver || 'replay',
        platform: flagsOf.platform || 'web'
      });
      save(db);
      log(bold(`Run ${run.id} (${run.driver}) — ${run.summary.total} results across ${run.treatments.length} treatment(s)`));
      log(`  pass ${run.summary.pass} · fail ${run.summary.fail} · needs review ${run.summary.needsReview} · auto-accepted ${run.summary.autoAccepted}`);
      for (const r of run.results.filter(r => r.verdict === 'fail')) {
        log(`  FAIL ${r.caseId} [${r.treatment}] ${r.failure.message}`);
      }
      log(dim(`\nGate ${gate.id} is open: ${gate.summary}`));
      break;
    }

    case 'review': {
      const db = load();
      const [runId, caseId] = args;
      const r = executor.review(db, runId, caseId, {
        verdict: flagsOf.verdict,
        by: flagsOf.by || 'unknown',
        note: flagsOf.note,
        treatment: flagsOf.treatment
      });
      save(db);
      log(`${caseId}: agent said ${r.verdict}, human recorded ${r.humanReview.verdict}${r.humanReview.overturned ? ' (overturned)' : ''}`);
      break;
    }

    case 'triage': {
      const db = load();
      const r = await triage.run(db, needKey(), flagsOf.run);
      save(db);
      log(bold(`${r.clusters.length} cluster(s) from run ${r.run}`));
      for (const b of r.bugs) log(`  ${b.id} [${b.severity}] ${b.summary}  (${b.treatmentSpecific ? b.treatments.join(',') + ' only' : 'both treatments'})`);
      if (!r.bugs.length && r.clusters.length) log(dim('  all clusters already drafted'));
      break;
    }

    case 'release': {
      const db = load();
      const r = await release.run(db, needKey(), { testcases });
      save(db);
      log(bold(`Recommendation: ${r.recommendation.toUpperCase()}`));
      for (const c of r.checks) log(`  ${c.ok ? 'pass   ' : 'BLOCKED'} ${c.describe}${c.detail ? ` — ${c.detail}` : ''}`);
      log(`\n  dashboard: ${r.page.url}`);
      log(dim(`  Gate ${r.gate.id} is open`));
      break;
    }

    case 'rollout': {
      const db = load();
      const findings = rolloutWatcher.scan(db);
      save(db);
      if (!findings.length) log('No flag findings.');
      for (const f of findings) log(`  [${f.type}] ${f.flag}: ${f.detail}`);
      break;
    }

    case 'promote': {
      const db = load();
      const [flagKey, winner] = args;
      if (!flagKey || !winner) throw new Error('Usage: qa promote <flag> <winning-treatment>');
      const r = automation.promote(db, flagKey, winner);
      save(db);
      log(bold(`Promoted ${winner} for ${flagKey}`));
      r.kept.forEach(f => log(`  kept    ${f}`));
      r.removed.forEach(f => log(`  removed ${f}`));
      log(dim(`  ${r.flagCleanup}`));
      break;
    }

    case 'automate': {
      const db = load();
      const r = automation.generate(db, needKey(), { platform: flagsOf.platform || 'web' });
      save(db);
      for (const w of r.written) log(`  wrote ${w.file}  (${w.cases.length} case(s), treatment ${w.treatment})`);
      log(dim(`\n  ${r.note}`));
      break;
    }

    case 'coverage': {
      const db = load();
      const epicKeys = flagsOf.epic ? [flagsOf.epic] : Object.values(db.caseFiles).map(cf => cf.epic);
      const snapshot = coverageAgent.compute(db, { epicKeys });
      save(db);
      log(bold('Coverage'));
      log(`  requirements  ${(snapshot.requirements.ratio * 100).toFixed(0)}%  (${snapshot.requirements.covered}/${snapshot.requirements.total} stories)`);
      log(`  test cases    ${(snapshot.cases.ratio * 100).toFixed(0)}%  (${snapshot.cases.automated}/${snapshot.cases.total} automated)`);
      log(`  features      ${(snapshot.features.ratio * 100).toFixed(0)}%  (${snapshot.features.covered}/${snapshot.features.total} routes)`);
      log(`  code          ${snapshot.code ? snapshot.code.statements + '%' : 'no instrumented run'}`);
      log('\n  top gaps:');
      for (const g of snapshot.gaps.slice(0, 5)) log(`    ${g.risk.toFixed(2)}  ${g.route.padEnd(26)} ${g.reason}`);
      if (snapshot.cases.orphanTags.length) {
        log('\n  dead automation (tag with no case):');
        for (const o of snapshot.cases.orphanTags) log(`    ${o.id} in ${o.specs.join(', ')}`);
      }
      break;
    }

    case 'report': {
      const db = load();
      const epicKeys = Object.values(db.caseFiles).map(cf => cf.epic);
      const snapshot = coverageAgent.compute(db, { epicKeys });
      const { summary } = await complete({
        task: 'summary',
        context: { coverage: snapshot, runs: db.runs, bugs: db.bugs, gates: db.gates }
      });
      const out = buildDashboard(db, snapshot, { summary });
      save(db);
      log(bold(`Dashboard: ${out}`));
      log(dim(`  ${summary}`));
      break;
    }

    case 'gates': {
      const db = load();
      const open = db.gates.filter(g => g.status === 'open');
      if (!open.length) { log('No open gates.'); break; }
      for (const g of open) log(`  ${bold(g.id)} [${g.type}] ${g.role}\n     ${g.summary}\n     ${dim(`qa gate approve ${g.id} --by you`)}`);
      break;
    }

    case 'gate': {
      const db = load();
      const [action, id] = args;
      if (!['approve', 'reject'].includes(action)) throw new Error('Usage: qa gate approve|reject <id> --by <name>');
      const g = decideGate(db, id, { decision: action === 'approve' ? 'approved' : 'rejected', by: flagsOf.by || 'unknown', note: flagsOf.note });
      save(db);
      log(`${g.id} ${g.status} by ${g.decidedBy}`);
      break;
    }

    case 'status': {
      const db = load();
      for (const cf of Object.values(db.caseFiles)) {
        const i = STAGES.indexOf(cf.stage);
        log(`${bold(cf.key)}  ${cf.stage}  ${STAGES.map((s, n) => (n <= i ? '●' : '○')).join('')}`);
        log(`  flag ${cf.flag ?? 'none'} · ${cf.cases.length} project cases · ${cf.regressionImpact.length} regression · ${cf.runs.length} run(s) · ${cf.bugs.length} bug(s)`);
      }
      const open = db.gates.filter(g => g.status === 'open');
      log(`\n${open.length} open gate(s). LLM provider: ${providerName()}. Autonomy level ${config.autonomy.level}.`);
      break;
    }

    case 'reset': {
      const r = resetWorkspace();
      log(`Store reset. Removed ${r.removed.length} generated file(s), restored seeded flag state and treatment specs.`);
      break;
    }

    case 'demo': {
      await demo();
      break;
    }

    default:
      log(`qa — agentic QA platform

  qa intake <EPIC>                 plan the project from its epic and docs
  qa cases <EPIC>                  generate project cases + regression selection
  qa run <EPIC> [--driver replay|cypress|maestro] [--platform web|mobile]
  qa review <RUN> <CASE> --verdict pass|fail --by <name> [--treatment <t>]
  qa triage <EPIC>                 cluster failures into drafted bugs
  qa release <EPIC>                go/no-go recommendation + dashboard
  qa rollout                       scan flags for promotions and flag debt
  qa promote <flag> <treatment>    keep the winner's specs, delete the loser's
  qa automate <EPIC> [--platform]  generate tagged specs from executed cases
  qa coverage [--epic <EPIC>]      four-layer coverage snapshot
  qa report                        build out/dashboard.html
  qa gates | qa gate approve <ID> --by <name>
  qa status | qa reset | qa demo`);
  }
}

// --- End-to-end demo ---------------------------------------------------

async function demo() {
  const KEY = 'SWAG-101';
  const step = (n, t) => log(`\n${bold(`${n}. ${t}`)}\n${'─'.repeat(60)}`);

  resetWorkspace();

  step(1, 'Planner reads the epic, stories and Confluence docs');
  { const db = load(); const r = await planner.run(db, KEY); save(db);
    log(`   plan: ${r.page.url} (${r.plan.sections.length} sections, sources: ${r.plan.sources.length})`);
    log(`   gate ${r.gate.id} opened — plan_approval`); }

  step(2, 'QA lead approves the plan');
  { const db = load(); const g = db.gates.find(x => x.type === 'plan_approval' && x.status === 'open');
    decideGate(db, g.id, { decision: 'approved', by: 'ellaine', note: 'Scope and risks match the tech doc' }); save(db);
    log(`   ${g.id} approved by ellaine`); }

  step(3, 'Case writer generates cases for both treatments');
  { const db = load(); const r = await caseWriter.run(db, KEY); save(db);
    log(`   ${r.generated.length} project cases, ${r.regression.length} regression cases pulled in by blast radius`);
    log(`   files: ${r.written.join(', ')}`);
    log(`   gate ${r.gate.id} opened — case_review`); }

  step(4, 'QA lead spot-checks the cases');
  { const db = load(); const g = db.gates.find(x => x.type === 'case_review' && x.status === 'open');
    decideGate(db, g.id, { decision: 'approved', by: 'ellaine' }); save(db);
    log(`   ${g.id} approved`); }

  step(5, 'Executor runs every case against both treatments');
  { const db = load(); const { run } = await executor.run(db, KEY, { driver: 'replay', platform: 'web' }); save(db);
    log(`   ${run.id}: ${run.summary.pass} pass · ${run.summary.fail} fail · ${run.summary.needsReview} need review · ${run.summary.autoAccepted} auto-accepted`);
    const failures = run.results.filter(r => r.verdict === 'fail');
    log(`   failures are ${[...new Set(failures.map(f => f.treatment))].join(', ')}-only, which is the signal the treatment is at fault:`);
    for (const f of failures.slice(0, 4)) log(`     ${f.caseId} [${f.treatment}] ${f.failure.message.slice(0, 90)}`); }

  step(6, 'Triage clusters the failures into drafted bugs');
  { const db = load(); const r = await triage.run(db, KEY); save(db);
    log(`   ${r.clusters.length} distinct defect(s) from ${r.clusters.reduce((n, c) => n + c.caseIds.length, 0)} failing results`);
    for (const b of r.bugs) log(`     ${b.id} [${b.severity}] ${b.summary}`); }

  step(7, 'Release agent gives a go/no-go');
  { const db = load(); const r = await release.run(db, KEY, { testcases }); save(db);
    log(`   recommendation: ${bold(r.recommendation.toUpperCase())}`);
    for (const c of r.checks) log(`     ${c.ok ? 'pass   ' : 'BLOCKED'} ${c.describe}${c.detail ? ` — ${c.detail}` : ''}`); }

  step(8, 'Automation agent writes tagged specs from the executed cases');
  { const db = load(); const r = automation.generate(db, KEY, { platform: 'web' }); save(db);
    for (const w of r.written) log(`   ${w.file} — ${w.cases.length} case(s), treatment ${w.treatment}`); }

  step(9, 'Coverage recomputed from the spec tags');
  { const db = load(); const s = coverageAgent.compute(db, { epicKeys: [KEY] }); save(db);
    log(`   requirements ${(s.requirements.ratio * 100).toFixed(0)}% · cases ${(s.cases.ratio * 100).toFixed(0)}% (${s.cases.automated}/${s.cases.total}) · features ${(s.features.ratio * 100).toFixed(0)}%`);
    log(`   top gap: ${s.gaps[0]?.route} (risk ${s.gaps[0]?.risk}) — ${s.gaps[0]?.reason}`); }

  step(10, 'Rollout watcher scans the flags');
  { const db = load(); const findings = rolloutWatcher.scan(db); save(db);
    for (const f of findings) log(`   [${f.type}] ${f.flag}: ${f.detail}`); }

  step(11, 'A concluded experiment is promoted and the loser is cleaned up');
  { const db = load(); const r = automation.promote(db, 'sorted_catalog', 'on'); save(db);
    log(`   kept ${r.kept.length} spec(s), removed ${r.removed.length}`);
    log(`   ${r.flagCleanup}`); }

  step(12, 'Dashboard');
  { const db = load();
    const s = coverageAgent.compute(db, { epicKeys: [KEY] });
    const { summary } = await complete({ task: 'summary', context: { coverage: s, runs: db.runs, bugs: db.bugs, gates: db.gates } });
    const out = buildDashboard(db, s, { summary }); save(db);
    log(`   ${out}`);
    log(`\n   ${summary}`); }

  log(`\n${bold('Open gates still waiting on a person:')}`);
  { const db = load(); for (const g of db.gates.filter(x => x.status === 'open')) log(`   ${g.id} [${g.type}] ${g.summary}`); }
  log(dim('\nEverything above ran with the local provider and the replay driver — no network, no API key.'));
}

main().catch(err => {
  console.error(`\x1b[31merror:\x1b[0m ${err.message}`);
  process.exitCode = 1;
});
