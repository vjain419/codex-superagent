import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../core/store.mjs';
import { Runtime } from '../core/runtime.mjs';

function fixture(t) { const dir=mkdtempSync(join(tmpdir(),'superagent-')); const store=new Store(join(dir,'state.sqlite')); t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});return {dir,store}; }
const request = id => ({id,source:'slack',kind:'request',authorized:true,text:'Investigate tests',reply:{channel:'C1',threadTs:'1'}});
const failure = id => ({id,source:'ci',kind:'ci',job:'jenkins/unit',build:id,status:'completed',outcome:'failure',text:'Tests failed'});

test('durable intake deduplicates and explicit authorization gates work',t=>{ const {store,dir}=fixture(t);assert.equal(store.ingest(request('one')).ticket.status,'queued');assert.equal(store.ingest(request('one')).duplicate,true);assert.equal(store.ingest({...request('two'),authorized:false}).ticket,undefined);assert.equal(store.ingest(failure('3')).ticket.status,'observed');assert.equal(store.ingest(failure('4'),{mode:'auto'}).ticket.status,'queued');const reopened=new Store(join(dir,'state.sqlite'));assert.equal(reopened.listTickets().length,3);reopened.close(); });

test('entire initial CI batch is baseline; next failure creates work',t=>{const {store}=fixture(t);const runtime=new Runtime({store,executor:{},config:{mode:'auto'}});runtime.handleEvents([failure('1'),failure('2')],{sourceKey:'jenkins',baseline:true});assert.equal(store.listTickets().length,0);assert.equal(store.getState('baseline:jenkins'),true);assert.equal(store.ingest(failure('3'),{mode:'auto'}).ticket.status,'queued');assert.equal(store.ingest({...failure('1'),id:'1-later-state'}).ticket,undefined);});

test('sequential execution, usage and outbox survive delivery retries',async t=>{const {store,dir}=fixture(t);let active=0,max=0;const runtime=new Runtime({store,config:{mode:'observe',workspaceRoot:join(dir,'tickets')},executor:{async execute(job,onUsage){max=Math.max(max,++active);assert.ok(existsSync(job.workspace));onUsage({inputTokens:12,outputTokens:3,totalTokens:15});await new Promise(r=>setTimeout(r,5));active--;return {text:'Fixed',usage:{inputTokens:12,outputTokens:3,totalTokens:15}}}}});runtime.handleEvent(request('a'));runtime.handleEvent(request('b'));await runtime.drain();assert.equal(max,1);assert.deepEqual(store.listTickets().map(x=>x.status),['succeeded','succeeded']);assert.equal(store.metrics().tokens.totalTokens,30);let rows=store.listOutbox();assert.equal(rows.length,2);store.markOutboxFailed(rows[0].id,'temporary');assert.equal(store.listOutbox()[0].attempts,1);store.markOutboxSent(rows[0].id);assert.equal(store.listOutbox().length,1);});

test('startup interrupts running work and never replays it',async t=>{const {store,dir}=fixture(t);const ticket=store.ingest(request('a')).ticket;store.updateTicket(ticket.id,{status:'running'});let calls=0;const runtime=new Runtime({store,config:{workspaceRoot:dir},executor:{execute(){calls++;}}});await runtime.drain();assert.equal(store.getTicket(ticket.id).status,'interrupted');assert.equal(calls,0);assert.equal(store.listOutbox().length,1);});

test('stop aborts active ticket; changing to observe prevents queued proactive work',async t=>{const {store,dir}=fixture(t);const config={mode:'auto',workspaceRoot:join(dir,'tickets')};const runtime=new Runtime({store,config,executor:{execute({signal}){return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))}}});runtime.handleEvent(request('active'));runtime.handleEvent(failure('next'));await new Promise(r=>setTimeout(r,10));config.mode='observe';await runtime.stop();assert.equal(store.listTickets().find(x=>x.event.id==='active').status,'interrupted');assert.equal(store.listTickets().find(x=>x.event.id==='next').status,'queued');});

test('malformed events and dangerous ticket patches rejected',t=>{const {store}=fixture(t);assert.throws(()=>store.ingest({id:'a'}));const {ticket}=store.ingest(request('a'));assert.throws(()=>store.updateTicket(ticket.id,{id:'changed'}));assert.throws(()=>store.updateTicket(ticket.id,{status:'not-real'}));});

