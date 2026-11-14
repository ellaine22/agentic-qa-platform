// Provider switch for agent reasoning.
//
//   local     - deterministic, template driven, no API key, runs offline.
//               Good enough to exercise the whole pipeline and to keep the
//               orchestration honest: nothing downstream may depend on prose.
//   anthropic - real Claude. Set ANTHROPIC_API_KEY and QA_LLM_PROVIDER=anthropic.
//
// Every agent calls complete() and gets structured JSON back, so swapping the
// provider changes quality, never the contract.

import { config } from '../connectors/index.js';
import * as local from './local.js';
import * as anthropic from './anthropic.js';

const providers = { local, anthropic };

export function providerName() {
  return process.env.QA_LLM_PROVIDER || config.llm.provider || 'local';
}

export async function complete({ task, context }) {
  const name = providerName();
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown LLM provider "${name}". Use one of: ${Object.keys(providers).join(', ')}`);
  const started = Date.now();
  const result = await provider.complete({ task, context, config: config.llm });
  return {
    ...result,
    _meta: { provider: name, task, ms: Date.now() - started }
  };
}
