# Current context

## Goal and provenance

Standalone Codex app-server fork of [`deepseek-ai/dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype), baseline `6337fc823ce20251c8de8085948165c81aaa701e`. Owner: Vinay. Preserve upstream license/history. [Plan](docs/fork/plan.md), [deployment](deploy/README.md), [verification](docs/fork/verification.md).

## Implemented

- `service/`: Node 24+, SQLite tickets/events/outbox, observe/auto/paused policy, single worker, exclusive instance ownership, restart recovery and cancellation.
- Restricted Codex app-server per ticket; sanitized local clone, no source Git credential/config sharing; verified CI repo/commit or fail closed.
- Slack Socket Mode with explicit identity allowlists; GitHub Actions + standard Jenkins/CloudBees API readers; initial bounded baseline and durable dedup.
- Gerrit read-only patchset reader with exact project allowlists, bounded baseline and observed-only tickets in every mode. Status is captured at first observation; status-only transitions are not a separate feed. Generic SSH/scp Git identities retain nondefault ports; explicit internal SCM tasks verify origin and locally available SHA.
- Authenticated dashboard with status, tasks, configuration, usage and explicitly estimated economics.
- Native systemd user installer, Docker/Compose packaging, connection templates and CI workflow.
- 59 repository skills: 39 Matt Pocock, 18 focused pstack, ponytail and Karpathy. Default ponytail full, TDD. Source pins/license notices in [skills](docs/skills.md).

## Workflow

Root product manager/integrator; Sol 6.1 High engineering; Terra Max bounded connector work; Luna High focused validation/docs. User authorizes tested commits, milestone PRs and merges to main. Keep deployment inventories and company-specific configuration outside this public checkout; publication rules are in AGENTS.md. Use installed TDD and pstack verification where relevant, and update this file when behavior changes.

Milestone PRs: [foundation #1](https://github.com/vjain419/codex-superagent/pull/1), [Codex runtime #2](https://github.com/vjain419/codex-superagent/pull/2), [connectors/service/dashboard #3](https://github.com/vjain419/codex-superagent/pull/3). [deployment/release #4](https://github.com/vjain419/codex-superagent/pull/4) packages the release and records validation.

## Evidence and next live checks

63 service tests pass locally, including Gerrit and Git identity regression coverage. The initial 51-test release also passed in the Node 24 Linux container; real no-inference Codex protocol smoke and browser workflow verified; service dependency audit reported zero advisories. Exact scope and commands: [verification record](docs/fork/verification.md).

Host deployment results stay in private operator records. Credentials, Slack identities and provider projects/jobs are private operator inputs. Keep SQLite state on durable local storage; NFS/SMB is unsupported. Default Docker Desktop blocks Codex user namespaces; do not disable the inner sandbox. Use the native VM path and pass protocol smoke on the actual host. No live provider connection or paid model turn has been tested. Jenkins automatic repair requires more provenance than its current adapter supplies; use observation/explicit tasks. Initial release retains legacy DSH source for reference, without loading it into the standalone service.
