// Real Claude provider, enabled with QA_LLM_PROVIDER=anthropic. Credentials come
// from ANTHROPIC_API_KEY or an `ant auth login` profile.
//
// The schemas below are the contract each agent relies on. If a response does
// not parse, the provider throws rather than returning prose: an agent must
// never hand unvalidated text to the next stage.

import Anthropic from '@anthropic-ai/sdk';

let client;

const PROMPTS = {
  'test-plan': {
    system: `You are a QA test planner. You are given a Jira epic with its stories and acceptance criteria, the product requirements and tech investigation documents, and the feature flag definition. Write a test plan.

Rules:
- Every statement must be traceable to the supplied material. Do not invent requirements, routes or risks.
- Treat the tech investigation's "known risks" as the source for the regression blast radius.
- If the project is behind a flag, the plan must cover both treatments.
- Return JSON only, no prose outside it.`,
    schema: `{ "title": string, "sections": [{ "heading": string, "body": string }], "sources": string[] }`
  },

  'test-cases': {
    system: `You are a QA engineer writing test cases from acceptance criteria.

Rules:
- One case per acceptance criterion per applicable flag treatment.
- A criterion that only describes control behaviour gets a control case only.
- Every case must cite the story key it came from in "stories". A case with no source is invalid.
- Steps are concrete and observable. "expect" describes what a person or an agent can verify on screen.
- Mark risk high for anything in a payment-adjacent area.
- Return JSON only.`,
    schema: `{ "cases": [{ "id": string, "title": string, "platform": "web"|"mobile", "area": string, "priority": "P1"|"P2"|"P3", "risk": "high"|"medium"|"low", "source": "project", "stories": string[], "flag": string|null, "treatment": string|null, "tags": string[], "evidenceRequired": boolean, "steps": [{ "action": string, "target": string|null, "expect": string }] }], "derivedFrom": string[] }`
  },

  triage: {
    system: `You are a QA triage agent. You are given failed test results with their error signatures, treatments and areas. Group them into distinct defects.

Rules:
- Cluster on root-cause signature, not on test case. Four cases failing on one broken selector is one defect.
- Mark a cluster treatmentSpecific only if every failure is in one treatment.
- Severity is high for checkout, payment or auth areas, or when a cluster spans more than two cases.
- Return JSON only.`,
    schema: `{ "clusters": [{ "id": string, "signature": string, "caseIds": string[], "treatments": string[], "areas": string[], "severity": "high"|"medium"|"low", "treatmentSpecific": boolean, "summary": string }] }`
  },

  summary: {
    system: `You are writing a weekly QA summary for engineering leadership. Be concise and factual, five sentences at most. Only use the supplied numbers. Return JSON only.`,
    schema: `{ "summary": string }`
  }
};

export async function complete({ task, context, config }) {
  const spec = PROMPTS[task];
  if (!spec) throw new Error(`Anthropic provider has no prompt for task "${task}"`);

  client ??= new Anthropic();

  let response;
  try {
    response = await client.beta.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      output_config: { effort: config.effort },
      // If a safety classifier declines, the API retries on a fallback model in the same call
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: `${spec.system}\n\nReturn a single JSON object matching this shape:\n${spec.schema}`,
      messages: [{ role: 'user', content: JSON.stringify(context, null, 2) }]
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error('Anthropic rejected the credentials. Set ANTHROPIC_API_KEY or run `ant auth login`.');
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error(`Rate limited on task "${task}" after retries. Try again shortly.`);
    }
    if (err instanceof Anthropic.APIError) {
      throw new Error(`Anthropic API ${err.status} on task "${task}": ${err.message}`);
    }
    throw err;
  }

  if (response.stop_reason === 'refusal') {
    throw new Error(`Task "${task}" was declined (${response.stop_details?.category ?? 'no category'})`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error(`Task "${task}" hit max_tokens (${config.maxTokens}) before finishing; raise llm.maxTokens`);
  }

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Task "${task}" did not return JSON. Got: ${text.slice(0, 200)}`);

  try {
    return JSON.parse(match[0]);
  } catch (err) {
    throw new Error(`Task "${task}" returned unparseable JSON: ${err.message}`);
  }
}
