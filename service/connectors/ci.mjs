import { baseUrl, boundedInt, credential, requestJson } from './http.mjs';

const part = value => typeof value === 'string' && /^(?!\.{1,2}$)[a-zA-Z0-9_.-]+$/.test(value);
const jobPart = value => typeof value === 'string' && value.length > 0 && value.length <= 255 && !['.', '..'].includes(value) && !/[\u0000-\u001f\u007f/\\]/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const workflowId = value => (positive(value) || typeof value === 'string') && (/^\d+$/.test(String(value)) || /^(?!\.{1,2}$)[a-zA-Z0-9_.-]+\.ya?ml$/i.test(String(value)));
const sha = value => typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value) ? value : null;
const unique = events => [...new Map(events.map(event => [event.id, event])).values()];
const scm = (repository = null, headSha = null, branch = null) => ({
  certainty: repository && headSha ? 'known' : repository || headSha || branch ? 'partial' : 'unknown',
  repository, headSha, branch,
});

function githubRepository(head) {
  if (typeof head?.full_name !== 'string' || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(head.full_name)) return null;
  let url;
  try { url = new URL(head.clone_url); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    url.pathname.toLowerCase() !== `/${head.full_name}.git`.toLowerCase()) return null;
  return url.href;
}

function event(job, build, status, lifecycle, outcome, extra) {
  return {
    id: `ci:${JSON.stringify([job, build, status, outcome])}`, source: 'ci', kind: 'ci',
    job, build, status, lifecycle, outcome,
    text: `${job}: ${build} ${status}${outcome && outcome !== status ? ` (${outcome})` : ''}`,
    ...extra,
  };
}

function githubState(run) {
  if (['queued', 'requested', 'waiting', 'pending'].includes(run.status)) return ['queued', null];
  if (run.status === 'in_progress') return ['running', null];
  if (run.status !== 'completed') return ['unknown', 'unknown'];
  if (['failure', 'timed_out', 'action_required', 'startup_failure'].includes(run.conclusion)) return ['completed', 'failure'];
  if (run.conclusion === 'success') return ['completed', 'success'];
  if (run.conclusion === 'cancelled') return ['completed', 'cancelled'];
  return ['completed', 'unknown'];
}

export async function pollGithub(config, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const base = baseUrl(config.baseUrl);
  const token = credential(config.token);
  const pages = boundedInt(config.maxPages, 3, 1, 20);
  const perPage = boundedInt(config.perPage, 30, 1, 100);
  const timeoutMs = boundedInt(config.timeoutMs, 15000, 100, 60000);
  if (!Array.isArray(config.repositories) || !config.repositories.length || config.repositories.length > 50) throw new Error('Invalid repository allowlist');
  for (const repo of config.repositories) {
    const validWorkflows = repo.workflows === undefined || Array.isArray(repo.workflows) && repo.workflows.length <= 50 && repo.workflows.every(workflowId);
    if (!part(repo.owner) || !part(repo.repo) || !validWorkflows) {
      throw new Error('Invalid repository or workflow allowlist');
    }
  }
  const result = { events: [], healthy: true, snapshotComplete: true, complete: true, errors: [] };
  for (const repo of config.repositories) for (const selector of repo.workflows?.length ? repo.workflows : [null]) {
    const workflow = selector === null ? null : String(selector);
    const name = `${repo.owner}/${repo.repo}`;
    let seen = 0, complete = false;
    try {
      for (let page = 1; page <= pages; page++) {
        const repoPath = `repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/actions/`;
        const url = new URL(workflow === null ? `${repoPath}runs` : `${repoPath}workflows/${encodeURIComponent(workflow)}/runs`, base);
        url.searchParams.set('per_page', String(perPage));
        url.searchParams.set('page', String(page));
        const { body, headers } = await requestJson(fetchImpl, url, { headers: {
          authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28',
        } }, timeoutMs);
        if (!Array.isArray(body.workflow_runs) || body.workflow_runs.length > perPage) throw new Error('invalid response');
        for (const run of body.workflow_runs) {
          if (!positive(run.id) || !positive(run.run_attempt) || typeof run.status !== 'string' ||
            (run.repository?.full_name && run.repository.full_name.toLowerCase() !== name.toLowerCase()) ||
            (workflow === null && !positive(run.workflow_id)) ||
            (workflow !== null && /^\d+$/.test(workflow) && run.workflow_id != null && String(run.workflow_id) !== workflow) ||
            (workflow !== null && !/^\d+$/.test(workflow) && typeof run.path === 'string' && run.path.split('@')[0] !== `.github/workflows/${workflow}`)) {
            throw new Error('invalid workflow run');
          }
          const [lifecycle, outcome] = githubState(run);
          const repoUrl = githubRepository(run.head_repository);
          const branch = typeof run.head_branch === 'string' && run.head_branch.length <= 255 ? run.head_branch : null;
          const build = `${run.id}:${run.run_attempt}`;
          const job = `github:${base.href}:${name}:${workflow ?? String(run.workflow_id)}`;
          result.events.push(event(job, build, run.status, lifecycle, outcome, {
            provider: 'github', runId: String(run.id), attempt: run.run_attempt,
            conclusion: typeof run.conclusion === 'string' ? run.conclusion : null,
            scm: scm(repoUrl, sha(run.head_sha), branch),
          }));
        }
        seen += body.workflow_runs.length;
        const next = /<[^>]*>;\s*rel="next"/i.test(headers?.get('link') ?? '');
        if (!next && (body.workflow_runs.length < perPage || Number.isSafeInteger(body.total_count) && seen >= body.total_count)) { complete = true; break; }
      }
      if (!complete) { result.complete = false; result.errors.push('GitHub workflow coverage truncated'); }
    } catch (error) {
      result.healthy = false; result.snapshotComplete = false; result.complete = false;
      result.errors.push(`GitHub workflow poll failed: ${/^HTTP \d+$/.test(error.message) ? error.message : 'request or response error'}`);
    }
  }
  result.events = unique(result.events);
  return result;
}

