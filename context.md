# Current context

## Goal
Codex app-server fork of DeepSeek Superagent, with Slack, GitHub Actions, Jenkins/CloudBees, quick VM deployment and an authenticated operator dashboard. See [implementation plan](docs/fork/plan.md).

## State
- Fork baseline: `6337fc823ce20251c8de8085948165c81aaa701e`.
- Standalone service implementation in progress under `service/`; legacy source remains in `src/`.
- Default development convention: ponytail full, Karpathy guidelines, TDD.
- User authorizes tested milestone PRs and merges to main without another approval.

## Verification boundary
No production CI job, Slack channel, VM or model credential has been configured for this service. Fixture tests must not be described as a live deployment.

## Next
Complete foundation, runtime, connectors, dashboard and VM milestones. Update this file with exact commands/results and PRs as they land.
