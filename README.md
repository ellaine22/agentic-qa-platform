# Agentic QA Platform — working prototype

An orchestrator that moves a project through the QA lifecycle, calls an agent
at each stage, stops at human gates, and measures coverage against the codebase
rather than a spreadsheet.

It runs against two public sites so there is a real application under test:

- **Web** — [saucedemo.com](https://www.saucedemo.com), driven by Cypress
- **Web (timing and dialogs)** — [the-internet.herokuapp.com](https://the-internet.herokuapp.com)
- **Mobile** — the [Sauce Labs demo app](https://github.com/saucelabs/my-demo-app-rn/releases), driven by Maestro

## Run it

Requires a patched Node release: 22.23.5+, 24.22.3+ or 26.13.1+. Older builds still trust the compromised eMudhra intermediate CA. `.nvmrc` pins 24.22.3.

```bash
nvm use
npm install
npm run demo          # the whole lifecycle, offline, in about two seconds
npm test              # the behaviours the platform's trustworthiness rests on
```

`npm run demo` needs no API key, no browser and no network. It uses the `local`
reasoning provider and the `replay` execution driver, then prints each stage and
writes `out/dashboard.html`. Open that file to see the control room.

To run it stage by stage:

```bash
node src/cli.js intake SWAG-101          # plan from the epic, stories and Confluence docs
node src/cli.js gates                    # what is waiting on a person
node src/cli.js gate approve G-001 --by ellaine
node src/cli.js cases SWAG-101           # generate cases for both treatments
node src/cli.js gate approve G-002 --by ellaine
node src/cli.js run SWAG-101             # execute against both treatments
node src/cli.js triage SWAG-101          # cluster failures into drafted bugs
node src/cli.js release SWAG-101         # go/no-go
node src/cli.js coverage                 # four-layer snapshot
node src/cli.js report                   # build out/dashboard.html
node src/cli.js status                   # where every project is
node src/cli.js reset                    # back to the seeded state
```

## Running against the live sites

```bash
npx cypress install                       # one-off, downloads the browser binary
node src/cli.js run SWAG-101 --driver cypress --platform web
npm run cypress:open                      # or drive it by hand
```

The executor passes the treatment through as a Cypress env var; `cy.setTreatment()`
in `cypress/support/e2e.js` turns it into a signed-in session. That is the single
place a flag becomes a concrete test identity, so no spec hard codes an account.

For mobile, install Maestro and start a device, then:

```bash
node src/cli.js run SWAG-101 --driver maestro --platform mobile
```

## Using real Claude instead of the local provider

```bash
export ANTHROPIC_API_KEY=...   # or run `ant auth login` once
export QA_LLM_PROVIDER=anthropic
npm run demo
```

Every agent calls `complete({ task, context })` and gets structured JSON back.
Swapping the provider changes the quality of the planning and case writing; it
never changes the contract between stages. The prompts and the JSON shape each
agent depends on are in `src/llm/anthropic.js`, which calls `claude-opus-5-5`
through the official SDK with server-side refusal fallbacks enabled.

## What the demo actually demonstrates

The project under test, `SWAG-101 Express Checkout`, sits behind the
`express_checkout` flag with two treatments. Each treatment maps to a different
saucedemo identity, and `problem_user` genuinely misbehaves on that site. So the
failures the executor finds are real, not staged:

| Stage | What happens |
|---|---|
| Planner | Reads the epic, 5 stories, the PRD and the tech investigation; publishes a 7-section plan; opens `plan_approval` |
| Case writer | Generates a case per acceptance criterion per treatment; pulls in regression cases named by the tech doc's risk list; opens `case_review` |
| Executor | Runs every case in both treatments, applies the autonomy policy, opens `execution_review` |
| Triage | Clusters 16 failing results into 3 distinct defects, drafts a Jira bug for each |
| Release | Returns **NO-GO** with the specific rules it is blocked on |
| Automation | Writes tagged Cypress specs from the executed cases |
| Coverage | Recomputes from the spec tags, ranks gaps by risk |
| Rollout watcher | Finds a concluded experiment and stale flag debt |
| Promotion | Keeps the winner's specs, deletes the loser's, sets the flag to 100% |

Every failure is `express`-only. That is the whole point of running both
treatments: the comparison tells you the treatment is at fault rather than the
build.

## Design principles

**1. A pass without evidence is not a pass.** The executor downgrades any pass
carrying no evidence to `needs-review`, and a test pins that. Combined with the
always-review areas (`checkout`, `auth`, `payments`, `pii`), this is what keeps
an agent from quietly approving a broken checkout.

**2. Coverage is computed, never tracked.** Case IDs live in the spec files as
`@case:WEB-CHK-001` tags. The coverage agent reads the tags, so coverage cannot
drift from reality. Two consequences fall out for free:

- a spec block still carrying a `TODO` counts as a **draft**, not as automation —
  the agent writing a spec does not move the number, an engineer finishing it does
- a tag pointing at a case that no longer exists is reported as **dead automation**

**3. Automation does not wait for 100%.** Specs are written for both treatments
during the experiment and tagged with the treatment. When product picks a winner,
`qa promote <flag> <winner>` keeps the winner's specs, deletes the loser's, strips
the treatment override and sets the flag to 100%. Coverage goes *down* at that
moment, which is correct: tests for behaviour no customer will see are not coverage.

## Layout

```
config/platform.json        autonomy level, gates, risk weights, connector targets
data/
  testcases/                the system of record, replacing a test case spreadsheet
  fixtures/jira/            epic + stories with acceptance criteria
  fixtures/confluence/      PRD and tech investigation the planner reads
  fixtures/seed/            pristine state that `qa reset` restores
  flags.json                mock flag platform, treatments carry a test identity
  inventory.json            route and screen inventory with churn/defect/traffic
  replay/behaviours.json    recorded demo-site behaviour per identity
src/
  cli.js                    the orchestrator's command line
  orchestrator/             store, lifecycle stages, gates, workspace reset
  agents/                   planner, caseWriter, executor, triage, release,
                            rolloutWatcher, automation, coverage
  connectors/               Jira, Confluence, flags, git, test case repository
  drivers/                  cypress, maestro, replay
  llm/                      provider switch: local (offline) and anthropic
  report/dashboard.js       builds out/dashboard.html
cypress/e2e/regression/     hand-written regression specs
cypress/e2e/web/            agent-generated and per-treatment specs
maestro/flows/              mobile flows, same @case tagging
test/                       the behaviours that must not regress
```

## Going from prototype to production

The agents never touch a system directly; they go through `src/connectors/index.js`.
Replacing the fixture implementations with REST calls is the whole migration:

| Connector | Now | Production |
|---|---|---|
| `jira` | reads `data/fixtures/jira/*.json` | `/rest/api/3/issue` |
| `confluence` | writes to `out/confluence/` | `PUT /rest/api/content/{id}` |
| `flags` | reads `data/flags.json` | the flag platform SDK, per-session override in test envs |
| `git` | reads the local spec roots | the repo, raising PRs |
| store | `data/store.json` | Postgres or Azure SQL |

Two things the prototype fakes that the real system should not:

- **`data/inventory.json`** is a fixture. In production, generate the route and
  screen inventory from the codebase at build time, and take churn from git,
  defects from Jira and traffic from analytics.
- **Code coverage** reads `out/coverage/coverage-summary.json` if it exists.
  Produce it from an instrumented build and the number appears on the dashboard.

## Known limits

- The `replay` driver reports recorded behaviour, not a live browser. Every result
  it produces is labelled `driver: replay` and its evidence says `recorded: true`.
  Nothing in the dashboard pretends otherwise.
- `featureToCases` in the inventory is static, so newly generated project cases do
  not yet move feature coverage. Instrument a run to record visited routes.
- The `local` provider's test plans are competent but templated. The difference
  between it and the `anthropic` provider is the honest measure of what the model
  is contributing.
