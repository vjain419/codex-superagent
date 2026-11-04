import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReactionStore} from '../core/reactions.mjs';
const ticket=(id='ticket-1',status='queued')=>({id,status,event:{source:'slack',messageTs:'12.3',reply:{team:'T1',channel:'C1',threadTs:'10.1'}}});
test('durable reactions target the original message, supersede stale work and skip delayed retries',()=>{
 const dir=mkdtempSync(join(tmpdir(),'reaction-store-')),file=join(dir,'state.sqlite');let db=new DatabaseSync(file),store=new ReactionStore(db);
 try{
  store.queue(ticket());let [eyes]=store.listPending();
  assert.equal(eyes.phase,'eyes');assert.deepEqual(eyes.destination,{team:'T1',channel:'C1',messageTs:'12.3'});
  store.queue(ticket());assert.equal(store.listPending().length,1);
  store.queue(ticket('ticket-1','succeeded'));
  assert.equal(store.markSent(eyes.id,eyes.revision),false,'Late eyes acknowledgement cannot clear done');
  let [done]=store.listPending();assert.equal(done.phase,'done');assert.equal(done.revision,eyes.revision+1);
  const future=Date.now()+60000;store.markFailed(done.id,done.revision,'temporary',future);
  assert.deepEqual(store.summary(),{pending:1,failed:1});
  store.queue(ticket('ticket-2','failed'));
  assert.deepEqual(store.listPending({limit:1}).map(x=>x.phase),['x'],'Delayed retry must not starve a ready reaction');
  db.close();db=new DatabaseSync(file);store=new ReactionStore(db);
  const restored=store.listPending({now:future+1}).find(x=>x.id==='ticket-1');
  assert.equal(restored.attempts,1);assert.equal(restored.error,'temporary');
  assert.equal(store.markSent(restored.id,restored.revision),true);
  assert.deepEqual(store.summary(),{pending:1,failed:0});
  const [failed]=store.listPending();store.markSent(failed.id,failed.revision);
  assert.deepEqual(store.summary(),{pending:0,failed:0});
  store.queue({...ticket('manual'),event:{source:'manual'}});assert.deepEqual(store.listPending(),[]);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
