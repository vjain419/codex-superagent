# Codex Superagent implementation plan

Owner: Vinay. Baseline: `deepseek-ai/dsh-superagent-prototype` commit `6337fc823ce20251c8de8085948165c81aaa701e`. This repository preserves its MIT license and history.

## Product outcome

A small service on one Linux VM: accept authorized Slack requests, monitor GitHub Actions and explicitly configured Jenkins/CloudBees jobs, persist useful work, run Codex app-server in isolated ticket workspaces, and report results to Slack. An authenticated local dashboard shows health, tickets, configuration, usage and explicitly labelled ROI estimates. Polling is deterministic; unchanged CI consumes no model tokens.

## Milestones and acceptance gates

Implementation complete in `service/`; deployment packaging and verification records accompany the release. See `context.md` for landed milestones and `verification.md` for the distinction between local tests and pending live rollout. The standalone release implements the workflow concepts in a small Node service; it does not claim feature parity or reuse of the entire original DSH core.

1. **Foundation and working conventions.** Install repository skills with pinned provenance, document upstream attribution, TDD, model roles and context. Verify links and absence of secrets. PR with only conventions and plan.
2. **Standalone engine.** Separate Node 24 service, durable SQLite tickets/events/outbox, observe/auto gating, restart recovery and restricted Codex stdio executor. Tests cover duplicate events, authorization, baseline suppression, crash recovery, child errors/timeouts and protocol messages. Legacy Harness remains available for comparison but is excluded from the new service dependency graph.
3. **Sources and service API.** GitHub Actions and Jenkins/CloudBees API pollers; Slack Socket Mode with team/channel/user allowlists and thread replies; persistent poll state; authenticated service routes. Tests use fake providers and cover terminal state mapping, retries, duplicate delivery and unauthorized requests. No CI mutation privileges needed.
4. **Operator experience and deployment.** Dashboard for status, tickets, configuration, measured tokens and cost estimates; operator-entered benefit assumptions. Versioned configuration, atomic updates, secret references, quick VM deployment and health checks. Document real connection requirements and exercise a local end-to-end fixture.

Each major milestone gets a focused branch, meaningful commits, a PR, verification, and a merge to `main`. User has authorized these merges. Never force-push `main`. Keep this plan and `context.md` consistent with evidence; label any unverified live integration.

## Architecture and constraints

`Slack / CI APIs → allowlist and normalization → durable events → policy → ticket → Codex app-server → durable outbox → Slack`

The dashboard reads this same state. One worker is the initial default. A trusted local repository supplies sanitized local clones; Slack thread followups reuse the initial thread workspace. This costs more disk than shared worktrees but keeps source Git credential/config metadata out of the worker. Model execution has a timeout, no inherited integration tokens, a dedicated Codex home, workspace-limited writes and no shell network access in the initial sandbox, with eligible boundary crossings routed through automatic approval review. Built-in workspace permissions allow broader reads; OS account/container separation is required to hide unrelated credentials. Controller credentials stay out of worker environment. OS isolation still matters: deploy under a dedicated VM account; a checkout alone is not a sandbox.

Configuration is an explicit JSON document with environment-variable references for secrets. Start in observe mode; enabling automatic CI work is a deliberate operator configuration. An initial successful poll baselines historical builds. Every provider run/attempt has a durable identity; distinct failed builds remain distinct even when the failure signature repeats. Cancelled/not-built outcomes do not authorize repairs. Unknown SCM links stay unknown.

## API connections

- Slack: Socket Mode app token (`connections:write`); bot scopes `app_mentions:read`, `chat:write`, `reactions:write` and `channels:history`; bot events `app_mention` and `message.channels`. Optional private-channel followups require `groups:history` and `message.groups`. Credentials come from the environment. The service filters by team/channel/user and permits non-mention followups only in authorized threads; replies remain in the originating thread.
- Jenkins/CloudBees: dedicated read-only user plus API token; exact controller and nested job URLs. Read the standard Jenkins JSON Remote Access API. Preserve TLS validation, reject credential-bearing redirects, bound pages and response sizes. CloudBees-specific plugins are not required for basic build monitoring. Do not grant build/abort/configure permissions.
- GitHub: scoped token with Actions read access for configured repositories; poll workflow runs. No repository write token needed for monitoring.

## Engineering team and model choice

Root acts as product manager/integrator. GPT-6.1 Sol High owns sustained runtime engineering; GPT-6.1 Terra Max handles the bounded connector implementation; GPT-6 Luna High handles skill inventory, docs checks and focused verification. Escalate difficult defects to Sol rather than repeatedly spending on an unsuitable smaller model. These development roles are separate from the deployed service's configurable worker model.

Official model guidance supports Sol for long-running code work and Luna for focused repeatable work. At Standard Codex credit rates per million tokens, Sol input/output is 50/250, Terra 25/125 and Luna 2.5/12.5. Rates are evidence for routing, not a prediction of total task cost: reasoning length and retries matter. No directly comparable current benchmark table for all three was established; do not invent scores. Re-check rates before financial decisions.

Sources checked 2026-11-01:
- https://learn.chatgpt.com/docs/models
- https://learn.chatgpt.com/docs/pricing
- https://learn.chatgpt.com/docs/app-server
- https://www.jenkins.io/doc/book/using/remote-access-api/
- https://docs.slack.dev/apis/events-api/using-socket-mode/
- https://docs.github.com/en/rest/actions/workflow-runs

Context7 tools are not available in this session. Use official provider documentation and executable protocol fixtures; record this limitation rather than claiming Context7 validation.

## Measurement

Measured: event counts, ticket outcomes, queue/runtime duration, provider poll errors, outbox retries, token usage where Codex emits it. Estimated: token cost from explicitly configured rates; value from operator-entered saved minutes and hourly rate. ROI is `(estimated benefit - configured costs) / configured costs`; unknown or zero denominators display unavailable. Completed model output is not proof of a fixed CI failure. No fabricated time savings or default claims of business value.

## Release boundary

Automated and local fixture checks can be completed without production credentials. A live VM rollout, real Slack round trip, Jenkins controller permissions and a paid Codex model turn require operator-provided target configuration and credentials; report them as pending until actually exercised. Production SSO, multi-tenancy, autonomous merging in monitored repositories and arbitrary CI control are outside this first release.
