# Security Policy

Agent Blackbox v0.1 is not a full OS-level sandbox. It records local evidence from wrapped agent commands, including terminal logs, git diffs, test results, policy matches, hash-chained events, and local HTML evidence reports.

## Current Scope

Agent Blackbox v0.1 helps users inspect what happened during an agent run. It does not guarantee complete containment, complete file access monitoring, or complete network monitoring.

## Reporting Issues

For non-sensitive security bugs, please open a GitHub issue with enough detail to reproduce the behavior.

For sensitive security reports, do not post exploit details, private data, credentials, `.env` values, tokens, or private keys publicly. Open a minimal GitHub issue that says you have a sensitive report and include a safe contact path, or use GitHub's private vulnerability reporting if it is enabled for this repository.

## Please Do Not Include

- secrets, tokens, passwords, or API keys
- `.env` contents
- private source code
- customer data
- exploit details that would put users at risk
