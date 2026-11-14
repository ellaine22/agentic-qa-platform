// Builds out/dashboard.html: one page showing what needs a person right now,
// then coverage, then the evidence behind the last run.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../orchestrator/store.js';
import { flags } from '../connectors/index.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = n => `${(Number(n ?? 0) * 100).toFixed(0)}%`;

function meter(label, value, target, detail) {
  const ok = value >= target;
  return `
  <div class="meter">
    <div class="meter-head"><span>${esc(label)}</span><b class="${ok ? 'ok' : 'under'}">${pct(value)}</b></div>
    <div class="track"><i style="width:${Math.min(100, value * 100).toFixed(1)}%"></i><u style="left:${Math.min(100, target * 100).toFixed(1)}%"></u></div>
    <div class="meter-foot">${esc(detail)} · target ${pct(target)}</div>
  </div>`;
}

export function build(db, coverage, { summary } = {}) {
  const runs = db.runs;
  const lastRun = runs.at(-1);
  const openGates = db.gates.filter(g => g.status === 'open');
  const reviewQueue = lastRun
    ? lastRun.results.filter(r => (r.verdict === 'needs-review' || r.verdict === 'fail') && !r.humanReview)
    : [];
  const bugs = db.bugs;
  const caseFiles = Object.values(db.caseFiles);
  const release = caseFiles.map(cf => cf.decisions?.release).filter(Boolean).at(-1);

  const reviewed = runs.flatMap(r => r.results).filter(r => r.humanReview);
  const overturned = reviewed.filter(r => r.humanReview.overturned);
  const agreement = reviewed.length ? 1 - overturned.length / reviewed.length : null;

  const flagRows = flags.all();

  const verdictClass = v => ({ pass: 'v-pass', fail: 'v-fail', 'needs-review': 'v-review', 'not-automated': 'v-none' }[v] ?? '');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA control room</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --paper:#F1F3F0; --panel:#FFFFFF; --ink:#16242E; --dim:#5E6E78; --rule:#D2D9D5;
  --signal:#A85A09; --signal-bg:#FBEEDC; --ok:#1F6B4E; --ok-bg:#DFEFE6; --bad:#A32C21; --bad-bg:#F8E2DF; --none:#6B7A84;
}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
  --paper:#101A20; --panel:#17242C; --ink:#E3EAE8; --dim:#93A4AE; --rule:#2A3B44;
  --signal:#E3A248; --signal-bg:#352714; --ok:#5FBE93; --ok-bg:#15312A; --bad:#E58A7D; --bad-bg:#3A1F1C; --none:#8396A1;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 "IBM Plex Sans",system-ui,sans-serif}
code,.mono,td.id,.num{font-family:"IBM Plex Mono",ui-monospace,monospace}
.wrap{max-width:1200px;margin:0 auto;padding:28px 22px 72px}
header.top{display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;justify-content:space-between;border-bottom:2px solid var(--ink);padding-bottom:12px}
header.top h1{font-size:1.5rem;margin:0;letter-spacing:-.01em}
header.top .meta{color:var(--dim);font-size:13px}

.verdict{margin:26px 0 8px;padding:20px 22px;border:1px solid var(--rule);border-left:6px solid var(--signal);background:var(--panel)}
.verdict.go{border-left-color:var(--ok)}
.verdict h2{margin:0 0 6px;font-size:1.3rem}
.verdict p{margin:0;color:var(--dim);max-width:75ch}
.verdict ul{margin:10px 0 0;padding-left:1.1em;color:var(--bad)}

.cols{display:grid;gap:26px;margin-top:26px}
@media(min-width:960px){.cols{grid-template-columns:minmax(0,1fr) 330px}}

section{margin-bottom:30px}
h3{font-size:1.02rem;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid var(--rule)}
p.note{color:var(--dim);font-size:13.5px;margin:0 0 10px}

.meters{display:grid;gap:14px}
@media(min-width:620px){.meters{grid-template-columns:repeat(2,1fr)}}
.meter-head{display:flex;justify-content:space-between;align-items:baseline;font-size:14px}
.meter-head b{font-family:"IBM Plex Mono",monospace;font-size:1.15rem}
.meter-head b.ok{color:var(--ok)} .meter-head b.under{color:var(--signal)}
.track{position:relative;height:8px;background:var(--rule);margin:6px 0 4px}
.track i{position:absolute;left:0;top:0;bottom:0;background:var(--ink);display:block}
.track u{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--signal)}
.meter-foot{color:var(--dim);font-size:12.5px}

