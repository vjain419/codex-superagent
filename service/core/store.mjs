import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ReactionStore } from './reactions.mjs';

const statuses = new Set(['observed','queued','running','succeeded','failed','interrupted']);
const terminal = new Set(['succeeded','failed','interrupted']);
const failure = event => {
  const lifecycle=String(event.lifecycle??event.status??'').toLowerCase();
  return !['queued','running','in_progress','waiting','pending'].includes(lifecycle) && ['failure','failed','unstable','timed_out','error'].includes(String(event.outcome??event.status).toLowerCase());
};
const decode = row => row ? JSON.parse(row.data) : undefined;
const conversationKey = event => event?.source==='slack' && event.authorized===true && ['team','channel','threadTs'].every(field=>typeof event.reply?.[field]==='string' && event.reply[field].length>0) ? JSON.stringify(['slack',event.reply.team,event.reply.channel,event.reply.threadTs]) : undefined;

/** Synchronous transactions keep intake, tickets and reply delivery intents indivisible. */
export class Store {
  constructor(path) {
    if(path !== ':memory:') mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.db = new DatabaseSync(path);
    if(path !== ':memory:') chmodSync(path,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS events (key TEXT PRIMARY KEY, data TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, event_key TEXT UNIQUE NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ci_builds (job TEXT NOT NULL, build TEXT NOT NULL, baseline INTEGER NOT NULL DEFAULT 0, ticket_id TEXT, PRIMARY KEY(job,build));
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (key TEXT PRIMARY KEY, workspace TEXT UNIQUE, thread_id TEXT UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS tickets_status ON tickets(status,created_at);
      CREATE INDEX IF NOT EXISTS outbox_status ON outbox(status);
      CREATE INDEX IF NOT EXISTS outbox_ticket ON outbox(ticket_id);`);
    this.reactions=new ReactionStore(this.db);
  }
  atomic(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result=fn(); this.db.exec('COMMIT'); return result; }
    catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  ingest(event,{mode='observe'}={}) { return this.atomic(()=>this._ingest(event,mode)); }
  ingestBatch(events,{mode='observe',sourceKey,baseline=false}={}) {
    return this.atomic(()=>{
      const results=events.map(event=>this._ingest({...event,baseline:baseline || event.baseline},mode));
      if(sourceKey && baseline) this.setState(`baseline:${sourceKey}`,true);
      return results;
    });
  }
  _ingest(event,mode) {
    if(!event || typeof event.id!=='string' || !event.id || !['slack','ci','manual','gerrit'].includes(event.source) || !['request','ci','review'].includes(event.kind)) throw new Error('Invalid event identity/source/kind');
    if(!['observe','auto','paused'].includes(mode)) throw new Error('Invalid acceptance mode');
    if(event.source==='gerrit' && (event.kind!=='review' || typeof event.change!=='string' || !/^[1-9][0-9]{0,19}$/.test(event.change) || !Number.isSafeInteger(event.patchset) || event.patchset<1 || typeof event.project!=='string' || !event.project.trim() || event.project.length>1024 || /[\u0000-\u001f\u007f]/.test(event.project) || !['NEW','MERGED','ABANDONED'].includes(event.status))) throw new Error('Invalid Gerrit review identity');
    if(event.source==='ci' && event.kind!=='ci') throw new Error('CI event kind required');
    if(event.source==='ci' && (typeof event.job!=='string' || !event.job || event.build==null)) throw new Error('CI job/build required');
    if(event.text!=null && (typeof event.text!=='string' || event.text.length>200000)) throw new Error('Invalid event text');
    const key=JSON.stringify([event.source,event.id]), now=new Date().toISOString();
    const inserted=this.db.prepare('INSERT OR IGNORE INTO events VALUES(?,?,?)').run(key,JSON.stringify(event),now);
    if(!inserted.changes) return {duplicate:true,eventId:event.id,ticket:decode(this.db.prepare('SELECT data FROM tickets WHERE event_key=?').get(key))};
    if(event.source==='gerrit') {
      if(event.baseline) return {duplicate:false,eventId:event.id,baseline:true};
    } else if(event.source==='ci') {
      this.db.prepare('INSERT OR IGNORE INTO ci_builds(job,build,baseline) VALUES(?,?,?)').run(event.job,String(event.build),event.baseline && failure(event)?1:0);
      const prior=this.db.prepare('SELECT * FROM ci_builds WHERE job=? AND build=?').get(event.job,String(event.build));
      if(event.baseline || prior.baseline || prior.ticket_id || !failure(event)) return {duplicate:false,eventId:event.id,baseline:!!event.baseline};
    } else if(event.authorized!==true || event.kind!=='request' || !event.text?.trim()) return {duplicate:false,eventId:event.id,rejected:true};
    const status=event.source==='gerrit' ? 'observed' : event.source!=='ci' || (mode==='auto' && String(event.outcome??event.status).toLowerCase()!=='unstable') ? 'queued' : 'observed';
    const ticket={id:randomUUID(),event,status,proactive:event.source==='ci',createdAt:now,updatedAt:now,usage:{inputTokens:0,outputTokens:0,totalTokens:0}};
    this.db.prepare('INSERT INTO tickets VALUES(?,?,?,?,?)').run(ticket.id,key,status,JSON.stringify(ticket),now);
    this.reactions.queue(ticket);
    if(event.source==='ci') this.db.prepare('UPDATE ci_builds SET ticket_id=? WHERE job=? AND build=?').run(ticket.id,event.job,String(event.build));
    return {duplicate:false,eventId:event.id,ticket};
  }
  getTicket(id) { return decode(this.db.prepare('SELECT data FROM tickets WHERE id=?').get(id)); }
  listTickets({limit=100,status}={}) {
    limit=Math.min(1000,Math.max(1,Number(limit)||100));
    return (status ? this.db.prepare('SELECT data FROM tickets WHERE status=? ORDER BY created_at DESC,rowid DESC LIMIT ?').all(status,limit) : this.db.prepare('SELECT data FROM tickets ORDER BY created_at DESC,rowid DESC LIMIT ?').all(limit)).map(decode);
  }
  nextQueued() { return decode(this.db.prepare("SELECT data FROM tickets WHERE status='queued' ORDER BY created_at,rowid LIMIT 1").get()); }
  updateTicket(id,patch) {
    const allowed=new Set(['status','workspace','result','error','usage','threadId','turnId','startedAt','finishedAt']);
    if(Object.keys(patch).some(key=>!allowed.has(key)) || (patch.status && !statuses.has(patch.status))) throw new Error('Invalid ticket update');
    return this.atomic(()=>{
      const old=this.getTicket(id); if(!old) throw new Error('Unknown ticket');
      const ticket={...old,...patch,updatedAt:new Date().toISOString()};
      this.db.prepare('UPDATE tickets SET status=?,data=? WHERE id=?').run(ticket.status,JSON.stringify(ticket),id);
      if(terminal.has(ticket.status) && old.status!==ticket.status) {
        this.reactions.queue(ticket);
        if(ticket.event.reply?.channel)this._outbox(ticket);
      }
      return ticket;
    });
  }
  _outbox(ticket) {
    const id=`${ticket.id}:${ticket.status}`;
    const row={id,ticketId:ticket.id,reply:ticket.event.reply,text:`[${ticket.id}] ${ticket.status}\n${ticket.result || ticket.error || (ticket.status==='succeeded'?'Execution completed without a text summary.':'Execution interrupted; inspect the ticket before retrying.')}`,status:'pending',attempts:0,createdAt:new Date().toISOString()};
    this.db.prepare('INSERT OR IGNORE INTO outbox VALUES(?,?,?,?)').run(id,ticket.id,'pending',JSON.stringify(row));
  }
  recoverRunning() {
    for(const ticket of this.listTickets({status:'running',limit:1000})) this.updateTicket(ticket.id,{status:'interrupted',error:'Service restarted during execution; automatic replay disabled.',finishedAt:new Date().toISOString()});
  }
  conversationFor(ticket) {
    const key=conversationKey(ticket.event); if(!key)return undefined;
    const existing=decode(this.db.prepare('SELECT data FROM conversations WHERE key=?').get(key)); if(existing)return existing;
    // Recover the last exact Slack context from pre-conversation ticket databases.
    const prior=this.db.prepare("SELECT data FROM tickets WHERE json_extract(data,'$.event.source')='slack' AND json_extract(data,'$.event.authorized')=1 AND json_extract(data,'$.event.reply.team')=? AND json_extract(data,'$.event.reply.channel')=? AND json_extract(data,'$.event.reply.threadTs')=? AND json_extract(data,'$.workspace') IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 1").get(ticket.event.reply.team,ticket.event.reply.channel,ticket.event.reply.threadTs);
    const old=decode(prior);
    const conversation=old ? {key,ownerTicketId:old.id,workspace:old.workspace,threadId:old.threadId,totalUsage:old.usage} : {key,ownerTicketId:ticket.id};
    return this.updateConversation(conversation,{});
  }
  updateConversation(conversation,patch) {
    const next={...conversation,...patch};
    if(next.workspace || next.threadId) {
      const related=this.db.prepare("SELECT data FROM tickets WHERE json_extract(data,'$.workspace')=? OR json_extract(data,'$.threadId')=?").all(next.workspace??null,next.threadId??null).map(decode);
      if(related.some(ticket=>conversationKey(ticket.event)!==next.key))throw new Error('Conversation workspace/session belongs to another context; execution refused');
    }
    this.db.prepare('INSERT INTO conversations VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET workspace=excluded.workspace,thread_id=excluded.thread_id,data=excluded.data').run(next.key,next.workspace??null,next.threadId??null,JSON.stringify(next));
    return next;
  }
  isThreadAuthorized({team,channel,threadTs}) {
    return !!this.db.prepare(`SELECT 1 FROM tickets WHERE json_extract(data,'$.event.source')='slack' AND json_extract(data,'$.event.authorized')=1 AND json_extract(data,'$.event.reply.channel')=? AND json_extract(data,'$.event.reply.threadTs')=? AND coalesce(json_extract(data,'$.event.reply.team'),'')=? LIMIT 1`).get(channel,threadTs,team??'');
  }
  getState(key) { const row=this.db.prepare('SELECT value FROM state WHERE key=?').get(key); return row ? JSON.parse(row.value) : undefined; }
  setState(key,value) { this.db.prepare('INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value)); }
  listOutbox({limit=100,dueAt=null}={}) {
    return this.db.prepare(`SELECT data FROM outbox WHERE status='pending'
      AND (? IS NULL OR coalesce(json_extract((SELECT value FROM state WHERE key='reply-retry:' || outbox.id),'$'),0)<=?)
      ORDER BY rowid LIMIT ?`).all(dueAt,dueAt,Math.max(1,Math.min(1000,Number(limit)||100))).map(decode);
  }
  listDeliveries(ticketId) {
    return this.db.prepare('SELECT data FROM outbox WHERE ticket_id=? ORDER BY rowid').all(ticketId).map(record=>{
      const {id,status,attempts,createdAt,updatedAt,error}=decode(record);
      const retry=status==='pending'?this.getState(`reply-retry:${id}`):undefined;
      return {id,status,attempts,createdAt,updatedAt,error,nextAttemptAt:Number.isFinite(retry)&&retry>0?new Date(retry).toISOString():undefined};
    });
  }
  markOutboxSent(id) { this._updateOutbox(id,true); }
  markOutboxFailed(id,error) { this._updateOutbox(id,false,error); }
  _updateOutbox(id,sent,error) {
    const row=decode(this.db.prepare('SELECT data FROM outbox WHERE id=?').get(id)); if(!row) throw new Error('Unknown outbox item');
    row.attempts++; row.updatedAt=new Date().toISOString(); row.status=sent?'sent':'pending'; row.error=sent?undefined:String(error).slice(0,500);
    this.db.prepare('UPDATE outbox SET status=?,data=? WHERE id=?').run(row.status,JSON.stringify(row),id);
  }
  metrics() {
    const statuses=Object.fromEntries(this.db.prepare('SELECT status,count(*) n FROM tickets GROUP BY status').all().map(row=>[row.status,row.n]));
    const tokens=this.db.prepare(`SELECT coalesce(sum(json_extract(data,'$.usage.inputTokens')),0) inputTokens,coalesce(sum(json_extract(data,'$.usage.cachedInputTokens')),0) cachedInputTokens,coalesce(sum(json_extract(data,'$.usage.outputTokens')),0) outputTokens,coalesce(sum(json_extract(data,'$.usage.totalTokens')),0) totalTokens FROM tickets`).get();
    return {total:Object.values(statuses).reduce((sum,n)=>sum+n,0),...Object.fromEntries([...new Set(['observed','queued','running','succeeded','failed','interrupted'])].map(status=>[status,statuses[status]??0])),...tokens,tickets:statuses,tokens:{...tokens},events:this.db.prepare('SELECT count(*) n FROM events').get().n,pendingReplies:this.db.prepare("SELECT count(*) n FROM outbox WHERE status='pending'").get().n};
  }
  close() { this.db.close(); }
}
