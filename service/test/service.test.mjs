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
