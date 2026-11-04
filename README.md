# Codex Superagent

A standalone Codex app-server service for authorized repository work and CI monitoring. Fork of [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype), preserving upstream MIT license and history.

**Start with [VM deployment and connection setup](deploy/README.md).** The new service lives in `service/`; the original DSH bundle remains in `src/` with [its original README](README.upstream.md). Installing the new service does not install or start DeepSeek Harness. This is a first runnable release, not feature parity with the upstream bundle.

```text
Slack @mentions ──┐                          ┌─ Codex app-server
GitHub Actions ──┼─ allowlists → SQLite → policy → isolated ticket checkout
Jenkins/CloudBees┤                          └─ durable replies → Slack
Gerrit patchsets┘                            (Gerrit stays observed)
                                  authenticated operator dashboard
```

## What works

- Slack Socket Mode: authorized mentions and thread followups, allowlisted workspace/channel/users, durable intake deduplication, reactions and thread replies.
- GitHub Actions and Jenkins/CloudBees: read-only API polling, per-run identities, initial historical baseline, terminal-state distinctions and visible coverage/errors. Polling itself uses no LLM.
- Gerrit: read-only, bounded patchset polling with historical baseline and deduplication; new patchsets appear as observed tickets even in auto mode. Generic local Git checkouts support HTTPS and SSH origins, including Gerrit ports.
- Codex: isolated stdio process per task, verified restrictive permissions, dedicated Codex home, bounded execution and cancellation. No inherited integration-token environment.
- Durable SQLite tickets, pause/observe/auto modes, interrupted-work recovery and retrying Slack outbox.
- Authenticated dashboard: status, connection health, tickets and cancellation, configuration, token usage and explicitly estimated cost/value/ROI.
- Docker Compose or native systemd deployment on one VM. Default one worker and observe mode.

## Develop and verify

Requires Node 24+; no DSH dependencies are needed for the new service.

```sh
cd service
npm ci --ignore-scripts
npm test
node test/protocol-smoke.mjs   # requires installed Codex; no model turn is sent
node main.mjs init
node --env-file=data/service.env main.mjs
```

Open `http://127.0.0.1:3082`, using the admin token generated in private `service/data/service.env`. Configure a dedicated Codex home/account before requesting model work. State and secrets are ignored by Git. See [deployment instructions](deploy/README.md) for Slack, API tokens, repository selection and network requirements.

## Current release boundaries

- CI monitoring covers a configurable recent window. Coverage warnings are visible; it is not a lossless event archive. No webhook listener or CI build mutations.
- Automatic CI repair requires verified repository identity and a matching local commit. Jenkins metadata currently lacks complete historical repository provenance, so automatic repair fails closed; observation and explicit investigation remain available.
- One configured local repository and one worker. Authorized Slack thread followups create separate tickets while resuming the same Codex conversation and isolated workspace.
- Provider adapters currently collect build metadata, not full console logs, artifacts or test reports. Supply relevant bounded evidence in an explicit task when needed.
- No automatic pushes, PR creation or merges by the deployed agent. Results remain local for review. The development PR workflow for this fork is separate.
- No SSO, multi-tenancy, retention scheduler, cross-provider mirrored-run correlation or verified-fix tracking. Completed turns are not proof of repaired CI.
- Integration credentials and the live VM must be provided by the operator. [Verification evidence](docs/fork/verification.md) distinguishes fixture checks from real connections.

## Project records

[Current architecture](docs/008-architecture_new.md) · [Critical comparison and required parity work](docs/008-architecture_diff.md) · [Visual review](docs/architecture-review.html)

[Implementation plan](docs/fork/plan.md) · [Current context](context.md) · [Engineering skills](docs/skills.md) · [Agent conventions](AGENTS.md)
