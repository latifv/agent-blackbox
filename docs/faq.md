# FAQ

## Is this just git diff?

Git diff is part of it, but Agent Blackbox packages the whole agent run:
command, terminal output, git status before/after, diff, tests, policy
violations, hash-chained events, and `report.html`.

## Is this a sandbox?

No. v0.1 is not a full OS-level sandbox. It records evidence around a run.
Docker sandboxing and network policy are roadmap items.

## Can an adversarial agent bypass it?

A sufficiently adversarial agent may bypass a simple local recorder. v0.1 is
meant for inspectability and review, not as a complete security boundary.

## How is this different from LLM tracing tools?

Tracing tools usually focus on prompts, model calls, latency, and cost. Agent
Blackbox focuses on what a coding agent did in a repository: terminal output,
git diffs, tests, policy matches, and evidence packs.

## Does it work with Codex?

Yes, when Codex is run as a terminal command, for example through `codex exec`:

```sh
blackbox run --policy blackbox.yml --test "npm test" -- \
  codex exec --json --sandbox workspace-write "fix the failing tests"
```

## Does it work with Claude Code?

It should work with any CLI-style coding agent command. A generic shape is:

```sh
blackbox run --test "npm test" -- <claude-agent-command> "fix the failing tests"
```

This is an example shape, not a claim that every Claude Code workflow has been
tested.

## Can I use it in CI?

Not as a first-party action yet, but you can run the CLI in CI. GitHub Action
support is on the roadmap.

## What should be recorded next?

Network events, sandbox configuration, richer policy results, OpenTelemetry
export, and hosted/team replay options.