test('paused retains queued authorized work; resume drain executes; manual intake supported',async t=>{const {store,dir}=fixture(t),config={mode:'paused',workspaceRoot:join(dir,'tickets')};let calls=0;const runtime=new Runtime({store,config,executor:{async execute(){calls++;return {text:'ok'}}}});const {ticket}=runtime.handleEvent({...request('manual'),source:'manual'});await runtime.drain();assert.equal(calls,0);assert.equal(store.getTicket(ticket.id).status,'queued');config.mode='observe';await runtime.drain();assert.equal(calls,1);assert.equal(store.metrics().succeeded,1);});

test('cancel queued and active tickets without replay',async t=>{const {store,dir}=fixture(t),config={mode:'paused',workspaceRoot:join(dir,'tickets')};const runtime=new Runtime({store,config,executor:{execute({signal}){return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}}});const queued=runtime.handleEvent(request('queued')).ticket;await runtime.cancel(queued.id);assert.equal(store.getTicket(queued.id).status,'interrupted');const active=runtime.handleEvent(request('active')).ticket;config.mode='observe';runtime.drain();await new Promise(r=>setTimeout(r,10));await runtime.cancel(active.id);assert.equal(store.getTicket(active.id).status,'interrupted');assert.throws(()=>runtime.cancel('missing'),/Unknown/);});

test('database private; proactive work cannot run without configured repository',async t=>{const {store,dir}=fixture(t);let calls=0;const runtime=new Runtime({store,config:{mode:'auto',workspaceRoot:join(dir,'tickets')},executor:{execute(){calls++;}}});const {ticket}=runtime.handleEvent(failure('a'));await runtime.drain();assert.equal(calls,0);assert.equal(store.getTicket(ticket.id).status,'failed');assert.match(store.getTicket(ticket.id).error,/repository/);});

test('only completed CI failures queue; unstable stays observed by default',t=>{const {store}=fixture(t);assert.equal(store.ingest({...failure('running'),status:'running',lifecycle:'running'},{mode:'auto'}).ticket,undefined);assert.equal(store.ingest({...failure('unstable'),outcome:'unstable'},{mode:'auto'}).ticket.status,'observed');assert.equal(store.ingest({...failure('finished'),lifecycle:'completed'},{mode:'auto'}).ticket.status,'queued');});

