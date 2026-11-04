# Verification record

Date: 2026-11-01. This records observed behavior, not a production certification.

## Passing checks

- `npm --prefix service test`: 63 tests on Node 26.7.0 after the Gerrit/Git extension.
- Initial 51-test release suite inside the built Linux ARM64 image on Node 24.22.2; current PR CI validates the extended suite.
- Real installed Codex app-server handshake: initialize, initialized and thread/start; active custom permission profile, workspace writes, shell network disabled and approval never verified. The smoke intercepts turn/start before sending it: no authentication or model inference.
- Stable Codex 0.166.0 Linux protocol smoke also passes under diagnostic outer-container seccomp settings with the inner Codex sandbox still enabled. Default Docker Desktop restrictions block required user namespaces; see limitations below.
- `deploy/smoke-container.sh`: fresh private state initialization; reachable health and dashboard; anonymous API rejected; authenticated status; a second process rejected before state recovery; clean shutdown. Fixture volume/container removed after test.
- Playwright with real Store/Runtime and fake executor: login, pause configuration, queued task, inspect, cancellation, resume, completed task. Desktop and 390px viewport checked; no horizontal overflow or browser page errors.
- Docker image built as non-root runtime; Compose validation and deployment shell syntax passed.
- Two native-unit regression tests pass, including real Linux systemd parser verification. The installer renders scalar paths correctly and validates the temporary unit before replacement.
- `npm audit --prefix service --omit=dev`: zero reported advisories for the standalone service dependency graph at verification time. This does not cover the retained legacy DSH dependency graph or OS packages.
- Repository diff whitespace checks and secret-pattern inspection passed. No production token, auth.json, cookie or credential was committed.

## Regression evidence

Tests reproduced and fixed: unsupported/malformed config, unauthenticated API access, JSON media-type casing, pending provider saves lost after a mode-only edit, false restart warnings, duplicate intake, pause bypass, multiple service ownership, process exit/timeouts/unsupported approvals, weak permission profiles, completion preceding turn-start response, Linux denied-directory path handling, checkout filters executing outside a ticket, source Git credentials leaking into ticket metadata, duplicate CI states, baseline replay, missing CI provenance, cancellation and interrupted restart recovery.

The executor tests use a real fixture subprocess speaking JSONL, and checkout tests use real temporary Git repositories. Provider tests use fixture HTTP responses, including real Slack SDK initialization with injected transport. UI workflow uses a fake executor. These checks do not prove live provider permissions or model quality.

Gerrit extension coverage: JSON prefix parsing, exact project boundaries, returned-count pagination, truncated/failed snapshots, baseline suppression, durable patchset deduplication, observed-only policy even in auto mode, old configuration compatibility, dashboard persistence, and SSH/scp remote matching with nondefault port rejection. Explicit SCM requests pin a verified local commit rather than silently using HEAD.

## Remaining verification

- Native service installation requires host-specific validation; deployment inventories and results belong in private operator records.
- No live Slack app, GitHub token or Jenkins/CloudBees account supplied; no production messages, CI changes or provider authentication tests performed.
- No paid model turn through this service. Model account availability, usage billing and actual task quality remain to be tested using a dedicated account.
- Default Docker Desktop execution fails closed because user namespaces required by the Codex sandbox are blocked. Packaging and dashboard work; worker readiness must pass `node service/test/protocol-smoke.mjs` on the intended deployment host. Production Compose does not disable seccomp or grant privileged mode. Prefer native VM deployment.
- Dockerfile and lockfile URLs default to public npm. The image accepts an explicit registry build argument; keep authenticated registry configuration in private build infrastructure.
- GitHub-hosted workflow status is attached to the deployment PR; local passing checks alone are not claimed as remote CI results.

## Product limits

One repository/worker, bounded polling windows, fresh Codex threads and sanitized local clones for independent work; authorized Slack followups resume their conversation, no automatic fetch/push/PR/merge, no full console/artifact extraction, no cross-provider mirrored-run correlation. Jenkins historical repository provenance is unknown; automatic repair fails closed. Slack replies are at-least-once: an ambiguous send/crash may duplicate a result. Disk retention is operator-managed. Financial figures are explicit estimates; successful turns do not establish fixed CI or measured labor savings.

## Security and egress

The standalone service has no analytics exporter and does not run DeepSeek Harness. Expected outgoing traffic: configured GitHub/Jenkins/Gerrit APIs, Slack HTTPS/WebSockets, and the configured Codex model provider. Prompts, selected task evidence and tool results can go to that model provider. Codex's own data controls remain relevant; this implementation is not a packet-capture audit or a promise of zero host telemetry.

Integration tokens stay in the controller's environment; the worker receives a minimal environment and a dedicated Codex home. Ticket clones omit source Git config, hooks and shared object alternates, and host checkout filters are disabled. Shell filesystem/network enforcement relies on the verified Codex profile and deployment OS. Run on a dedicated account/VM, keep secrets out of tracked source, and validate the sandbox on that host before enabling work.

## Built-in workspace and automatic review

- Regression reproduced before the change: an allowed built-in workspace response was rejected by the custom-profile check. After the change, that task completes through the protocol fixture.
- Separate regression reproduced inherited MCP entries remaining enabled; the executor now reads effective configuration and explicitly disables each inherited server before thread creation.
- 68 service tests plus 2 deployment tests pass locally, including incorrect profile, approval policy, reviewer, network access and sandbox rejection, along with existing timeout/cancellation cases.
- Real local Codex protocol smoke verifies built-in `:workspace`, `on-request`, `auto_review`, workspace writes and initially disabled network access. A synthetic inherited MCP sentinel does not launch. No model turn sent. The earlier custom-profile smoke above records historical behavior.
- Built-in workspace allows broader reads than the old custom profile; automatic review may approve boundary-crossing actions. This is not equivalent to the former credential-deny filesystem policy. Use OS account/container separation for unrelated secrets; verify managed-account compatibility privately on the deployment host.

