# Quick VM deployment

Use a dedicated Linux VM/account. No cloud account or VM is provisioned by this repository. Requirements: Docker Engine with Compose, or Node 24+ and Codex CLI 0.166.0 for native systemd. State, tokens and worktrees belong to the VM, never the repository. The standalone service does not install or start DeepSeek Harness.

## Recommended: native VM service

On a dedicated Linux VM account, install Node 24+ and Codex CLI 0.166.0 through your approved package source. Clone this repository, then run:

```sh
./deploy/install-user-service.sh
```

The installer checks the real Codex permission profile without sending a model turn, installs locked service dependencies, initializes private state, and starts a systemd user service. It refuses to proceed when the sandbox check fails. The state directory defaults to `$XDG_STATE_HOME/codex-superagent` or `~/.local/state/codex-superagent`; override with `SUPERAGENT_STATE_DIR`. Your VM may require an administrator to enable user lingering (`loginctl enable-linger USER`) to keep it running after logout. Use `systemctl --user status codex-superagent` and `journalctl --user -u codex-superagent`. Supply credentials and dedicated Codex authentication as described below.

## Optional container path

From a checkout of this repository:

```sh
docker compose build
docker compose run --rm superagent node main.mjs init
```

Initialization writes private `/data/config.json` and `/data/service.env` into the named volume. It generates an admin token without printing it and refuses to overwrite existing configuration. For Compose only, set `host` to `0.0.0.0` inside that file; Docker publishes the port on VM loopback only:

```sh
docker compose run --rm superagent node -e 'const f="/data/config.json"; const fs=require("node:fs"); const c=JSON.parse(fs.readFileSync(f)); c.host="0.0.0.0"; fs.writeFileSync(f,JSON.stringify(c,null,2),{mode:384});'
docker compose up -d
docker compose logs --tail=30
docker compose exec superagent node --env-file=/data/service.env main.mjs doctor
```

Connect from your laptop with `ssh -L 3082:127.0.0.1:3082 USER@VM`, then open `http://127.0.0.1:3082`. Retrieve the admin token privately from `/data/service.env` and paste it into the login form. The page holds it only in memory. Do not expose plain HTTP to the internet. The bearer token grants configuration and execution authority; use an authenticated TLS reverse proxy for shared remote access.

To add integration credentials, use your VM's secret-management/editor workflow to populate the environment file in the named volume. Tokens go in `service.env`; JSON contains only environment-variable names. Restart after credentials/provider changes. `doctor` validates configuration, environment presence and binary version; it does not contact providers or prove model authentication.

Codex needs its own authentication in the dedicated home. Follow your organization's allowed Codex sign-in or API-key flow inside the container, with `CODEX_HOME=/data/codex` (e.g. `docker compose run --rm -e CODEX_HOME=/data/codex superagent codex login --device-auth`). Alternatively supply `OPENAI_API_KEY` through the private service environment. Do not copy your personal Codex home into the VM. Model access and billing depend on that account.

For code changes, clone a trusted repository under `/repos` as the container user and set `repositoryPath` in config. Use a credential helper or short-lived read token during operator-controlled clone/fetch; remove remote credentials afterward. The worker has no integration tokens or shell network access. Fetch required CI commit objects before authorizing repairs. Ticket checkouts use a verified local commit for CI; unrelated/unknown SCM fails closed. Explicit tasks use the configured checkout's HEAD. Keep a healthy disk budget; ticket checkouts are retained for review.

The sandbox must work under your VM/container kernel. The local Docker Desktop test blocked user namespaces; a successful image build and healthy dashboard do not prove worker execution. Run `docker compose run --rm superagent node test/protocol-smoke.mjs` before enabling tasks. A blocked sandbox is an execution failure; do not disable it or add privileged mode. Native systemd is the alternative when your Docker host blocks required unprivileged sandbox operations.

## Native path

Install Node 24+ and pin Codex 0.166.0 using your VM's package policy. Under the dedicated `superagent` account:

```sh
cd /opt/codex-superagent/service
npm ci --omit=dev --ignore-scripts
SUPERAGENT_CONFIG=/var/lib/codex-superagent/config.json node main.mjs init
```

Adapt `superagent.service.example` to the actual Node executable and installation paths; install it through your normal systemd workflow. Supply read-only API credentials in `/var/lib/codex-superagent/service.env` with mode 0600 and service-account ownership. Run `systemctl enable --now superagent`; inspect `journalctl -u superagent`. Keep `host=127.0.0.1` and use the SSH tunnel above.

