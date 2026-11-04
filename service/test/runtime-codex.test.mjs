import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync,writeFileSync,mkdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexExecutor } from '../codex/executor.mjs';

function fixture(t,scenario='success') {
  const dir=mkdtempSync(join(tmpdir(),'superagent-codex-')),workspace=join(dir,'ticket'),codexHome=join(dir,'auth');mkdirSync(workspace);mkdirSync(codexHome);
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const script=join(dir,'server.mjs');writeFileSync(script,`import readline from 'node:readline';
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id)return;
if(m.method==='initialize') {if(${JSON.stringify(scenario)}==='experimental' && m.params.capabilities?.experimentalApi!==true){send({id:m.id,error:{code:-1,message:'resume fields require experimentalApi capability'}});return;}send({id:m.id,result:{}});}
if(m.method==='config/read')send({id:m.id,result:{config:{mcp_servers:{fixture:{command:'unused',enabled:true}}}}});
if(m.method==='thread/start' && ${JSON.stringify(scenario)}==='resume'){send({id:m.id,error:{code:-1,message:'Follow-up must resume its session'}});return;}
if(m.method==='thread/start' || m.method==='thread/resume') {if(m.method==='thread/resume' && (m.params.threadId!=='thread-1' || m.params.permissions!==':workspace' || m.params.config.mcp_servers?.fixture?.enabled!==false))throw Error('unsafe resume');if(${JSON.stringify(scenario)}==='inherited-mcp' && m.params.config.mcp_servers?.fixture?.enabled!==false){send({id:m.id,error:{code:-1,message:'inherited MCP server left enabled'}});return;}if(m.params.sandbox)throw Error('legacy sandbox overrides profile');if(m.params.config.default_permissions!==':workspace')throw Error('missing built-in profile');send({id:m.id,result:{cwd:m.params.cwd,runtimeWorkspaceRoots:${JSON.stringify(scenario==='roots'?['/different']:[])},thread:{id:${JSON.stringify(scenario==='wrong-session'?'different-session':'thread-1')},cwd:${JSON.stringify(scenario==='wrong-workspace'?'/different':null)}??m.params.cwd},approvalPolicy:${JSON.stringify(scenario==='policy'?'never':'on-request')},approvalsReviewer:${JSON.stringify(scenario==='reviewer'?'user':'auto_review')},activePermissionProfile:{id:${JSON.stringify(scenario==='weak'?':danger-full-access':':workspace')}},sandbox:{type:${JSON.stringify(scenario==='sandbox'?'dangerFullAccess':'workspaceWrite')},networkAccess:${scenario==='network'}}}});}
if(m.method==='turn/start') {
 if(${JSON.stringify(scenario)}!=='early')send({id:m.id,result:{turn:{id:'turn-1'}}});
 if(${JSON.stringify(scenario)}==='exit')process.exit(7);
 if(${JSON.stringify(scenario)}==='hang')return;
 if(${JSON.stringify(scenario)}==='approval'){send({id:900,method:'item/commandExecution/requestApproval',params:{}});return;}
 if(${JSON.stringify(scenario)}==='phases')send({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{type:'agentMessage',id:'progress',phase:'commentary',text:'Working...'}}});
 send({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'m1',delta:'Done'}});
 send({method:'thread/tokenUsage/updated',params:{threadId:'thread-1',turnId:'turn-1',tokenUsage:{total:{inputTokens:10,cachedInputTokens:2,outputTokens:4,totalTokens:14},last:{}}}});
 send({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{type:'agentMessage',id:'m1',text:'Done',phase:${JSON.stringify(scenario==='phases'?'final_answer':null)}}}});
 send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:${JSON.stringify(scenario==='failed'?'failed':'completed')},error:${scenario==='failed'?"{message:'model unavailable'}":'null'}}}});
 if(${JSON.stringify(scenario)}==='early')process.exit(0);
}});`);
  let options,args;
  const executor=new CodexExecutor({codexHome,timeoutMs:scenario==='hang'?70:3000,env:{PATH:process.env.PATH,HOME:dir,SLACK_BOT_TOKEN:'must-not-pass',JENKINS_TOKEN:'must-not-pass',OPENAI_API_KEY:'model-auth-only'},spawn(command,a,o){args=a;options=o;return spawn(process.execPath,[script],o);}});
  return {executor,workspace,options:()=>options,args:()=>args};
}
test('app-server handshake, streamed text, usage and restricted child environment',async t=>{const f=fixture(t);let usage;const result=await f.executor.execute({id:'t1',prompt:'Fix tests',workspace:f.workspace},u=>usage=u);assert.equal(result.text,'Done');assert.equal(result.usage.totalTokens,14);assert.equal(usage.cachedInputTokens,2);assert.equal(result.threadId,'thread-1');assert.equal(f.options().env.SLACK_BOT_TOKEN,undefined);assert.equal(f.options().env.JENKINS_TOKEN,undefined);assert.equal(f.options().env.OPENAI_API_KEY,'model-auth-only');assert.match(f.args().join(' '),/app-server/);});
for(const scenario of ['failed','exit','hang','approval','weak','policy','reviewer','network','sandbox'])test(`app-server ${scenario} rejects boundedly`,async t=>{const f=fixture(t,scenario);await assert.rejects(f.executor.execute({id:'t1',prompt:'Fix',workspace:f.workspace}),scenario==='hang'?/timed out/:/failed|exited|approval|unsupported|permission/i);});
test('cancellation interrupts the child',async t=>{const f=fixture(t,'hang'),controller=new AbortController();const job=f.executor.execute({id:'t1',prompt:'Fix',workspace:f.workspace,signal:controller.signal});setTimeout(()=>controller.abort(new DOMException('stop requested','AbortError')),20);await assert.rejects(job,/stop requested/);});
test('isolated codex home required',()=>assert.throws(()=>new CodexExecutor({}),/codexHome/));

