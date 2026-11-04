# Quick VM deployment

Use a dedicated Linux VM/account. No cloud account or VM is provisioned by this repository. Requirements: Docker Engine with Compose, or Node 24+ and Codex CLI 0.166.0 for native systemd. State, tokens and worktrees belong to the VM, never the repository. The standalone service does not install or start DeepSeek Harness.

This is a public repository. Keep private company identifiers, VM addresses, internal repository/controller URLs, channel/user identifiers, project paths and deployment logs in private operator storage outside the checkout. Public examples, issues, commits and PRs must use synthetic values.

## Recommended: native VM service

On a dedicated Linux VM account, install Node 24+ and Codex CLI 0.166.0 through your approved package source. Clone this repository, then run:

```sh
./deploy/install-user-service.sh
```

The installer checks the real Codex permission profile without sending a model turn, installs locked service dependencies, initializes private state, and starts a systemd user service. It refuses to proceed when the sandbox check fails. The state directory defaults to `$XDG_STATE_HOME/codex-superagent` or `~/.local/state/codex-superagent`; override with `SUPERAGENT_STATE_DIR`. Your VM may require an administrator to enable user lingering (`loginctl enable-linger USER`) to keep it running after logout. Use `systemctl --user status codex-superagent` and `journalctl --user -u codex-superagent`. Supply credentials and dedicated Codex authentication as described below.

