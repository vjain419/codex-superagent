# Verification record

Date: 2026-11-01. This records observed behavior, not a production certification.

## Passing checks

- `npm --prefix service test`: 51 tests on Node 26.7.0.
- Same 51-test suite inside the built Linux ARM64 image on Node 24.22.2.
- Real installed Codex app-server handshake: initialize, initialized and thread/start; active custom permission profile, workspace writes, shell network disabled and approval never verified. The smoke intercepts turn/start before sending it: no authentication or model inference.
- Stable Codex 0.166.0 Linux protocol smoke also passes under diagnostic outer-container seccomp settings with the inner Codex sandbox still enabled. Default Docker Desktop restrictions block required user namespaces; see limitations below.
- `deploy/smoke-container.sh`: fresh private state initialization; reachable health and dashboard; anonymous API rejected; authenticated status; a second process rejected before state recovery; clean shutdown. Fixture volume/container removed after test.
- Playwright with real Store/Runtime and fake executor: login, pause configuration, queued task, inspect, cancellation, resume, completed task. Desktop and 390px viewport checked; no horizontal overflow or browser page errors.
- Docker image built as non-root runtime; Compose validation and deployment shell syntax passed.
- `npm audit --prefix service --omit=dev`: zero reported advisories for the standalone service dependency graph at verification time. This does not cover the retained legacy DSH dependency graph or OS packages.
- Repository diff whitespace checks and secret-pattern inspection passed. No production token, auth.json, cookie or credential was committed.

## Regression evidence

Tests reproduced and fixed: unsupported/malformed config, unauthenticated API access, JSON media-type casing, pending provider saves lost after a mode-only edit, false restart warnings, duplicate intake, pause bypass, multiple service ownership, process exit/timeouts/unsupported approvals, weak permission profiles, completion preceding turn-start response, Linux denied-directory path handling, checkout filters executing outside a ticket, source Git credentials leaking into ticket metadata, duplicate CI states, baseline replay, missing CI provenance, cancellation and interrupted restart recovery.

The executor tests use a real fixture subprocess speaking JSONL, and checkout tests use real temporary Git repositories. Provider tests use fixture HTTP responses, including real Slack SDK initialization with injected transport. UI workflow uses a fake executor. These checks do not prove live provider permissions or model quality.

## Remaining verification

- No target VM or SSH connection supplied; the native systemd installer is syntax/preflight reviewed but has not been installed on a user's VM.
- No live Slack app, GitHub token or Jenkins/CloudBees account supplied; no production messages, CI changes or provider authentication tests performed.
- No paid model turn through this service. Model account availability, usage billing and actual task quality remain to be tested using a dedicated account.
- Default Docker Desktop execution fails closed because user namespaces required by the Codex sandbox are blocked. Packaging and dashboard work; worker readiness must pass `node service/test/protocol-smoke.mjs` on the intended deployment host. Production Compose does not disable seccomp or grant privileged mode. Prefer native VM deployment.
- Local build required the organization's npm mirror because direct public-registry access from Docker timed out. Dockerfile defaults to public npm and accepts an explicit registry build argument. Lockfile URLs are public npm URLs; no corporate registry credentials are embedded.
- GitHub-hosted workflow status is attached to the deployment PR; local passing checks alone are not claimed as remote CI results.

## Product limits

One repository/worker, bounded polling windows, per-ticket fresh Codex thread and sanitized local clone, no automatic fetch/push/PR/merge, no full console/artifact extraction, no cross-provider mirrored-run correlation. Jenkins historical repository provenance is unknown; automatic repair fails closed. Slack replies are at-least-once: an ambiguous send/crash may duplicate a result. Disk retention is operator-managed. Financial figures are explicit estimates; successful turns do not establish fixed CI or measured labor savings.

## Security and egress

The standalone service has no analytics exporter and does not run DeepSeek Harness. Expected outgoing traffic: configured GitHub/Jenkins APIs, Slack HTTPS/WebSockets, and the configured Codex model provider. Prompts, selected task evidence and tool results can go to that model provider. Codex's own data controls remain relevant; this implementation is not a packet-capture audit or a promise of zero host telemetry.

Integration tokens stay in the controller's environment; the worker receives a minimal environment and a dedicated Codex home. Ticket clones omit source Git config, hooks and shared object alternates, and host checkout filters are disabled. Shell filesystem/network enforcement relies on the verified Codex profile and deployment OS. Run on a dedicated account/VM, keep secrets out of tracked source, and validate the sandbox on that host before enabling work.
