# Contributing

Thanks for helping make Agent Blackbox more useful. The project is intentionally small, local-first, and easy to inspect.

## Development

```sh
pnpm install
pnpm build
```

The CLI entrypoint is `src/cli.ts`. The main run pipeline lives in `src/run.ts`.

## Run the cheating demo

```sh
pnpm build
cd examples/broken-checkout
npm install
git init
git add .
git commit -m "demo baseline"
node ../../dist/cli.js init
node ../../dist/cli.js run --test "npm test" -- node ../cheating-agent.js
```

The cheating agent weakens a test. The report should show a critical `no-test-deletion` policy violation.

From a clean demo checkout, run the honest example:

```sh
node ../../dist/cli.js run --test "npm test" -- node ../honest-agent.js
```

## Propose new policy rules

Policy rules should be explainable from local evidence. Good v0.1 rules usually match:

- file events such as `file.added`, `file.changed`, or `file.deleted`
- path globs such as `**/*.test.*` or `secrets/**`
- output substrings from `command.output` or `test.output`

When proposing a rule, include:

- the rule id
- the risk it catches
- the event type it should match
- sample safe input/output
- expected severity: `low`, `medium`, `high`, or `critical`

Avoid rules that require cloud services or hidden state.

## Add agent examples

Agent examples should be runnable locally and should not require paid services or credentials.

Place examples under `examples/` and include:

- the command to run through `blackbox run`
- what the agent changes
- what evidence Blackbox should produce
- any limitations of the example

Never commit tokens, `.env` files, private keys, generated `.blackbox/runs` artifacts, `node_modules`, or `dist`.