function jenkinsPath(job) { return job.split('/').map(name => `job/${encodeURIComponent(name)}`).join('/') + '/'; }

function jenkinsState(build) {
  if (build.building === true) return ['running', null];
  if (build.building !== false || typeof build.result !== 'string') return ['unknown', 'unknown'];
  const outcome = { SUCCESS: 'success', FAILURE: 'failure', UNSTABLE: 'unstable', ABORTED: 'cancelled', NOT_BUILT: 'unknown' }[build.result] ?? 'unknown';
  return ['completed', outcome];
}

export async function pollJenkins(config, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const base = baseUrl(config.baseUrl);
  const username = credential(config.username), token = credential(config.token);
  if (username.includes(':')) throw new Error('Invalid connector credential');
  const limit = boundedInt(config.maxBuilds, 20, 1, 500);
  const timeoutMs = boundedInt(config.timeoutMs, 15000, 100, 60000);
  if (!Array.isArray(config.jobs) || !config.jobs.length || config.jobs.length > 50 || !config.jobs.every(job => typeof job === 'string' && job.length <= 1024 && job.split('/').every(jobPart))) throw new Error('Invalid job allowlist');
  const headers = { authorization: `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`, accept: 'application/json' };
  const result = { events: [], healthy: true, snapshotComplete: true, complete: true, errors: [] };
  const jobs = new Map(config.jobs.map(name => [new URL(jenkinsPath(name), base).href, `jenkins:${base.href}:${name}`]));
  for (const [jobUrl, job] of jobs) {
    try {
      const url = new URL('api/json', jobUrl);
      url.searchParams.set('tree', `builds[number,queueId,building,result,actions[lastBuiltRevision[SHA1,branch[name]]]]{0,${limit + 1}}`);
      const { body } = await requestJson(fetchImpl, url, { headers }, timeoutMs);
      if (!Array.isArray(body.builds) || body.builds.length > limit + 1) throw new Error('invalid response');
      if (body.builds.length > limit) { result.complete = false; result.errors.push('Jenkins build coverage truncated'); }
      for (const build of body.builds.slice(0, limit)) {
        if (!positive(build.number) || typeof build.building !== 'boolean') throw new Error('invalid build');
        const [lifecycle, outcome] = jenkinsState(build);
        const buildId = positive(build.queueId) ? `queue-${build.queueId}` : `build-${build.number}`;
        const revisions = [...new Set((Array.isArray(build.actions) ? build.actions : []).map(action => sha(action?.lastBuiltRevision?.SHA1)).filter(Boolean))];
        result.events.push(event(job, buildId, build.building ? 'BUILDING' : build.result ?? 'UNKNOWN', lifecycle, outcome, {
          provider: 'jenkins', runId: String(build.number), attempt: 1, scm: scm(null, revisions.length === 1 ? revisions[0] : null),
        }));
      }
    } catch (error) {
      result.healthy = false; result.snapshotComplete = false; result.complete = false;
      result.errors.push(`Jenkins job poll failed: ${/^HTTP \d+$/.test(error.message) ? error.message : 'request or response error'}`);
    }
  }
  try {
    const url = new URL('queue/api/json', base);
    url.searchParams.set('tree', 'items[id,task[url]]{0,201}');
    const { body } = await requestJson(fetchImpl, url, { headers }, timeoutMs);
    if (!Array.isArray(body.items) || body.items.length > 201) throw new Error('invalid response');
    if (body.items.length > 200) { result.complete = false; result.errors.push('Jenkins queue coverage truncated'); }
    for (const item of body.items.slice(0, 200)) {
      if (!positive(item.id) || typeof item.task?.url !== 'string') continue;
      let jobUrl;
      try { jobUrl = new URL(item.task.url, base); } catch { continue; }
      if (jobUrl.search || jobUrl.hash || jobUrl.username || jobUrl.password) continue;
      if (!jobUrl.pathname.endsWith('/')) jobUrl.pathname += '/';
      const job = jobs.get(jobUrl.href);
      if (!job) continue;
      result.events.push(event(job, `queue-${item.id}`, 'QUEUED', 'queued', null, {
        provider: 'jenkins', runId: `queue-${item.id}`, attempt: 1, scm: scm(),
      }));
    }
  } catch (error) {
    result.healthy = false; result.snapshotComplete = false; result.complete = false;
    result.errors.push(`Jenkins queue poll failed: ${/^HTTP \d+$/.test(error.message) ? error.message : 'request or response error'}`);
  }
  result.events = unique(result.events);
  return result;
}
