import test from 'node:test';
import assert from 'node:assert/strict';
import { pollGerrit } from '../connectors/gerrit.mjs';

const config = { id: 'review', baseUrl: 'https://gerrit.example.test/review', username: 'reader', token: 'test-secret', projects: ['team/project'], perPage: 2, maxPages: 2 };
const sha = 'a'.repeat(40);
const change = { _number: 123, project: 'team/project', branch: 'main', status: 'NEW', subject: 'Update tests', current_revision: sha, revisions: { [sha]: { _number: 1 } } };
const response = body => new Response(")]}'\n" + JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

test('Gerrit reads an allowlisted project and exposes observed patchset evidence', async () => {
  const calls = [];
  const result = await pollGerrit(config, { fetch: async (url, options) => { calls.push({ url: new URL(url), options }); return response([change]); } });
  assert.equal(result.healthy, true);
  assert.equal(result.complete, true);
  assert.equal(result.events.length, 1);
  assert.deepEqual({ source: result.events[0].source, kind: result.events[0].kind, change: result.events[0].change,
    patchset: result.events[0].patchset, project: result.events[0].project, status: result.events[0].status },
  { source: 'gerrit', kind: 'review', change: '123', patchset: 1, project: 'team/project', status: 'NEW' });
  assert.equal(result.events[0].scm.headSha, sha);
  assert.equal(result.events[0].scm.repository, null);
  assert.equal(result.events[0].scm.branch, 'main');
  assert.equal(calls[0].url.pathname, '/review/a/changes/');
  assert.equal(calls[0].url.searchParams.get('q'), 'project:team/project');
  assert.equal(calls[0].url.searchParams.get('o'), 'ALL_REVISIONS');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.authorization, `Basic ${Buffer.from('reader:test-secret').toString('base64')}`);
});
test('Gerrit excludes branch names containing control characters', async () => {
  const result = await pollGerrit(config, { fetch: async () => response([{ ...change, branch: 'main\nother' }]) });
  assert.equal(result.healthy, true);
  assert.equal(result.events[0].scm.branch, null);
});
test('Gerrit pagination advances by returned count and reports a truncated window', async () => {
  const starts=[];
  const first={...change,_more_changes:true};
  const second={...change,_number:124,current_revision:'b'.repeat(40),revisions:{['b'.repeat(40)]:{_number:2}}};
  const fetch=async url=>{const start=new URL(url).searchParams.get('S');starts.push(start);return response(start==='0'?[first]:[second]);};
  const result=await pollGerrit({...config,perPage:3},{fetch});
  assert.deepEqual(starts,['0','1']);
  assert.equal(result.complete,true);
  assert.equal(result.events.length,2);
  const partial=await pollGerrit({...config,perPage:3,maxPages:1},{fetch});
  assert.equal(partial.healthy,true);
  assert.equal(partial.snapshotComplete,true);
  assert.equal(partial.complete,false);
});
test('Gerrit rejects out-of-scope changes, malformed revisions and unsafe credentials without exposing details', async () => {
  const outsider=await pollGerrit(config,{fetch:async()=>response([{...change,project:'elsewhere'}])});
  assert.equal(outsider.healthy,false);
  assert.equal(outsider.snapshotComplete,false);
  const malformed=await pollGerrit(config,{fetch:async()=>response([{...change,revisions:{[sha]:{_number:0}}}])});
  assert.equal(malformed.healthy,false);
  const failure=await pollGerrit(config,{fetch:async()=>{throw Error('test-secret https://gerrit.example.test');}});
  assert.doesNotMatch(JSON.stringify(failure),/test-secret|https:\/\//);
  await assert.rejects(pollGerrit({...config,baseUrl:'https://user:pass@gerrit.example.test'}),/base URL/);
  await assert.rejects(pollGerrit({...config,projects:['team/../outside']}),/project/);
});