test('completion before turn-start response and child exit cannot hang',async t=>{const f=fixture(t,'early');let timer;const deadline=new Promise(resolve=>{timer=setTimeout(()=>resolve({text:'HUNG'}),250)});try {const result=await Promise.race([f.executor.execute({id:'t1',prompt:'Fix',workspace:f.workspace}),deadline]);assert.equal(result.text,'Done');}finally{clearTimeout(timer);}});

test('managed built-in workspace profile with automatic review can execute a task',async t=>{const f=fixture(t,'builtin');const result=await f.executor.execute({id:'t1',prompt:'Fix tests',workspace:f.workspace});assert.equal(result.text,'Done');});

test('inherited MCP servers are disabled before starting a task',async t=>{const f=fixture(t,'inherited-mcp');assert.equal((await f.executor.execute({id:'t1',prompt:'Fix',workspace:f.workspace})).text,'Done');});


test('follow-up resumes its Codex thread with current permissions and reports only new usage',async t=>{const f=fixture(t,'resume');let session;const result=await f.executor.execute({id:'t2',prompt:'Continue',workspace:f.workspace,threadId:'thread-1',totalUsage:{inputTokens:7,cachedInputTokens:1,outputTokens:2,totalTokens:9}},()=>{},value=>session=value);assert.equal(result.text,'Done');assert.equal(result.usage.totalTokens,5);assert.equal(result.usage.inputTokens,3);assert.equal(result.usage.cachedInputTokens,1);assert.equal(session.threadId,'thread-1');assert.equal(session.totalUsage.totalTokens,14);});

test('final answer excludes commentary when Codex reports message phases',async t=>{const f=fixture(t,'phases');assert.equal((await f.executor.execute({id:'t1',prompt:'Fix',workspace:f.workspace})).text,'Done');});

for(const scenario of ['weak','policy','reviewer','network','sandbox','wrong-workspace','wrong-session','roots'])test(`resumed app-server ${scenario} fails closed before inference`,async t=>{const f=fixture(t,scenario);let saved=false;await assert.rejects(f.executor.execute({id:'t2',prompt:'Continue',workspace:f.workspace,threadId:'thread-1'},()=>{},()=>{saved=true;}),/permission|workspace|session/i);assert.equal(saved,false);});

test('app-server initialization enables the experimental permission and resume fields',async t=>{const f=fixture(t,'experimental');assert.equal((await f.executor.execute({id:'t2',prompt:'Continue',workspace:f.workspace,threadId:'thread-1'})).text,'Done');});
