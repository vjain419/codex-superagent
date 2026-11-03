import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {Store} from '../core/store.mjs';
import {Runtime} from '../core/runtime.mjs';
import {Monitor} from '../monitor.mjs';
import {defaults} from '../config.mjs';
import {createServer} from '../server.mjs';

test('Gerrit baselines existing patchsets, records new patchsets once and survives outage and restart',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'superagent-gerrit-'));let store=new Store(join(dir,'state.sqlite'));
  const config=defaults(dir);config.mode='auto';let revisions=1,broken=false;
  const fetch=async()=>{
    if(broken)throw new Error('unavailable');
    const entries=Object.fromEntries(Array.from({length:revisions},(_,i)=>[(i+1).toString(16).repeat(40),{_number:i+1}]));
    return new Response(")]}'\n"+JSON.stringify([{_number:42,project:'team/project',branch:'main',status:'NEW',subject:'Update',current_revision:revisions.toString(16).repeat(40),revisions:entries}]));
  };
  const secrets={github:[],jenkins:[],gerrit:[{id:'review',baseUrl:'https://gerrit.example.test',username:'reader',token:'fake',projects:['team/project']}]};
  let runtime=new Runtime({store,config,executor:{execute(){assert.fail('review events cannot execute');}}});
  let monitor=new Monitor({store,runtime,config,secrets,fetch});
  try{
    await monitor.tick();assert.equal(store.listTickets().length,0);
    revisions=2;await monitor.tick();await runtime.drain();
    assert.equal(store.listTickets().length,1);assert.equal(store.listTickets()[0].status,'observed');assert.equal(store.listTickets()[0].event.patchset,2);
    broken=true;await monitor.tick();assert.ok(Object.values(monitor.health).some(health=>!health.healthy));
    await runtime.stop();store.close();store=new Store(join(dir,'state.sqlite'));broken=false;
    runtime=new Runtime({store,config,executor:{execute(){assert.fail('review events cannot execute');}}});
    monitor=new Monitor({store,runtime,config,secrets,fetch});
    await monitor.tick();assert.equal(store.listTickets().length,1);
    revisions=3;await monitor.tick();await runtime.drain();assert.equal(store.listTickets().length,2);
  }finally{await runtime.stop();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('CI baseline, new failure, provider outage and restart keep durable identities',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'superagent-monitor-'));let store=new Store(join(dir,'state.sqlite'));
  const config=defaults(dir);let number=1,broken=false;
  const fetch=async url=>{if(broken)throw new Error('provider unavailable');return new Response(JSON.stringify(String(url).includes('/queue/')?{items:[]}:{builds:[{number,queueId:number+100,building:false,result:'FAILURE'}]}),{headers:{'content-type':'application/json'}});};
  const secrets={github:[],jenkins:[{id:'ci',baseUrl:'https://ci.example.test/',username:'read-user',token:'test-secret',jobs:['team/build']}]};
  const runtime=new Runtime({store,config,executor:{execute(){assert.fail('observe mode must not call a model');}}});
  const monitor=new Monitor({store,runtime,config,secrets,fetch});
  try{
    await monitor.tick();assert.equal(store.listTickets().length,0);
    number=2;await monitor.tick();assert.equal(store.listTickets().length,1);assert.equal(store.listTickets()[0].status,'observed');
    await monitor.tick();assert.equal(store.listTickets().length,1);
    broken=true;await monitor.tick();assert.equal(Object.values(monitor.health)[0].healthy,false);assert.equal(store.listTickets().length,1);
    await runtime.stop();store.close();store=new Store(join(dir,'state.sqlite'));
    const restarted=new Runtime({store,config,executor:{}}), resumed=new Monitor({store,runtime:restarted,config,secrets,fetch});
    broken=false;await resumed.tick();assert.equal(store.listTickets().length,1);await restarted.stop();
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('authenticated task reaches executor and measured dashboard; pause persists intake',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'superagent-flow-')),store=new Store(join(dir,'state.sqlite')),config=defaults(dir);
  const runtime=new Runtime({store,config,executor:{async execute(){return {text:'Fixture task complete',usage:{inputTokens:123,cachedInputTokens:23,outputTokens:45,totalTokens:168}};}}});
  const token='test-service-token-abcdefghijklmnopqrstuvwxyz';
  const server=createServer({store,config,adminToken:token,updateConfig:async next=>Object.assign(config,next),submit:text=>runtime.handleEvent({source:'manual',kind:'request',id:crypto.randomUUID(),text,authorized:true})});
  server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,body,method='POST')=>fetch(base+'/api/'+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
  try{
    const accepted=await request('tickets',{text:'Run the fixture'});assert.equal(accepted.status,202);await runtime.drain();
    const status=await (await fetch(base+'/api/status',{headers:{authorization:`Bearer ${token}`}})).json();
    assert.equal(status.metrics.succeeded,1);assert.equal(status.metrics.inputTokens,123);assert.equal(status.metrics.cachedInputTokens,23);assert.equal(status.economics.estimatedModelCost,null);
    assert.equal((await request('config',{mode:'paused'},'PUT')).status,200);
    await request('tickets',{text:'Wait until resumed'});await runtime.drain();assert.equal(store.metrics().queued,1);
  }finally{await runtime.stop();await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('authenticated ticket inspection distinguishes execution success from pending, failed and sent replies',async()=>{
  const store=new Store(':memory:'),config=defaults('/tmp/fixture-service');
  const token='fixture-inspection-token-abcdefghijklmnopqrstuvwxyz';
  const server=createServer({store,config,adminToken:token});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/api/`,headers={authorization:`Bearer ${token}`};
  const read=async path=>{const response=await fetch(base+path,{headers});assert.equal(response.status,200);return response.json();};
  let fail=true;
  const monitor=new Monitor({store,config,runtime:{},secrets:{},slack:{async send(){if(fail)throw new Error('unavailable');}}});
  try{
    const {ticket}=store.ingest({source:'slack',kind:'request',id:'fixture-event',authorized:true,text:'Check the fixture',reply:{team:'T1',channel:'C1',threadTs:'1.2'}});
    assert.equal((await fetch(base+'tickets/'+ticket.id)).status,401);
    assert.deepEqual((await read('tickets/'+ticket.id)).deliveries,[]);
    store.updateTicket(ticket.id,{status:'succeeded',result:'Fixture complete',finishedAt:new Date().toISOString()});
    let detail=await read('tickets/'+ticket.id);
    assert.equal(detail.status,'succeeded');
    assert.equal(detail.deliveries[0].status,'pending');
    assert.equal(detail.deliveries[0].attempts,0);
    assert.equal((await read('status')).metrics.pendingReplies,1);
    await monitor.flushReplies();
    detail=await read('tickets/'+ticket.id);
    const delivery=detail.deliveries[0];
    assert.equal(delivery.status,'pending');
    assert.equal(delivery.attempts,1);
    assert.equal(delivery.error,'Slack delivery failed');
    assert.ok(Number.isFinite(Date.parse(delivery.updatedAt)));
    assert.ok(Date.parse(delivery.nextAttemptAt)>Date.parse(delivery.updatedAt));
    assert.equal(delivery.text,undefined);
    fail=false;store.setState(`reply-retry:${delivery.id}`,0);
    await monitor.flushReplies();
    detail=await read('tickets/'+ticket.id);
    assert.equal(detail.deliveries[0].status,'sent');
    assert.equal(detail.deliveries[0].attempts,2);
    assert.equal(detail.deliveries[0].error,undefined);
    assert.equal(detail.deliveries[0].nextAttemptAt,undefined);
    assert.equal((await read('status')).metrics.pendingReplies,0);
    assert.equal((await fetch(base+'tickets/unknown',{headers})).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});