Check `findmnt -T /PATH/TO/STATE` before installation. Live SQLite state and its instance lock require a durable local filesystem; NFS/SMB homes or project shares are unsupported. Use `SUPERAGENT_STATE_DIR` to select private local storage, outside temporary-directory cleanup. Source code can live on a project share. Stop the service before copying its state to a network share for backup; never copy a live database and WAL independently. See [SQLite WAL requirements](https://www.sqlite.org/wal.html).

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

For code changes, clone a trusted repository under `/repos` as the container user and set `repositoryPath` in config. Use a credential helper or short-lived read token during operator-controlled clone/fetch; remove remote credentials afterward. The worker environment excludes integration tokens; shell network access is disabled inside the initial workspace sandbox. Eligible boundary-crossing actions use automatic approval review. Fetch required CI commit objects before authorizing repairs. Ticket checkouts use a verified local commit for CI; unrelated/unknown SCM fails closed. Explicit tasks use the configured checkout's HEAD. Keep a healthy disk budget; ticket checkouts are retained for review.

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

The repository already includes [`slack-manifest.json`](slack-manifest.json). A dedicated app/bot keeps permissions and credentials separate from other apps. An existing app can work if its owner adds the required scopes, event subscription and Socket Mode settings; reinstall after scope changes.

1. In [Slack app management](https://api.slack.com/apps), choose **Create New App → From a manifest** and paste the JSON manifest. Select a test workspace and follow its app-approval policy. The manifest enables Socket Mode, `app_mention` and `message.channels` events, and bot scopes `app_mentions:read`, `chat:write`, `reactions:write` and `channels:history`.
2. Under **Basic Information → App-Level Tokens**, generate an app token with `connections:write`. Store it as `SLACK_APP_TOKEN` in the private VM environment file. This app-token scope is separate from the manifest's bot scopes.
3. Install the app to the workspace. Store the **Bot User OAuth Token** as `SLACK_BOT_TOKEN` in that same private file; never paste either token into dashboard JSON, issues or chat.
4. Set `slack.enabled=true`, exact `teamId`, `botUserId`, `channelIds`, and `userIds` in the dashboard configuration. `botUserId` is the bot's user ID, not the app ID; Slack's authenticated `auth.test` response supplies `team_id` and `user_id`. Invite the bot to the allowlisted channel.
5. Restart the service, check Slack connection health, then send an explicit `@Codex Superagent` task from an allowlisted user. Codex authentication and a trusted repository must also be configured before code tasks can succeed.

For an existing app, open [Slack app management](https://api.slack.com/apps), select the app, then use **Event Subscriptions → Subscribe to bot events → Add Bot User Event** to add `message.channels`; save changes. Add any missing bot scopes under **OAuth & Permissions** and reinstall only if the installed token needs new scopes. Slack starts delivering an added event without reinstall when its required scope is already granted. See [Slack app update guidance](https://docs.slack.dev/app-management/distribution/#when-is-a-reinstall-required).

For followups in a private channel, also grant `groups:history` and subscribe to `message.groups`, then invite the bot to the channel. `channels:history` and `groups:history` allow Slack to deliver messages from channels the app has joined, including messages outside the local allowlist. The service accepts only configured teams, channels and users, and non-mention messages only in an already authorized thread. An app mention and its corresponding message event are handled once. Each followup is a separate ticket that resumes the thread's retained Codex conversation and isolated workspace; missing saved state fails closed.

Accepted requests receive `:eyes:` on the original message. On success the service removes `:eyes:` and adds `:done:`, falling back to `:white_check_mark:` when the workspace lacks that emoji. Failure or interruption uses `:x:`. Reactions retry independently of execution and replies; service health reports pending reactions and failed attempts. Forwarded attachment text included in a request is bounded and marked as untrusted evidence; attachment links are not fetched.

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

## Connect Gerrit

Use a read-only Gerrit account with visibility only into the intended projects and an HTTP credential accepted by the controller's authenticated REST API. Store its username and HTTP token/password privately in the named environment variables. This adapter uses HTTPS Basic authentication against `/a/changes/`; browser SSO cookies and SSH keys are not REST credentials.

```json
{
  "gerrit": [{
    "id": "code-review",
    "baseUrl": "https://gerrit.example.test/",
    "usernameEnv": "GERRIT_USER",
    "tokenEnv": "GERRIT_HTTP_TOKEN",
    "projects": ["team/project"],
    "maxPages": 3,
    "perPage": 30,
    "timeoutMs": 15000
  }]
}
```

Set the exact project names in dashboard configuration, save, then restart the service. The reader handles Gerrit's JSON prefix, queries recent changes with `ALL_REVISIONS`, baselines the initial snapshot and records newly seen patchsets as **observed** tickets. These remain observed even in `auto` mode. Project, change number, patchset number, commit SHA and status at observation are visible in ticket details. Polling is deterministic and does not call a model.

This is bounded patchset monitoring, not a complete review-status feed: a status-only transition for an already seen patchset does not create a new ticket or refresh that ticket's original status. Changes outside the configured window can be missed. The adapter does not fetch diffs/comments, vote, post reviews, push or submit changes. Its project name alone does not prove the trusted local Git remote, so observed patchsets do not trigger automatic checkouts. See [Gerrit REST authentication](https://gerrit-review.googlesource.com/Documentation/rest-api.html#authentication) and [change queries](https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html#list-changes).

## Use a generic Git repository or Gerrit patchset

The worker supports a trusted local Git checkout independently of GitHub. Clone/fetch it using an operator-managed read credential and set the private VM `repositoryPath`. HTTPS, SSH URLs and scp-style remote identities are recognized; nondefault SSH ports remain significant. Remote credentials and SSH keys stay outside task checkouts. No automatic clone/fetch from a remote is performed by the worker.

For an explicit Gerrit review, use a dedicated staging checkout. Pause new work, wait for any active task to finish, verify the change and patchset in Gerrit, then fetch its exact `refs/changes/...` ref with your approved Git workflow. Check out the verified full commit SHA in that staging checkout. Resume and submit an explicit Slack/UI task; text-only tasks use the configured repository's committed `HEAD`. Include the trusted base SHA and desired review scope in the request. Uncommitted changes are not copied into the task checkout. Keep the staging checkout stable while a task is being accepted.

A sanitized local clone is retained for inspection; followups in the same Slack thread reuse it. Publishing a patch back to Gerrit (`refs/for/...`), updating review labels and submitting remain operator actions. Monitoring Gerrit plus Jenkins does not automatically correlate change numbers to builds in this release.

## Operating modes, economics and backup

Start with `observe`. CI creates visible observed tickets without model calls; explicit authorized Slack/UI requests can execute. `auto` permits eligible new CI failures to execute. `paused` records intake but stops new execution; cancel a running ticket separately. Pausing does not revoke a running process. Resume queued work with observe/auto as appropriate. Observed CI tickets are not retroactively executed merely by switching mode.

Enter your own token rates and hourly/saved-minute assumptions in `economics`. Unknown rates display unavailable, not zero. Cost is an estimate, not an invoice; completed turns do not prove a CI fix or measured time savings. Fixed cost is a cumulative amount for the same lifetime scope as dashboard counters.

Stop the service before backing up the named state volume (SQLite, Codex home, config, environment) and repository volume together; store backups encrypted because they contain secrets and task data. For native deployment stop systemd and copy state plus repository and ticket checkout data. Keep a version tag/image and a state backup before upgrading; restore both for rollback. No scheduled retention or database migrations beyond schema creation exist in this first release.

## Verification boundary

Automated checks exercise provider fixtures and the local service; real provider permissions, Slack delivery, a paid model turn and target VM sandbox behavior must be tested with your environment. See `docs/fork/verification.md` for exact release evidence.

Corporate networks may require a registry mirror during image build: `docker compose build --build-arg NPM_REGISTRY=https://YOUR-APPROVED-REGISTRY`. Keep credentials out of build arguments; use your organization’s secret-mounted build workflow for authenticated registries. Public npm remains the default.

### Codex permissions and managed accounts

The worker selects the built-in `:workspace` permission profile, `approval_policy = "on-request"`, and `approvals_reviewer = "auto_review"`. This is the profile-based equivalent of workspace-write with automatic approval review. It works with managed accounts that allow built-in profiles but exclude custom names. There is no automatic fallback to full access. The executor verifies the returned profile, sandbox, reviewer, approval policy and initial network restriction before sending a model turn; unsupported interactive approval/tool requests fail closed.

Automatic review can approve eligible actions beyond the initial sandbox. Built-in workspace access also permits broader filesystem reads than the former custom profile; it does not hide every file readable by the service's OS user, including files in a dedicated Codex home. Use a dedicated service account or container filesystem to separate unrelated credentials. A separate Codex home isolates sessions and databases, not OS access permissions. See [OpenAI sandboxing](https://learn.chatgpt.com/docs/sandboxing#configure-defaults) and [automatic review](https://learn.chatgpt.com/docs/sandboxing/auto-review).

Before starting each thread, the executor reads effective configuration and explicitly disables inherited MCP server entries for that worker. An empty MCP table does not clear inherited configuration. Provider monitoring still uses the controller's configured adapters. Home config, authentication, skills and instructions remain available through the dedicated Codex home; that config and its linked files must be operator-trusted. The protocol smoke includes an enabled synthetic MCP server and verifies it never launches.
