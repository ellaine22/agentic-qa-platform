// Rollout watcher: polls the flag platform and reacts to state changes.
//
// Two things it looks for:
//   1. An experiment with a winner and no automation promotion yet -> open a
//      rollout_decision gate so product confirms, then hand to the automation
//      agent to promote the winner and clean up the loser.
//   2. A flag still referenced by specs after it reached 100% -> stale flag
//      debt, reported so it does not accumulate silently.

import { flags, git } from '../connectors/index.js';
import { openGate, logEvent } from '../orchestrator/store.js';

export function scan(db) {
  const specs = git.specs();
  const findings = [];

  for (const flag of flags.all()) {
    // Match the flag key as a quoted literal, so a passing mention in a comment
    // is not counted as a branch on the flag.
    const reference = new RegExp(`['"\`]${flag.key}['"\`]`);
    const referencedBy = specs.filter(s => reference.test(s.text)).map(s => s.path);
    const prodAllocation = flag.environments?.prod?.allocation ?? {};
    const atFullRollout = Object.values(prodAllocation).some(v => v === 100);
    const winner = flag.experiment?.winner ?? null;

    if (winner && !atFullRollout) {
      findings.push({
        flag: flag.key,
        type: 'promote-winner',
        winner,
        referencedBy,
        detail: `Experiment on ${flag.key} concluded with "${winner}" but production is still at ${JSON.stringify(prodAllocation)}.`
      });
      openGate(db, {
        key: flag.owner ?? flag.key,
        type: 'rollout_decision',
        role: 'product',
        summary: `Confirm "${winner}" as the winner of ${flag.key} and promote its automation`,
        payload: { flag: flag.key, winner, referencedBy }
      });
    }

    if (atFullRollout && referencedBy.length) {
      findings.push({
        flag: flag.key,
        type: 'stale-flag-debt',
        winner,
        referencedBy,
        detail: `${flag.key} is at 100% in production but ${referencedBy.length} spec file(s) still branch on it. Remove the flag check and the losing-treatment specs.`
      });
    }

    if (flag.status === 'ramping' && !winner) {
      findings.push({
        flag: flag.key,
        type: 'experiment-running',
        winner: null,
        referencedBy,
        detail: `${flag.key} is ramping, experiment on ${flag.experiment?.metric ?? 'unknown metric'} has not concluded. Both treatments stay under test.`
      });
    }
  }

  logEvent(db, { actor: 'rollout-watcher', action: 'scan', subject: 'flags', detail: `${findings.length} finding(s)` });
  return findings;
}
