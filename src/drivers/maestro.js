// Maestro driver: runs mobile flows against the public Sauce Labs demo app.
// Needs a running simulator/emulator and `maestro` on PATH, so it is not
// exercised in the offline demo. Flow files carry the same @case:<ID> tag as
// the Cypress specs, so the mapping back to test cases is identical.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../orchestrator/store.js';

export const name = 'maestro';

export async function run({ cases, treatment, identity, runId, platform }) {
  if (platform !== 'mobile') throw new Error('The maestro driver runs mobile cases only.');

  const reportDir = path.join(ROOT, 'out', 'maestro', runId, treatment ?? 'default');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, 'report.xml');

  const code = await new Promise(resolve => {
    const proc = spawn('maestro', [
      'test', path.join(ROOT, 'maestro/flows'),
      '--format', 'junit',
      '--output', reportFile,
      '-e', `TREATMENT=${treatment ?? ''}`,
      '-e', `USERNAME=${identity?.username ?? ''}`,
      '-e', `PASSWORD=${identity?.password ?? ''}`
    ], { cwd: ROOT, stdio: 'inherit' });
    proc.on('close', resolve);
    proc.on('error', () => resolve(-1));
  });

  if (!fs.existsSync(reportFile)) {
    throw new Error(
      `Maestro produced no report (exit ${code}). Install Maestro and start a device:\n` +
      '  curl -Ls "https://get.maestro.mobile.dev" | bash\n' +
      '  maestro test maestro/flows'
    );
  }

  const xml = fs.readFileSync(reportFile, 'utf8');
  return cases.map(testCase => {
    const block = xml.split('<testcase').find(b => b.includes(testCase.id));
    if (!block) {
      return { caseId: testCase.id, area: testCase.area, platform: 'mobile', risk: testCase.risk,
        treatment: treatment ?? null, verdict: 'not-automated', confidence: 1, durationMs: 0,
        steps: [], evidence: [], failure: null, driver: 'maestro' };
    }
    const failed = block.includes('<failure');
    return {
      caseId: testCase.id, area: testCase.area, platform: 'mobile', risk: testCase.risk,
      treatment: treatment ?? null,
      verdict: failed ? 'fail' : 'pass',
      confidence: 0.9,
      durationMs: Number(block.match(/time="([\d.]+)"/)?.[1] ?? 0) * 1000,
      steps: [],
      evidence: [{ type: 'maestro-report', recorded: false, path: path.relative(ROOT, reportFile) }],
      failure: failed ? { signature: 'maestro assertion failed', message: block.slice(0, 400) } : null,
      driver: 'maestro'
    };
  });
}
