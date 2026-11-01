import test from 'node:test';
import assert from 'node:assert/strict';
import { pollGithub, pollJenkins } from '../connectors/ci.mjs';

const json = (body, init) => Response.json(body, init);
const github = {
  id: 'gh', baseUrl: 'https://api.github.com', token: 'test-secret',
  repositories: [{ owner: 'org', repo: 'project', workflows: ['test.yml'] }],
  maxPages: 2, perPage: 2, timeoutMs: 1000,
};
const run = (id, attempt, status, conclusion = null) => ({
  id, workflow_id: 77, run_attempt: attempt, status, conclusion, head_sha: 'a'.repeat(40),
  head_branch: 'main', head_repository: { full_name: 'org/project', clone_url: 'https://github.com/org/project.git' },
  repository: { full_name: 'org/project' }, path: '.github/workflows/test.yml',
  html_url: `https://github.com/org/project/actions/runs/${id}`,
});

test('GitHub supports all workflows in an allowlisted repo and numeric workflow selectors', async () => {
  const urls = [];
  const fetch = async url => { urls.push(String(url)); return json({ total_count: 1, workflow_runs: [run(11, 1, 'queued')] }); };
  const all = await pollGithub({ ...github, repositories: [{ owner: 'org', repo: 'project', workflows: [] }] }, { fetch });
  assert.match(urls[0], /repos\/org\/project\/actions\/runs\?/);
  assert.match(all.events[0].job, /:77$/);
  const numeric = await pollGithub({ ...github, repositories: [{ owner: 'org', repo: 'project', workflows: [77] }] }, { fetch });
  assert.match(urls[1], /workflows\/77\/runs/);
  assert.equal(numeric.healthy, true);
});

test('GitHub polls only configured workflows, keeps attempts and transitions distinct, deduplicates observations', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return json({ total_count: 3, workflow_runs: calls.length === 1
      ? [run(10, 1, 'completed', 'failure'), run(10, 2, 'in_progress')]
      : [run(10, 1, 'completed', 'failure')] });
  };
  const result = await pollGithub(github, { fetch });
  assert.equal(result.healthy, true);
  assert.equal(result.complete, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /repos\/org\/project\/actions\/workflows\/test.yml\/runs/);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.authorization, 'Bearer test-secret');
  assert.equal(calls[0].options.headers.accept, 'application/vnd.github+json');
  assert.equal(result.events.length, 2);
  assert.notEqual(result.events[0].build, result.events[1].build);
  assert.equal(result.events[0].outcome, 'failure');
  assert.equal(result.events[1].lifecycle, 'running');
  assert.deepEqual(result.events[0].scm, { certainty: 'known', repository: 'https://github.com/org/project.git', headSha: 'a'.repeat(40), branch: 'main' });
  const finished = await pollGithub(github, { fetch: async () => json({ total_count: 1, workflow_runs: [run(10, 2, 'completed', 'cancelled')] }) });
  assert.equal(finished.events[0].outcome, 'cancelled');
  assert.equal(finished.events[0].build, result.events[1].build);
  assert.notEqual(finished.events[0].id, result.events[1].id);
});

