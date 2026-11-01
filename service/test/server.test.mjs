import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { defaults } from '../config.mjs';
import { createServer, estimateEconomics } from '../server.mjs';
const token='test-admin-token-with-at-least-32-characters';
const store={listTickets:()=>[{id:'1',status:'succeeded',text:'<script>bad</script>'}],metrics:()=>({succeeded:1}),getTicket:id=>id==='1'?{id}:null};

test('API requires bearer authentication; health omits private state',async()=>{
  const server=createServer({store,config:defaults('/tmp/test'),adminToken:token,health:()=>({ready:true})});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  try{
    const publicHealth=await fetch(url+'/healthz'); assert.equal(publicHealth.status,200); assert.deepEqual(await publicHealth.json(),{ok:true});
    assert.equal((await fetch(url+'/api/status')).status,401);
    const status=await fetch(url+'/api/status',{headers:{Authorization:`Bearer ${token}`}}); assert.equal(status.status,200); assert.equal((await status.json()).health.ready,true);
    assert.equal((await fetch(url+'/api/status',{headers:{Authorization:`Bearer ${token}`,Origin:'https://evil.test'}})).status,403);
    assert.equal((await fetch(url+'/api/config',{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'text/plain'},body:'{}'})).status,415);
    const page=await fetch(url+'/'); assert.match(page.headers.get('content-security-policy'),/default-src 'self'/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('unexpected failures return 500 without being mislabeled as client errors',async()=>{
  const brokenStore={...store,metrics:()=>{throw new Error('database is offline');}};
  const server=createServer({store:brokenStore,config:defaults('/tmp/test'),adminToken:token});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  try{
    const response=await fetch(url+'/api/status',{headers:{Authorization:`Bearer ${token}`}});
    assert.equal(response.status,500);
    assert.deepEqual(await response.json(),{error:'Request could not be applied; check configuration and service health'});
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('invalid configuration remains a 400 response',async()=>{
  const server=createServer({store,config:defaults('/tmp/test'),adminToken:token,updateConfig:async()=>{throw new Error('must not persist invalid config');}});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  try{
    const response=await fetch(url+'/api/config',{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({mode:'invalid'})});
    assert.equal(response.status,400);
    assert.match((await response.json()).error,/mode must be observe, auto or paused/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('JSON media type matching is case-insensitive and accepts parameters',async()=>{
  const config=defaults('/tmp/test');
  const server=createServer({store,config,adminToken:token,updateConfig:async()=>{}});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  try{
    const response=await fetch(url+'/api/config',{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'Application/JSON; charset=UTF-8'},body:JSON.stringify({mode:'auto'})});
    assert.equal(response.status,200);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('mode-only saves preserve provider settings awaiting service restart',async()=>{
  const config=defaults('/tmp/test'),updates=[];
  const server=createServer({store,config,adminToken:token,updateConfig:async(next,options)=>updates.push({next:structuredClone(next),options})});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`,headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const github=[{id:'gh',baseUrl:'https://api.github.com',tokenEnv:'GITHUB_TOKEN',repositories:[{owner:'acme',repo:'widgets'}]}];
  try{
    const providerSave=await fetch(url+'/api/config',{method:'PUT',headers,body:JSON.stringify({github,pollSeconds:90})});
    assert.deepEqual(await providerSave.json(),{saved:true,restartRequired:true});
    const modeSave=await fetch(url+'/api/config',{method:'PUT',headers,body:JSON.stringify({mode:'auto'})});
    assert.deepEqual(await modeSave.json(),{saved:true,restartRequired:false});
    assert.deepEqual(updates[1].next.github,github);
    assert.equal(updates[1].next.pollSeconds,90);
    assert.equal(updates[1].next.mode,'auto');
    const savedConfig=await fetch(url+'/api/config',{headers:{Authorization:`Bearer ${token}`}});
    assert.deepEqual((await savedConfig.json()).github,github);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('malformed encoded ticket IDs remain a client error',async()=>{
  const server=createServer({store,config:defaults('/tmp/test'),adminToken:token});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  try{
    const response=await fetch(url+'/api/tickets/%E0%A4%A',{headers:{Authorization:`Bearer ${token}`}});
    assert.equal(response.status,400);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('ROI shows unknown without assumptions and separates cache tokens',()=>{
  const c=defaults('/tmp/test');
  assert.equal(estimateEconomics({succeeded:3},c.economics).roiPercent,null);
  Object.assign(c.economics,{inputPerMillion:2,cachedInputPerMillion:0.1,outputPerMillion:10,hourlyRate:60,savedMinutesPerSuccess:10,fixedCost:5});
  const e=estimateEconomics({succeeded:3,inputTokens:1000000,cachedInputTokens:500000,outputTokens:100000},c.economics);
  assert.equal(e.estimatedModelCost,2.05); assert.equal(e.estimatedBenefit,30); assert.equal(e.estimatedTotalCost,7.05);
});

test('full dashboard config save requires restart only when startup settings change',async()=>{
 const config=defaults('/tmp/test');
 const server=createServer({store,config,adminToken:token,updateConfig:async()=>{}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const patch=Object.fromEntries(['mode','pollSeconds','github','jenkins','slack','economics'].map(k=>[k,config[k]]));patch.mode='paused';
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/config`,{method:'PUT',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(patch)});
  assert.equal((await response.json()).restartRequired,false);
 }finally{await new Promise(r=>server.close(r));}
});
