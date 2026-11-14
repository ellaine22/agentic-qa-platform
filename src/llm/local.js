// Deterministic provider. No network, no key. Each task produces the same
// structured output the Anthropic provider is asked for, derived from the
// supplied context by rules rather than by a model.
//
// This exists so the platform is runnable and testable offline, and so the
// output contract of each agent is pinned by something you can read.

const TASKS = {};

// --- Test plan ---------------------------------------------------------

TASKS['test-plan'] = ({ epic, docs, flag }) => {
  const byPlatform = {};
  for (const s of epic.stories) (byPlatform[s.platform] ??= []).push(s);

  const risks = [];
  const tech = docs.find(d => d.id.startsWith('TECH'));
  if (tech) {
    for (const line of tech.body.split('\n')) {
      const m = line.match(/^-\s+(.*)$/);
      if (m && /risk|watch|regress|must agree|dropped/i.test(m[1])) risks.push(m[1].trim());
    }
  }

  const sections = [
    {
      heading: 'Scope',
      body: epic.description
    },
    {
      heading: 'Flag and treatments',
      body: flag
        ? `Tested behind \`${flag.key}\`. Treatments: ${flag.treatments.map(t => `\`${t.key}\` (${t.description})`).join(', ')}. ` +
          `Every in-scope scenario is written for both treatments and tagged with the treatment it asserts. ` +
          `Test environment allocation: ${JSON.stringify(flag.environments.test.allocation)}.`
        : 'No feature flag on this project.'
    },
    {
      heading: 'Stories in scope',
      body: Object.entries(byPlatform)
        .map(([platform, stories]) =>
          `**${platform}**\n` + stories.map(s => `- ${s.key} ${s.summary} (${s.acceptanceCriteria.length} acceptance criteria)`).join('\n'))
        .join('\n\n')
    },
    {
      heading: 'Regression blast radius',
      body: 'Areas touched beyond the scope of the epic, taken from the tech investigation: ' +
        (tech ? 'shared header and cart badge, asset resolver used by catalog images, client-side totals.' : 'not stated.') +
        ' Regression cases in these areas are selected into the project run.'
    },
    {
      heading: 'Risks',
      body: risks.length ? risks.map(r => `- ${r}`).join('\n') : '- None recorded in the tech investigation.'
    },
    {
      heading: 'Entry and exit criteria',
      body: [
        'Entry: build deployed to the test environment, both treatments resolvable, test identities available.',
        'Exit: every P1 case passed in both treatments, no open high-severity bug, totals agree between treatments, execution review gate approved.'
      ].map(x => `- ${x}`).join('\n')
    },
    {
      heading: 'Approach',
      body: `Agent-executed with human review at autonomy level 2. ${epic.riskAreas?.includes('payments') ? 'Checkout is payment-adjacent, so every checkout verdict is reviewed by a person regardless of confidence.' : ''}`.trim()
    }
  ];

  return {
    title: `Test plan: ${epic.summary} (${epic.key})`,
    sections,
    sources: [epic.key, ...epic.stories.map(s => s.key), ...docs.map(d => d.id)]
  };
};

// --- Test cases --------------------------------------------------------

const idFor = (epicKey, area, n) =>
  `${area.toUpperCase().slice(0, 3)}-${epicKey.split('-')[0]}-${String(n).padStart(3, '0')}`;

// Setup steps per area, as atomic actions so the automation agent can map each
// one to a single command. The acceptance criterion itself becomes the final
// step, and that is the one a person usually still has to write an assertion for.
const SETUP = {
  web: {
    checkout: [
      { action: 'Sign in', expect: null },
      { action: 'Add a product to the cart', expect: null },
      { action: 'Open the cart', expect: null },
      { action: 'Start checkout', expect: null },
      { action: 'Enter valid customer details', expect: null }
    ],
    catalog: [{ action: 'Sign in', expect: 'The catalog page loads' }],
    cart: [
      { action: 'Sign in', expect: null },
      { action: 'Add a product to the cart', expect: null },
      { action: 'Open the cart', expect: null }
    ],
    auth: [{ action: 'Open the sign-in page', expect: null }]
  },
  mobile: {
    checkout: [
      { action: 'Launch the app and sign in', expect: null },
      { action: 'Add a product to the cart', expect: null },
      { action: 'Open the cart and proceed to checkout', expect: null }
    ],
    catalog: [{ action: 'Launch the app', expect: 'Products are listed' }]
  }
};

TASKS['test-cases'] = ({ epic, flag }) => {
  const cases = [];
  let n = 0;

  for (const story of epic.stories) {
    for (const [i, ac] of story.acceptanceCriteria.entries()) {
      // A criterion that names the control treatment belongs to control only.
      const controlOnly = /control treatment/i.test(ac);
      const treatments = flag
        ? (controlOnly ? ['control'] : flag.treatments.map(t => t.key))
        : [null];

      for (const treatment of treatments) {
        n += 1;
        const prefix = story.platform === 'mobile' ? 'MOB' : 'WEB';
        cases.push({
          id: `${prefix}-${epic.key.split('-')[1]}-${String(n).padStart(3, '0')}`,
          title: ac,
          platform: story.platform,
          area: story.area,
          priority: i === 0 ? 'P1' : 'P2',
          risk: epic.riskAreas?.includes(story.area) ? 'high' : 'medium',
          source: 'project',
          stories: [story.key],
          flag: flag?.key ?? null,
          treatment,
          tags: ['project', story.area, ...(treatment ? [`treatment:${treatment}`] : [])],
          evidenceRequired: true,
          steps: [
            ...(SETUP[story.platform]?.[story.area] ?? [{ action: `Reach the ${story.area} screen`, expect: null }])
              .map(s => ({ ...s, target: null })),
            { action: `Verify: ${ac}`, target: null, expect: ac }
          ]
        });
      }
    }
  }

  return { cases, derivedFrom: epic.stories.map(s => s.key) };
};

// --- Triage ------------------------------------------------------------

TASKS['triage'] = ({ failures }) => {
  const clusters = new Map();
  for (const f of failures) {
    // Cluster on the normalised failure signature, not the case, so one defect
    // showing in four cases becomes one bug.
    const signature = (f.failure?.signature || f.failure?.message || 'unknown')
      .replace(/\d+/g, 'N')
      .replace(/['"].*?['"]/g, 'X')
      .slice(0, 120);
    if (!clusters.has(signature)) clusters.set(signature, { signature, cases: [], treatments: new Set(), areas: new Set() });
    const c = clusters.get(signature);
    c.cases.push(f.caseId);
    if (f.treatment) c.treatments.add(f.treatment);
    if (f.area) c.areas.add(f.area);
  }

  return {
    clusters: [...clusters.values()].map((c, i) => {
      const treatments = [...c.treatments];
      const areas = [...c.areas];
      const severity = areas.includes('checkout') ? 'high' : c.cases.length > 2 ? 'high' : 'medium';
      return {
        id: `C${i + 1}`,
        signature: c.signature,
        caseIds: c.cases,
        treatments,
        areas,
        severity,
        treatmentSpecific: treatments.length === 1,
        summary: `${c.signature} (${c.cases.length} case${c.cases.length > 1 ? 's' : ''}${treatments.length === 1 ? `, ${treatments[0]} only` : ''})`
      };
    })
  };
};

// --- Weekly summary ----------------------------------------------------

TASKS['summary'] = ({ coverage, runs, bugs, gates }) => {
  const lines = [];
  lines.push(`Test case coverage is at ${(coverage.cases.ratio * 100).toFixed(0)}% (${coverage.cases.automated} of ${coverage.cases.total} automated).`);
  lines.push(`Requirements coverage is ${(coverage.requirements.ratio * 100).toFixed(0)}% and feature coverage ${(coverage.features.ratio * 100).toFixed(0)}%.`);
  if (runs.length) {
    const last = runs[runs.length - 1];
    lines.push(`The most recent run (${last.id}) executed ${last.results.length} cases with ${last.results.filter(r => r.verdict === 'fail').length} failures and ${last.results.filter(r => r.verdict === 'needs-review').length} needing review.`);
  }
  if (bugs.length) lines.push(`${bugs.length} bug${bugs.length > 1 ? 's were' : ' was'} drafted from failure clusters.`);
  const open = gates.filter(g => g.status === 'open');
  if (open.length) lines.push(`${open.length} gate${open.length > 1 ? 's are' : ' is'} waiting on a person: ${open.map(g => `${g.id} ${g.type}`).join(', ')}.`);
  const gaps = coverage.gaps.slice(0, 3).map(g => g.route);
  if (gaps.length) lines.push(`The highest risk uncovered features are ${gaps.join(', ')}.`);
  return { summary: lines.join(' ') };
};

export async function complete({ task, context }) {
  const handler = TASKS[task];
  if (!handler) throw new Error(`Local provider has no handler for task "${task}"`);
  return handler(context);
}