test('GitHub bounded pagination and failures report coverage without leaking secrets', async () => {
  const partial = await pollGithub({ ...github, maxPages: 1 }, { fetch: async () => json({ total_count: 8, workflow_runs: [run(1, 1, 'queued'), run(2, 1, 'queued')] }) });
  assert.equal(partial.healthy, true);
  assert.equal(partial.snapshotComplete, true);
  assert.equal(partial.complete, false);
  const failed = await pollGithub(github, { fetch: async () => { throw new Error('test-secret at https://api.github.com'); } });
  assert.equal(failed.healthy, false);
  assert.equal(failed.snapshotComplete, false);
  assert.equal(failed.complete, false);
  assert.equal(failed.events.length, 0);
  assert.doesNotMatch(JSON.stringify(failed), /test-secret|https:\/\//);
  await assert.rejects(pollGithub({ ...github, baseUrl: 'https://secret@example.com/' }, { fetch: async () => { throw Error('must not call'); } }), /base URL/);
  await assert.rejects(pollGithub({ ...github, repositories: [{ owner: '../other', repo: 'x', workflows: ['test.yml'] }] }), /repository/);
});

test('GitHub records missing or inconsistent source evidence as partial and rejects redirect responses', async () => {
  const unverified = run(5, 1, 'completed', 'failure');
  unverified.head_repository.clone_url = 'https://user:secret@github.com/org/project.git';
  const result = await pollGithub(github, { fetch: async () => json({ total_count: 1, workflow_runs: [unverified] }) });
  assert.equal(result.events[0].scm.certainty, 'partial');
  assert.equal(result.events[0].scm.repository, null);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
  let calls = 0;
  const redirected = await pollGithub(github, { fetch: async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'error');
    return new Response('', { status: 302, headers: { location: 'https://evil.example/' } });
  } });
  assert.equal(calls, 1);
  assert.equal(redirected.healthy, false);
  assert.equal(redirected.snapshotComplete, false);
});

test('Jenkins reads allowlisted jobs and queue, correlates queue and builds, preserves unstable and unknown SCM', async () => {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/queue/api/json')) return json({ items: [
      { id: 9, task: { url: 'https://ci.example/jenkins/job/team/job/check/' } },
      { id: 99, task: { url: 'https://evil.example/jenkins/job/team/job/check/' } },
      { id: 10, task: { url: 'https://ci.example/jenkins/job/unlisted/' } },
    ] });
    return json({ builds: [{ number: 7, queueId: 9, building: false, result: 'UNSTABLE' }, { number: 6, building: true, result: null }] });
  };
  const config = { id: 'jenkins', baseUrl: 'https://ci.example/jenkins', username: 'operator', token: 'test-secret', jobs: ['team/check'], maxBuilds: 5 };
  const result = await pollJenkins(config, { fetch });
  assert.equal(result.healthy, true);
  assert.equal(result.complete, true);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(c => c.options.redirect === 'error'));
  assert.ok(requests.every(c => c.options.headers.authorization === `Basic ${Buffer.from('operator:test-secret').toString('base64')}`));
  assert.equal(result.events.length, 3);
  const unstable = result.events.find(event => event.outcome === 'unstable');
  const queued = result.events.find(event => event.lifecycle === 'queued');
  assert.equal(unstable.build, queued.build);
  assert.notEqual(unstable.id, queued.id);
  assert.equal(unstable.scm.certainty, 'unknown');
  assert.ok(result.events.some(event => event.lifecycle === 'running'));
});

test('Jenkins flags an incomplete build window and failed queue explicitly', async () => {
  const config = { id: 'jenkins', baseUrl: 'https://ci.example', username: 'u', token: 's', jobs: ['check'], maxBuilds: 1 };
  const result = await pollJenkins(config, { fetch: async url => String(url).includes('/queue/')
    ? new Response('no', { status: 503 })
    : json({ builds: [{ number: 2, building: false, result: 'SUCCESS' }, { number: 1, building: false, result: 'FAILURE' }] }) });
  assert.equal(result.healthy, false);
  assert.equal(result.complete, false);
  assert.equal(result.events.length, 1);
  await assert.rejects(pollJenkins({ ...config, jobs: ['../bad'] }), /job/);
});

test('Jenkins safely encodes ordinary job names containing spaces', async () => {
  const config = { baseUrl: 'https://ci.example', username: 'u', token: 's', jobs: ['team/build service'], maxBuilds: 2 };
  const requests = [];
  const result = await pollJenkins(config, { fetch: async url => {
    requests.push(String(url));
    return json(String(url).includes('/queue/') ? { items: [] } : { builds: [] });
  } });
  assert.equal(result.healthy, true);
  assert.ok(requests.some(url => url.includes('/job/team/job/build%20service/')));
});