table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font-weight:600;color:var(--dim);border-bottom:1px solid var(--rule);padding:6px 8px 6px 0;font-size:12.5px}
td{padding:7px 8px 7px 0;border-bottom:1px solid var(--rule);vertical-align:top}
td.id{white-space:nowrap;font-size:12.5px}
.v-pass{color:var(--ok)} .v-fail{color:var(--bad);font-weight:600} .v-review{color:var(--signal);font-weight:600} .v-none{color:var(--none)}
.pill{display:inline-block;padding:1px 7px;font-size:11.5px;font-family:"IBM Plex Mono",monospace;border:1px solid var(--rule)}
.pill.sig{background:var(--signal-bg);border-color:var(--signal);color:var(--signal)}
.pill.ok{background:var(--ok-bg);border-color:var(--ok);color:var(--ok)}
.pill.bad{background:var(--bad-bg);border-color:var(--bad);color:var(--bad)}

aside .block{background:var(--panel);border:1px solid var(--rule);padding:14px 16px;margin-bottom:18px}
aside h4{margin:0 0 8px;font-size:.95rem}
aside ul{margin:0;padding-left:1.05em;font-size:13.5px}
aside li{margin-bottom:7px}
aside .empty{color:var(--dim);font-size:13.5px;margin:0}
.cmd{display:block;font-family:"IBM Plex Mono",monospace;font-size:12px;background:var(--paper);border:1px solid var(--rule);padding:4px 7px;margin-top:4px;overflow-x:auto;white-space:nowrap}
footer{margin-top:40px;border-top:1px solid var(--rule);padding-top:12px;color:var(--dim);font-size:12.5px}
</style>
</head>
<body>
<div class="wrap">
<header class="top">
  <h1>QA control room</h1>
  <div class="meta">Generated ${esc(new Date().toISOString().replace('T', ' ').slice(0, 16))} UTC · ${runs.length} run(s) · ${caseFiles.length} project(s)</div>
</header>

${release ? `
<div class="verdict ${release.recommendation === 'go' ? 'go' : ''}">
  <h2>${release.recommendation === 'go' ? 'Go' : 'No-go'} — ${esc(caseFiles.at(-1)?.key ?? '')}</h2>
  <p>${release.recommendation === 'go'
      ? 'Every release rule passed. Sign-off at the release_signoff gate still applies.'
      : 'The release agent is blocking on the rules below. Each one is a rule, not a judgement, so it can be argued with or changed in config/platform.json.'}</p>
  ${release.checks.filter(c => !c.ok).length ? `<ul>${release.checks.filter(c => !c.ok).map(c => `<li>${esc(c.describe)} — ${esc(c.detail)}</li>`).join('')}</ul>` : ''}
</div>` : ''}

<div class="cols">
<main>

<section>
  <h3>Coverage</h3>
  <p class="note">Computed from <code>@case:</code> tags in the spec files and the route inventory, not tracked by hand.</p>
  <div class="meters">
    ${meter('Requirements', coverage.requirements.ratio, coverage.requirements.target, `${coverage.requirements.covered} of ${coverage.requirements.total} stories linked to a case`)}
    ${meter('Test cases automated', coverage.cases.ratio, coverage.cases.target, `${coverage.cases.automated} of ${coverage.cases.total} finished${coverage.cases.draft ? ` · ${coverage.cases.draft} draft spec(s) still carry a TODO and do not count` : ''}`)}
    ${meter('Features exercised', coverage.features.ratio, coverage.features.target, `${coverage.features.covered} of ${coverage.features.total} routes and screens`)}
    ${coverage.code
      ? meter('Code (statements)', (coverage.code.statements ?? 0) / 100, 0.6, `from ${esc(coverage.code.source)}`)
      : `<div class="meter"><div class="meter-head"><span>Code (statements)</span><b class="under">—</b></div><div class="track"></div><div class="meter-foot">No instrumented run yet. Run <code>qa coverage --instrumented</code> against an instrumented build.</div></div>`}
  </div>
</section>

<section>
  <h3>Lowest coverage by area</h3>
  <table>
    <thead><tr><th>Area</th><th>Cases</th><th>Automated</th><th>Draft</th><th>Ratio</th></tr></thead>
    <tbody>
      ${coverage.cases.byArea.slice(0, 8).map(a => `<tr><td>${esc(a.area)}</td><td class="num">${a.total}</td><td class="num">${a.automated}</td><td class="num">${a.draft ?? 0}</td><td class="num ${a.ratio < 0.5 ? 'v-review' : ''}">${pct(a.ratio)}</td></tr>`).join('')}
    </tbody>
  </table>
</section>

<section>
  <h3>Highest risk gaps</h3>
  <p class="note">Ranked by churn, defect history and traffic. This is the list the coverage agent proposes cases for.</p>
  <table>
    <thead><tr><th>Route or screen</th><th>Platform</th><th>Risk</th><th>Why</th></tr></thead>
    <tbody>
      ${coverage.gaps.slice(0, 8).map(g => `<tr><td class="id">${esc(g.route)}</td><td>${esc(g.platform)}</td><td class="num">${g.risk.toFixed(2)}</td><td>${esc(g.reason)}</td></tr>`).join('') || '<tr><td colspan="4">No gaps.</td></tr>'}
    </tbody>
  </table>
</section>

