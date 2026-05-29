# Agent CLI Examples

Agent Blackbox can wrap any coding agent that runs as a terminal command. The
examples below are documentation-only command shapes. They do not run in the
test suite and do not require paid provider credentials.

## Claude Code or Claude-Style CLI

Use `--` to separate Agent Blackbox options from the command you want to record:

```sh
blackbox run --policy blackbox.yml --test "npm test" -- \
  claude "fix the failing tests"
```

If your local CLI uses a different binary name or subcommand, keep the
`blackbox run` part the same and replace everything after `--`:

```sh
blackbox run --test "npm test" -- \
  <claude-agent-command> "fix the failing tests"
```

For a repo-specific task, initialize Blackbox in the target repository first:

```sh
blackbox init
blackbox run --test "npm test" -- \
  <claude-agent-command> "fix the failing checkout test without editing tests"
```

After the run, inspect and verify the evidence pack:

```sh
blackbox verify .blackbox/runs/<run-id>
```

Then open `.blackbox/runs/<run-id>/report.html` in a browser.

## Codex CLI

Codex-style commands work the same way:

```sh
blackbox run --policy blackbox.yml --test "npm test" -- \
  codex exec --json --sandbox workspace-write "fix the failing tests"
```

## Limitations

- Agent Blackbox records the command, terminal output, git diff, test output,
  policy matches, and evidence report. It does not provide a full sandbox.
- Provider authentication, model access, and network behavior are controlled by
  the wrapped CLI, not by Agent Blackbox.
- If an agent edits files outside the git repository or bypasses the terminal
  command being wrapped, those actions may not be captured.
- Keep task prompts concrete. The best reports come from runs with a clear test
  command and a focused goal.
