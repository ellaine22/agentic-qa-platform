// Cypress driver: runs the real suite against the live demo site and maps
// Cypress results back to case IDs by the @case:<ID> tag in each test title.
//
// Requires `npx cypress install` once (needs network access to download.cypress.io).
// The flag treatment is passed through as a Cypress env var, which the support
// file turns into the identity the specs sign in with.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../orchestrator/store.js';

export const name = 'cypress';

const CASE_TAG = /@case:([A-Z0-9-]+)/;

function execCypress(args, env) {
  return new Promise((resolve) => {
    const proc = spawn('npx', ['cypress', ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d; process.stdout.write(d); });
    proc.stderr.on('data', d => { err += d; });
    proc.on('close', code => resolve({ code, out, err }));
    proc.on('error', e => resolve({ code: -1, out, err: e.message }));
  });
}

export async function run({ cases, treatment, identity, runId, platform, baseUrl }) {
  if (platform !== 'web') {
    throw new Error('The cypress driver runs web cases only. Mobile cases need the maestro driver.');
  }

  const reportDir = path.join(ROOT, 'out', 'cypress', runId, treatment ?? 'default');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, 'results.json');

  const { code, err } = await execCypress(
    [
      'run',
      '--browser', process.env.QA_CYPRESS_BROWSER || 'electron',
      '--reporter', 'json',
      '--reporter-options', `output=${reportFile}`,
      '--config', `baseUrl=${baseUrl}`,
      '--env', `treatment=${treatment ?? ''},username=${identity?.username ?? ''},password=${identity?.password ?? ''}`
    ],
    {}
  );

  if (!fs.existsSync(reportFile)) {
    throw new Error(
      `Cypress produced no report (exit ${code}). ${err.slice(0, 300)}\n` +
      'If the binary is missing, run: npx cypress install'
    );
  }

  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const byCase = new Map();
  for (const t of [...(report.passes ?? []), ...(report.failures ?? []), ...(report.pending ?? [])]) {
    const tag = (t.fullTitle ?? t.title ?? '').match(CASE_TAG);
    if (!tag) continue;
    byCase.set(tag[1], t);
  }

  const screenshots = fs.existsSync(path.join(ROOT, 'cypress/screenshots'))
    ? fs.readdirSync(path.join(ROOT, 'cypress/screenshots'), { recursive: true }).filter(f => String(f).endsWith('.png'))
    : [];

  return cases.map(testCase => {
    const t = byCase.get(testCase.id);
    if (!t) {
      // No spec carries this case ID: it is not automated, so the agent has
      // nothing to run. This is a coverage gap, not a failure.
      return {
        caseId: testCase.id, area: testCase.area, platform: testCase.platform, risk: testCase.risk,
        treatment: treatment ?? null, verdict: 'not-automated', confidence: 1,
        durationMs: 0, steps: [], evidence: [], failure: null, driver: 'cypress'
      };
    }
    const failed = Boolean(t.err && Object.keys(t.err).length);
    const shot = screenshots.find(f => String(f).includes(testCase.id));
    return {
      caseId: testCase.id,
      area: testCase.area,
      platform: testCase.platform,
      risk: testCase.risk,
      treatment: treatment ?? null,
      verdict: failed ? 'fail' : 'pass',
      confidence: failed ? 0.95 : 0.9,
      durationMs: t.duration ?? 0,
      steps: [],
      evidence: [
        { type: 'cypress-report', recorded: false, path: path.relative(ROOT, reportFile) },
        ...(shot ? [{ type: 'screenshot', recorded: false, path: path.join('cypress/screenshots', String(shot)) }] : [])
      ],
      failure: failed
        ? {
            signature: (t.err.message ?? 'cypress failure').split('\n')[0].slice(0, 120),
            message: (t.err.message ?? '').slice(0, 600)
          }
        : null,
      driver: 'cypress'
    };
  });
}