## Dashboard configuration feedback

- Reproduced validation rejection in Chrome with no visible feedback beside the save button. The API rejected invalid values correctly; its message appeared above the dashboard, outside the current viewport.
- Added an inline live status region, saving/disabled button state and a 15-second save-request timeout. Connection failures report an unconfirmed save (a lost response does not prove the server failed to write); the draft remains available. Provider changes still require a service restart.
- Optional browser regression uses the real HTTP/config persistence path with a temporary configuration and stub metrics/ticket data. It checks visible validation errors, unchanged disk after rejection, successful save/restart feedback, disk persistence after reload, and connection failure with draft retention. No model or external integration is called.
- Run with Chrome installed and an external Playwright installation: `node service/test/dashboard-smoke.mjs /absolute/path/to/playwright/index.mjs`. Playwright is a test tool, not a service dependency.

## Ticket observability

- Operational counters use database-wide metrics, independently of the most recent 100 tickets shown in the list. Running work, queued requests, observed items, terminal outcomes and pending replies are separate states.
- Ticket inspection presents request, source, recorded lifecycle timestamps, outcome/error and token usage. Slack delivery summaries expose pending/sent status, attempts, last recorded attempt time and scheduled retry. Successful execution does not imply successful reply delivery.
- Authenticated ticket detail adds `deliveries`; list responses retain their existing shape. Older delivery records without an attempt timestamp remain readable, with unavailable timestamps left unknown. The storage change adds an index and a JSON field for future attempts; no table-column migration or historical timestamp reconstruction.
- HTTP regression failed before implementation because delivery evidence was absent. It now passes against a real temporary Store and Monitor with a fixture sender: execution success with pending delivery, failed delivery/backoff, successful retry, pending-reply counters, anonymous denial and unknown-ticket handling.
- The lifecycle view is not a command-by-command execution log or model reasoning transcript. Individual tool calls are not retained by the current runtime. No live model turn is required for these checks.
- Optional Chrome check: `node service/test/dashboard-observability.mjs /absolute/path/to/playwright/index.mjs [desktop-screenshot.png] [mobile-screenshot.png]`. Uses real Store/HTTP endpoints with synthetic tickets, verifies whole-database counters beyond the 100-row list, readable Inspect, actual periodic refresh, delivery transitions, literal rendering of HTML-like text, failure/interruption and mobile overflow. Existing dashboard-save smoke remains applicable.
- Final local verification: 69 service tests plus 2 deployment tests pass; dashboard-save browser regression also passes. Browser observability fixtures do not send Slack messages or invoke a model.

## Slack conversation continuity and reactions

- Red/green regressions reproduce lost workspace/context across followups and restart, incorrect start-versus-resume protocol calls, commentary leaking into final replies, and SCM-pinned work attempting to reuse an unrelated revision.
- Durable conversation ownership is exact to workspace/team/channel/thread; tests reject cross-conversation reuse, missing workspace state and resumed session identity mismatches. Session IDs persist before inference so failed or cancelled turns retain their conversation.
- Reactions target the triggering message timestamp. Tests cover pending eyes, completion done with invalid-name checkmark fallback, failure x, independent reply delivery, delayed retries, restart recovery and stale in-flight acknowledgements.
- Forwarded message text is bounded and explicitly framed as untrusted evidence. Manifest regression requires public-channel message events and reaction permissions. Existing installations must save the event subscription; manifest changes do not update deployed Slack apps automatically.
- Real app-server protocol smoke validates startup/resume permission compatibility without forwarding a model turn. Paid/live deployment evidence stays in private operator records.

## Independent architecture review (2026-11-04)

- Review baseline `90e07da` against preserved upstream `6337fc8`: three independent roles covered domain behaviour, connectors/authority and executable/deployment validation. Full findings, open defects and restoration gates: [architecture difference](../008-architecture_diff.md). Passing standalone tests does not establish original lifecycle parity.
- Baseline: 93 service tests + 3 deployment tests passed. After bounded review fixes: `node --test service/test/*.test.mjs deploy/test/*.test.mjs` passes 100 tests (97 service, 3 deployment), no skips. Local systemd parser was unavailable; the deployment test reports that limitation instead of proving a local parser run.
- Delayed outbox regression failed before the change with zero sends for a ready message behind 20 delayed rows; filtering due rows before the limit fixes it while preserving attempt and retry inspection.
- Configuration regressions failed before aligning GitHub page/selector bounds, provider timeouts, Jenkins job syntax and enabled Slack ID syntax with connector validation; valid boundary cases still pass.
- Real installed Codex no-inference protocol smoke, dashboard JavaScript syntax and deployment shell syntax pass. The protocol smoke intercepts inference, injects synthetic history and checks a fresh-process resume; it is not a real service-crash or host-sandbox enforcement test.
- Read-only live GitHub adapter probe against this public repository returned five events with `healthy=true`, `snapshotComplete=true`, `complete=false` and the expected bounded-coverage warning. No source was enabled and no remote state changed. This does not exercise multiple-selector failure/alias scenarios.
- Existing private live Slack/Codex and repository-access evidence was rechecked, including saved session/workspace reuse and sent replies. No new paid turn was needed for this audit. Live Jenkins/CloudBees and Gerrit credentials/targets were not configured in the reviewed deployment, so their operational connectivity remains unverified.
- Chrome observability regression passed again after the outbox change, including pending/retry/sent visibility and mobile layout.
- Visual companion uses a rendered HTML walkthrough and source-backed diagrams; Markdown remains the canonical detailed architecture record. Public artifacts contain synthetic examples only.