${lastRun ? `
<section>
  <h3>Last run — <code>${esc(lastRun.id)}</code></h3>
  <p class="note">Driver <code>${esc(lastRun.driver)}</code> · autonomy level ${lastRun.autonomyLevel} · treatments ${lastRun.treatments.map(t => `<code>${esc(t ?? 'default')}</code>`).join(' / ')} · ${lastRun.summary.pass} pass, ${lastRun.summary.fail} fail, ${lastRun.summary.needsReview} need review, ${lastRun.summary.autoAccepted} auto-accepted</p>
  <table>
    <thead><tr><th>Case</th><th>Treatment</th><th>Verdict</th><th>Conf.</th><th>Why a person is needed / what failed</th></tr></thead>
    <tbody>
      ${lastRun.results.map(r => `<tr>
        <td class="id">${esc(r.caseId)}</td>
        <td class="id">${esc(r.treatment ?? '—')}</td>
        <td class="${verdictClass(r.verdict)}">${esc(r.verdict)}${r.humanReview ? ` → <span class="${verdictClass(r.humanReview.verdict)}">${esc(r.humanReview.verdict)}</span>` : ''}</td>
        <td class="num">${r.confidence.toFixed(2)}</td>
        <td>${esc(r.failure?.message ?? (r.reviewReasons ?? []).join('; ') ?? '')}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</section>` : ''}

${bugs.length ? `
<section>
  <h3>Drafted bugs</h3>
  <p class="note">Clustered by root-cause signature and held as drafts until a person approves them.</p>
  <table>
    <thead><tr><th>ID</th><th>Severity</th><th>Summary</th><th>Cases</th><th>Treatment</th></tr></thead>
    <tbody>
      ${bugs.map(b => `<tr>
        <td class="id">${esc(b.id)}</td>
        <td><span class="pill ${b.severity === 'high' ? 'bad' : 'sig'}">${esc(b.severity)}</span></td>
        <td>${esc(b.summary)}</td>
        <td class="id">${esc(b.caseIds.join(', '))}</td>
        <td class="id">${b.treatmentSpecific ? esc(b.treatments.join(',')) + ' only' : 'both'}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</section>` : ''}

<section>
  <h3>Flags</h3>
  <table>
    <thead><tr><th>Flag</th><th>Status</th><th>Prod allocation</th><th>Experiment</th></tr></thead>
    <tbody>
      ${flagRows.map(f => `<tr>
        <td class="id">${esc(f.key)}</td>
        <td>${esc(f.status)}</td>
        <td class="id">${esc(JSON.stringify(f.environments.prod.allocation))}</td>
        <td>${esc(f.experiment.status)}${f.experiment.winner ? ` · winner <code>${esc(f.experiment.winner)}</code>` : ''}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</section>

</main>

<aside>
  <div class="block">
    <h4>Waiting on a person</h4>
    ${openGates.length ? `<ul>${openGates.map(g => `<li><span class="pill sig">${esc(g.id)}</span> ${esc(g.summary)}<code class="cmd">qa gate approve ${esc(g.id)} --by you</code></li>`).join('')}</ul>` : '<p class="empty">No open gates.</p>'}
  </div>

  <div class="block">
    <h4>Review queue</h4>
    ${reviewQueue.length
      ? `<ul>${reviewQueue.slice(0, 12).map(r => `<li><code>${esc(r.caseId)}</code>${r.treatment ? ` <span class="pill">${esc(r.treatment)}</span>` : ''} — ${esc((r.reviewReasons ?? []).join('; ') || r.failure?.signature || '')}</li>`).join('')}</ul>
         ${reviewQueue.length > 12 ? `<p class="empty">+ ${reviewQueue.length - 12} more</p>` : ''}`
      : '<p class="empty">Nothing waiting.</p>'}
  </div>

  <div class="block">
    <h4>Agent accuracy</h4>
    ${agreement === null
      ? '<p class="empty">No reviewed verdicts yet. This is the number that gates any move to higher autonomy.</p>'
      : `<p class="empty">Human agreement <b class="mono">${pct(agreement)}</b> across ${reviewed.length} reviewed verdict(s). ${overturned.length} overturned.</p>`}
  </div>

  ${coverage.cases.orphanTags.length ? `
  <div class="block">
    <h4>Dead automation</h4>
    <ul>${coverage.cases.orphanTags.map(o => `<li><code>${esc(o.id)}</code> tagged in ${esc(o.specs.join(', '))} but no such case exists</li>`).join('')}</ul>
  </div>` : ''}

  ${summary ? `<div class="block"><h4>Weekly summary</h4><p class="empty">${esc(summary)}</p></div>` : ''}
</aside>
</div>

<footer>
  Prototype. Jira, Confluence and the flag platform are fixture-backed; swap the implementations in <code>src/connectors/index.js</code> to go live.
  Results marked driver <code>replay</code> are recorded behaviour of the public demo site, not a live browser run.
</footer>
</div>
</body>
</html>`;

  const out = path.join(ROOT, 'out', 'dashboard.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  return path.relative(ROOT, out);
}
