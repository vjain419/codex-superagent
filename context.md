# Current context

## Goal and provenance

Standalone Codex app-server fork of [`deepseek-ai/dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype), baseline `6337fc823ce20251c8de8085948165c81aaa701e`. Owner: Vinay. Preserve upstream license/history. [Plan](docs/fork/plan.md), [deployment](deploy/README.md), [verification](docs/fork/verification.md).

## Implemented

- `service/`: Node 24+, SQLite tickets/events/outbox, observe/auto/paused policy, single worker, exclusive instance ownership, restart recovery and cancellation.
- Built-in `:workspace` Codex app-server per turn with on-request automatic approval review; effective profile/reviewer/sandbox checked before inference, inherited MCP server entries disabled; sanitized local clone, no source Git credential/config sharing; verified CI repo/commit or fail closed.
- Slack Socket Mode with explicit identity allowlists; authorized replies in an existing Slack thread resume its saved Codex session and isolated workspace, with a separate audit ticket per message. Durable message reactions show eyes while queued/running, done on completion (checkmark fallback), and x on failure; GitHub Actions + standard Jenkins/CloudBees API readers; initial bounded baseline and durable dedup.
- Gerrit read-only patchset reader with exact project allowlists, bounded baseline and observed-only tickets in every mode. Status is captured at first observation; status-only transitions are not a separate feed. Generic SSH/scp Git identities retain nondefault ports; explicit internal SCM tasks verify origin and locally available SHA.
- Authenticated dashboard with queue/running counts, readable ticket lifecycle, results/errors, token usage and Slack reply-delivery attempts, plus configuration and explicitly estimated economics. Ticket detail refreshes while open; raw JSON remains available for diagnostics. Lifecycle times reflect stored records, not individual tool calls or a model transcript. Configuration saves show progress, success/restart requirements and errors beside the button; failed or unconfirmed saves preserve the draft.
- Native systemd user installer, Docker/Compose packaging, connection templates and CI workflow.
- 59 repository skills: 39 Matt Pocock, 18 focused pstack, ponytail and Karpathy. Default ponytail full, TDD. Source pins/license notices in [skills](docs/skills.md).

## Workflow

Root product manager/integrator; Sol 6.1 High engineering; Terra Max bounded connector work; Luna High focused validation/docs. User authorizes tested commits, milestone PRs and merges to main. Keep deployment inventories and company-specific configuration outside this public checkout; publication rules are in AGENTS.md. Use installed TDD and pstack verification where relevant, and update this file when behavior changes.

Milestone PRs: [foundation #1](https://github.com/vjain419/codex-superagent/pull/1), [Codex runtime #2](https://github.com/vjain419/codex-superagent/pull/2), [connectors/service/dashboard #3](https://github.com/vjain419/codex-superagent/pull/3). [deployment/release #4](https://github.com/vjain419/codex-superagent/pull/4) packages the release and records validation.

## Evidence and next live checks

Service and deployment regression suites include durable Slack continuity, exact conversation isolation, reaction retry/recovery, Gerrit and Git identity coverage. The initial 51-test release also passed in the Node 24 Linux container; real no-inference Codex protocol smoke and browser workflow verified; service dependency audit reported zero advisories. Exact scope and commands: [verification record](docs/fork/verification.md).

Host deployment results stay in private operator records. Credentials, Slack identities and provider projects/jobs are private operator inputs. Keep SQLite state on durable local storage; NFS/SMB is unsupported. Default Docker Desktop blocks Codex user namespaces; do not disable the inner sandbox. Use the native VM path and pass protocol smoke on the actual host. Repository tests use fixtures; live provider and model evidence belongs in private operator records. Jenkins automatic repair requires more provenance than its current adapter supplies; use observation/explicit tasks. Initial release retains legacy DSH source for reference, without loading it into the standalone service.

## Permission compatibility update

The executor uses built-in `:workspace` instead of a custom profile so managed allowlists can accept it. `approvals_reviewer=auto_review` handles eligible escalations; unsupported interactive requests still fail closed. No full-access fallback. Built-in workspace permits broader host reads than the previous custom credential-deny profile; dedicated OS identity/container isolation is needed for unrelated secrets. Protocol smoke checks these effective settings and verifies an inherited synthetic MCP process never launches, without a model turn. Live account/host checks belong only in private operator records.

## Slack continuity and operating limits

Exact workspace/team/channel/thread identity selects one durable conversation. Followups keep separate tickets for cancellation, usage and audit, but resume the saved Codex thread. Preserve SQLite, the dedicated Codex home and workspace directories together. Missing or mismatched state fails closed; pre-upgrade recovery selects only the latest matching old session, without merging earlier independent histories. SCM-pinned work requires a new root thread. Slack must subscribe to `message.channels` for public-channel plain replies; private channels additionally need `message.groups` and its history scope.

The controller polls explicitly configured CI/Gerrit sources; it does not independently discover monitoring targets. Workers currently have inherited MCP servers disabled and may not contact external services. Configure a repository before expecting source inspection. Successful ticket status means the Codex turn completed, not that a reported blocker was resolved. Workspace retention remains operator-managed; each new conversation copies repository objects.

## Architecture fidelity review

The canonical current topology is `docs/008-architecture_new.md`; the independent findings, differences and required restoration gates are in `docs/008-architecture_diff.md`, with a visual companion. The standalone service does not use the preserved upstream Engine. Conversation resume is verified, but continuing task authority, active steering, structured reports/questions and autonomous recovery remain missing. Preserve upstream principles through its core ports; do not treat those gaps as optional feature differences or claim parity from the standalone test suite.