## Connect Slack

Create an app from `slack-manifest.json`, install it to a test workspace, enable Socket Mode, and create an app-level token with `connections:write`. Put `SLACK_APP_TOKEN` and `SLACK_BOT_TOKEN` in the private environment file. In the dashboard configuration set `slack.enabled=true`, exact `teamId`, `botUserId`, `channelIds`, and `userIds`. Invite the bot to the chosen channel. Restart, then send an explicit `@Codex Superagent` task. Mention again for followups with the minimal manifest; broader message subscriptions are not enabled by default.

No webhook listener is required. Outbound access is required to Slack HTTPS/WebSocket endpoints. Terminal ticket results go through a durable retrying outbox. Network ambiguity can cause duplicate Slack delivery (at-least-once delivery); ticket IDs in messages make it identifiable. CI completion notifications use the first allowlisted Slack channel.

## Connect Jenkins / CloudBees

Use the controller URL, including its context path; configure each full folder/job name. The adapter uses standard Jenkins JSON APIs, so basic monitoring requires no CloudBees Pipeline Explorer plugin. Example operational config:

```json
{
  "jenkins": [{
    "id": "team-ci",
    "baseUrl": "https://jenkins.example.invalid/controller/",
    "usernameEnv": "JENKINS_USER",
    "tokenEnv": "JENKINS_API_TOKEN",
    "jobs": ["team/project/main"],
    "maxBuilds": 20,
    "timeoutMs": 15000
  }]
}
```

Put username/API token in the named environment variables. Grant controller read plus job read on configured jobs; no build, cancel, configure or administrative permission. Jenkins job names containing slashes as a single encoded branch segment may need an exact full job URL; consult connector support before treating display names as paths. Requests verify TLS and reject redirects. For enterprise private CAs, install the CA into the VM trust configuration; never disable TLS verification. Check VPN/firewall reachability separately.

Running builds, terminal failure, unstable, aborted and not-built remain distinct. Initial snapshots baseline old failures. Bounded history means builds outside the polling window can be missed; dashboard exposes incomplete coverage. Increase bounds or decrease the interval where necessary. Historical Jenkins SCM may be unknown; monitoring still works, automatic repair requires verified repository and commit evidence.

## Connect GitHub Actions

Create a fine-grained token for explicitly selected repositories with Actions read permission. Set `GITHUB_TOKEN` privately. Example:

```json
{
  "github": [{
    "id": "github-ci", "baseUrl": "https://api.github.com",
    "tokenEnv": "GITHUB_TOKEN",
    "repositories": [{"owner": "OWNER", "repo": "REPO", "workflows": []}],
    "maxPages": 3, "perPage": 30, "timeoutMs": 15000
  }]
}
```

`workflows` can narrow monitoring to workflow IDs or filenames. GitHub Enterprise uses its API base URL. Rate limits/authentication errors appear as degraded health, never successful recovery. A GitHub check that mirrors Jenkins is not automatically correlated in this release; configure one authoritative monitor to avoid duplicate tickets.

## Operating modes, economics and backup

Start with `observe`. CI creates visible observed tickets without model calls; explicit authorized Slack/UI requests can execute. `auto` permits eligible new CI failures to execute. `paused` records intake but stops new execution; cancel a running ticket separately. Pausing does not revoke a running process. Resume queued work with observe/auto as appropriate. Observed CI tickets are not retroactively executed merely by switching mode.

Enter your own token rates and hourly/saved-minute assumptions in `economics`. Unknown rates display unavailable, not zero. Cost is an estimate, not an invoice; completed turns do not prove a CI fix or measured time savings. Fixed cost is a cumulative amount for the same lifetime scope as dashboard counters.

Stop the service before backing up the named state volume (SQLite, Codex home, config, environment) and repository volume together; store backups encrypted because they contain secrets and task data. For native deployment stop systemd and copy state plus repository and ticket checkout data. Keep a version tag/image and a state backup before upgrading; restore both for rollback. No scheduled retention or database migrations beyond schema creation exist in this first release.

## Verification boundary

Automated checks exercise provider fixtures and the local service; real provider permissions, Slack delivery, a paid model turn and target VM sandbox behavior must be tested with your environment. See `docs/fork/verification.md` for exact release evidence.

Corporate networks may require a registry mirror during image build: `docker compose build --build-arg NPM_REGISTRY=https://YOUR-APPROVED-REGISTRY`. Keep credentials out of build arguments; use your organization’s secret-mounted build workflow for authenticated registries. Public npm remains the default.
