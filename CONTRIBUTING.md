# Contributing to ivoraige

ivoraige is an early development preview. See the [capability map](docs/plan/0.1.0/capabilities.md) before proposing a change. Check existing issues and [follow-ups](docs/plan/follow-ups/README.md) for related work; an issue or discussion does not reserve a task.

For a bug report, use the issue template. Include the version or commit, operating system and architecture, the affected entry point (CLI, WebUI, MCP, or package), expected and observed behavior, and steps to reproduce. Share only original or properly licensed small samples and remove credentials, private text, personal data, and copyrighted source material from logs and attachments. Report suspected vulnerabilities using [SECURITY.md](SECURITY.md), without posting exploit details in a public issue.

For a code change, keep the patch focused and explain the behavior it changes. Use Node.js 24 or newer, then run:

```sh
npm ci
npm run setup:dsh
npm test
npm run smoke:package
```

The [development guide](docs/plan/0.1.0/development-guide.md) covers local startup and isolated data; [PDF development](docs/plan/0.1.0/pdf-development.md) needs additional components. Default tests use a local mock provider. State which checks you actually ran, their platform, and any untested path. Real model calls may incur cost and are not needed for a routine contribution. Keep API keys and local data out of commits.

Update both `README.md` and `README.zh-CN.md` when changing user-facing behavior or setup. Keep project architecture constraints in [AGENTS.md](AGENTS.md) and process contracts in the [v2.0 protocol](docs/requirements/v2.0/03_API-protocol_v2.0.md).

The project does not yet have a project license. Do not assume permission to redistribute the repository or that a proposed contribution can be merged. Submit only work you have the right to share; maintainers must settle the project license and contribution terms before accepting external code.