test('CI repository mismatch or unavailable revision never invokes executor',async t=>{
  const {store,dir}=fixture(t),{execFileSync}=await import('node:child_process');
  const repository=join(dir,'repo');execFileSync('git',['init',repository]);execFileSync('git',['-C',repository,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','fixture']);execFileSync('git',['-C',repository,'remote','add','origin','git@github.com:example/right.git']);
  const sha=execFileSync('git',['-C',repository,'rev-parse','HEAD'],{encoding:'utf8'}).trim();let calls=0;
  const runtime=new Runtime({store,config:{mode:'auto',workspaceRoot:join(dir,'tickets'),repositoryPath:repository},executor:{async execute(){calls++;return {text:'done'}}}});
  const wrong=runtime.handleEvent({...failure('wrong'),scm:{certainty:'known',repository:'https://github.com/example/wrong',headSha:sha}}).ticket;
  const unknown=runtime.handleEvent({...failure('unknown'),scm:{certainty:'known',repository:'https://github.com/example/right',headSha:'f'.repeat(40)}}).ticket;
  await runtime.drain();assert.equal(calls,0);assert.equal(store.getTicket(wrong.id).status,'failed');assert.match(store.getTicket(wrong.id).error,/repository.*match/i);assert.match(store.getTicket(unknown.id).error,/commit.*available|revision/i);
});

test('CI repairs use exact revision in an isolated checkout and preserve source HEAD',async t=>{
  const {store,dir}=fixture(t),{execFileSync}=await import('node:child_process'),{writeFileSync,readFileSync,statSync}=await import('node:fs');
  const repository=join(dir,'repo');execFileSync('git',['init',repository]);
  writeFileSync(join(repository,'target.txt'),'first');execFileSync('git',['-C',repository,'add','.']);execFileSync('git',['-C',repository,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','first']);
  const first=execFileSync('git',['-C',repository,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  writeFileSync(join(repository,'target.txt'),'second');execFileSync('git',['-C',repository,'add','.']);execFileSync('git',['-C',repository,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','second']);execFileSync('git',['-C',repository,'remote','add','origin','git@github.com:example/right.git']);
  const latest=execFileSync('git',['-C',repository,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const runtime=new Runtime({store,config:{mode:'auto',workspaceRoot:join(dir,'tickets'),repositoryPath:repository},executor:{async execute({workspace,readRoots}){assert.equal(readFileSync(join(workspace,'target.txt'),'utf8'),'first');assert.equal(readRoots,undefined);writeFileSync(join(workspace,'target.txt'),'fixed');return {text:'fixed'}}}});
  const {ticket}=runtime.handleEvent({...failure('known'),scm:{certainty:'known',repository:'https://github.com/example/right.git',headSha:first}});await runtime.drain();
  assert.equal(store.getTicket(ticket.id).status,'succeeded');assert.equal(execFileSync('git',['-C',repository,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),latest);assert.equal(readFileSync(join(repository,'target.txt'),'utf8'),'second');assert.equal(statSync(join(dir,'state.sqlite')).mode&0o777,0o600);
});

test('isolated checkout never inherits source smudge/process filters or credentials',async t=>{
  const {store,dir}=fixture(t),{execFileSync}=await import('node:child_process'),{writeFileSync}=await import('node:fs');
  const repository=join(dir,'repo'),marker=join(dir,'outside-workspace');execFileSync('git',['init',repository]);
  writeFileSync(join(repository,'.gitattributes'),'*.txt filter=evil\n');writeFileSync(join(repository,'target.txt'),'safe');execFileSync('git',['-C',repository,'add','.']);execFileSync('git',['-C',repository,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture']);execFileSync('git',['-C',repository,'config','filter.evil.smudge',`sh -c 'touch ${marker}; cat'`]);execFileSync('git',['-C',repository,'config','http.extraHeader','Authorization: fixture-credential']);
  const runtime=new Runtime({store,config:{mode:'observe',workspaceRoot:join(dir,'tickets'),repositoryPath:repository},executor:{async execute({workspace}){const {readFileSync}=await import('node:fs');assert.doesNotMatch(readFileSync(join(workspace,'.git','config'),'utf8'),/fixture-credential|extraHeader|filter|remote/i);writeFileSync(join(workspace,'target.txt'),'changed');assert.match(execFileSync('git',['-C',workspace,'diff'],{encoding:'utf8'}),/changed/);return {text:'done'}}}});
  const {ticket}=runtime.handleEvent(request('filter'));await runtime.drain();assert.equal(store.getTicket(ticket.id).status,'succeeded');assert.equal(existsSync(marker),false);
});

test('successful empty summary is not reported as interrupted',t=>{const {store}=fixture(t);const {ticket}=store.ingest(request('empty'));store.updateTicket(ticket.id,{status:'succeeded',result:''});assert.doesNotMatch(store.listOutbox()[0].text,/interrupted/i);assert.match(store.listOutbox()[0].text,/completed/i);});

test('Gerrit revisions are deduplicated observations, never authorized execution',async t=>{
  const {store,dir}=fixture(t);let calls=0;
  const runtime=new Runtime({store,config:{mode:'auto',workspaceRoot:join(dir,'tickets')},executor:{async execute(){calls++;return {text:'unexpected'}}}});
  const event={id:'gerrit:change-7:2',source:'gerrit',kind:'review',change:'7',patchset:2,project:'example/app',status:'NEW',text:'Review patchset 2',authorized:true};
  runtime.handleEvents([{...event,id:'gerrit:change-7:1',patchset:1}],{sourceKey:'review',baseline:true});assert.equal(store.listTickets().length,0);
  const first=runtime.handleEvent(event);assert.equal(first.ticket.status,'observed');assert.equal(runtime.handleEvent(event).duplicate,true);
  store.updateTicket(first.ticket.id,{status:'queued'});await runtime.drain();assert.equal(calls,0);assert.equal(store.getTicket(first.ticket.id).status,'observed');assert.equal(store.listOutbox().length,0);
  for(const patch of [{patchset:0},{change:''},{project:''},{kind:'request'}])assert.throws(()=>store.ingest({...event,id:JSON.stringify(patch),...patch}));
});

test('explicit SCM task pins a staged revision through equivalent generic SSH remotes',async t=>{
  const {store,dir}=fixture(t),{execFileSync}=await import('node:child_process'),{writeFileSync,readFileSync}=await import('node:fs');
  const repository=join(dir,'repo');execFileSync('git',['init',repository]);writeFileSync(join(repository,'target.txt'),'staged');execFileSync('git',['-C',repository,'add','.']);execFileSync('git',['-C',repository,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','staged']);
  const revision=execFileSync('git',['-C',repository,'rev-parse','HEAD'],{encoding:'utf8'}).trim();writeFileSync(join(repository,'target.txt'),'latest');execFileSync('git',['-C',repository,'add','.']);execFileSync('git',['-C',repository,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','latest']);execFileSync('git',['-C',repository,'remote','add','origin','ssh://git@git.example.test:22/team/app.git']);
  const runtime=new Runtime({store,config:{mode:'observe',workspaceRoot:join(dir,'tickets'),repositoryPath:repository},executor:{async execute({workspace}){assert.equal(readFileSync(join(workspace,'target.txt'),'utf8'),'staged');return {text:'Reviewed staged revision'}}}});
  const {ticket}=runtime.handleEvent({...request('review-task'),source:'manual',scm:{certainty:'known',repository:'git@git.example.test:team/app.git',headSha:revision}});await runtime.drain();assert.equal(store.getTicket(ticket.id).status,'succeeded');
});

test('explicit SCM metadata cannot select another repository, SSH service or unstaged revision',async t=>{
  const {store,dir}=fixture(t),{execFileSync}=await import('node:child_process');
  const repository=join(dir,'repo');execFileSync('git',['init',repository]);execFileSync('git',['-C',repository,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','fixture']);execFileSync('git',['-C',repository,'remote','add','origin','ssh://git@review.example.test:29418/example/app']);
  const revision=execFileSync('git',['-C',repository,'rev-parse','HEAD'],{encoding:'utf8'}).trim();let calls=0;
  const runtime=new Runtime({store,config:{mode:'observe',workspaceRoot:join(dir,'tickets'),repositoryPath:repository},executor:{async execute(){calls++;return {text:'unexpected'}}}});
  const known={certainty:'known',repository:'ssh://git@review.example.test:29418/example/app',headSha:revision};
  for(const [index,patch] of [{repository:'ssh://git@review.example.test:29419/example/app'},{repository:'ssh://git@other.example.test:29418/example/app'},{repository:'https://fixture:credential@review.example.test/example/app'},{repository:'file:///example/app'},{headSha:'f'.repeat(40)},{certainty:'partial'}].entries())runtime.handleEvent({...request(`scm-boundary-${index}`),source:'manual',scm:{...known,...patch}});
  await runtime.drain();assert.equal(calls,0);assert.equal(store.listTickets().length,6);assert.ok(store.listTickets().every(ticket=>ticket.status==='failed'));assert.ok(store.listTickets().every(ticket=>!ticket.error.includes('fixture:credential')));
});

test('Slack follow-ups reuse their workspace and Codex thread after restart',async t=>{
  const {store,dir}=fixture(t),config={mode:'observe',workspaceRoot:join(dir,'tickets')},calls=[];
  const event=id=>({...request(id),reply:{team:'T1',channel:'C1',threadTs:'100.1'}});
  const executor={async execute(job,onUsage,onSession){calls.push(job);onSession?.({threadId:'session-one'});return {text:'done',threadId:'session-one'};}};
  let runtime=new Runtime({store,config,executor});const first=runtime.handleEvent(event('first')).ticket;await runtime.drain();await runtime.stop();
  const reopened=new Store(join(dir,'state.sqlite'));t.after(()=>reopened.close());runtime=new Runtime({store:reopened,config,executor});const second=runtime.handleEvent(event('second')).ticket;await runtime.drain();
  assert.equal(calls[1].workspace,calls[0].workspace);assert.equal(calls[1].threadId,'session-one');assert.notEqual(first.id,second.id);assert.equal(reopened.getTicket(second.id).threadId,'session-one');
});

test('Slack team, channel and root thread each isolate sessions and workspaces',async t=>{
  const {store,dir}=fixture(t),calls=[];const runtime=new Runtime({store,config:{workspaceRoot:join(dir,'tickets')},executor:{async execute(job,onUsage,onSession){calls.push(job);onSession({threadId:`session-${calls.length}`});return {text:'done',threadId:`session-${calls.length}`};}}});
  for(const [index,reply] of [{team:'T1',channel:'C1',threadTs:'100.1'},{team:'T2',channel:'C1',threadTs:'100.1'},{team:'T1',channel:'C2',threadTs:'100.1'},{team:'T1',channel:'C1',threadTs:'100.2'}].entries())runtime.handleEvent({...request(`isolate-${index}`),reply});
  await runtime.drain();assert.equal(calls.length,4);assert.equal(new Set(calls.map(job=>job.workspace)).size,4);assert.ok(calls.every(job=>job.threadId===undefined));assert.ok(store.listTickets().every(ticket=>ticket.status==='succeeded'));
});

for(const outcome of ['failed','cancelled'])test(`Slack ${outcome} turn preserves its early session ID for the next message`,async t=>{
  const {store,dir}=fixture(t),calls=[];let entered;const started=new Promise(resolve=>entered=resolve),event=id=>({...request(id),reply:{team:'T1',channel:'C1',threadTs:'100.1'}});
  const runtime=new Runtime({store,config:{workspaceRoot:join(dir,'tickets')},executor:{async execute(job,onUsage,onSession){calls.push(job);if(calls.length===1){onSession({threadId:'retained-session'});entered();if(outcome==='failed')throw new Error('model failed');await new Promise((_,reject)=>job.signal.addEventListener('abort',()=>reject(job.signal.reason),{once:true}));}return {text:'continued',threadId:'retained-session'};}}});
  const first=runtime.handleEvent(event('first')).ticket;await started;if(outcome==='cancelled')runtime.cancel(first.id);await runtime.drain();
  assert.equal(store.getTicket(first.id).status,outcome==='failed'?'failed':'interrupted');assert.equal(store.getTicket(first.id).threadId,'retained-session');runtime.handleEvent(event('second'));await runtime.drain();assert.equal(calls[1].threadId,'retained-session');assert.equal(calls[1].workspace,calls[0].workspace);
});

test('legacy Slack ticket recovers its exact session and preserved workspace',async t=>{
  const {store,dir}=fixture(t),{mkdirSync,realpathSync}=await import('node:fs'),event=id=>({...request(id),reply:{team:'T1',channel:'C1',threadTs:'100.1'}}),first=store.ingest(event('legacy')).ticket;
  mkdirSync(join(dir,'tickets',first.id),{recursive:true});const workspace=realpathSync(join(dir,'tickets',first.id));store.updateTicket(first.id,{workspace,threadId:'legacy-session',status:'succeeded',usage:{inputTokens:7,outputTokens:2,totalTokens:9}});
  let job;const runtime=new Runtime({store,config:{workspaceRoot:join(dir,'tickets')},executor:{async execute(value){job=value;return {text:'continued',threadId:value.threadId};}}});runtime.handleEvent(event('next'));await runtime.drain();assert.equal(job.workspace,workspace);assert.equal(job.threadId,'legacy-session');assert.equal(job.totalUsage.totalTokens,9);
});

test('conversation cannot claim a session already owned by another Slack context',async t=>{
  const {store,dir}=fixture(t),runtime=new Runtime({store,config:{workspaceRoot:join(dir,'tickets')},executor:{async execute(job,onUsage,onSession){onSession({threadId:'same-session'});return {text:'done',threadId:'same-session'};}}});
  runtime.handleEvent({...request('one'),reply:{team:'T1',channel:'C1',threadTs:'100.1'}});await runtime.drain();const second=runtime.handleEvent({...request('two'),reply:{team:'T1',channel:'C1',threadTs:'100.2'}}).ticket;await runtime.drain();assert.equal(store.getTicket(second.id).status,'failed');assert.match(store.getTicket(second.id).error,/another context|UNIQUE/);assert.equal(store.getTicket(second.id).threadId,undefined);
});

test('a follow-up cannot silently reuse a workspace for a new SCM-pinned request',async t=>{
  const {store,dir}=fixture(t),event=id=>({...request(id),reply:{team:'T1',channel:'C1',threadTs:'100.1'}});let calls=0;const config={workspaceRoot:join(dir,'tickets')},runtime=new Runtime({store,config,executor:{async execute(){calls++;return {text:'done',threadId:'existing-session'};}}});
  runtime.handleEvent(event('first'));await runtime.drain();config.repositoryPath=dir;const followup=runtime.handleEvent({...event('pin'),scm:{certainty:'known',repository:'https://github.com/example/other',headSha:'f'.repeat(40)}}).ticket;await runtime.drain();assert.equal(calls,1);assert.equal(store.getTicket(followup.id).status,'failed');assert.match(store.getTicket(followup.id).error,/SCM.*new Slack thread/);
});
