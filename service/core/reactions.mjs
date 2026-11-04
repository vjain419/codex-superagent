const decode=row=>row?JSON.parse(row.data):undefined;

/** Durable desired reaction state; revisions protect against late acknowledgements. */
export class ReactionStore {
  constructor(db){
    this.db=db;
    db.exec(`CREATE TABLE IF NOT EXISTS slack_reactions (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, status TEXT NOT NULL, next_attempt_at INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS slack_reactions_due ON slack_reactions(status,next_attempt_at);`);
  }
  queue(ticket){
    const event=ticket.event,reply=event?.reply;
    if(event?.source!=='slack'||!reply?.team||!reply.channel||!/^\d+\.\d+$/.test(event.messageTs??''))return;
    const phase=ticket.status==='succeeded'?'done':['failed','interrupted'].includes(ticket.status)?'x':'eyes';
    const old=decode(this.db.prepare('SELECT data FROM slack_reactions WHERE id=?').get(ticket.id));
    if(old?.phase===phase)return;
    const row={id:ticket.id,revision:(old?.revision??0)+1,phase,destination:{team:reply.team,channel:reply.channel,messageTs:event.messageTs},status:'pending',attempts:0,nextAttemptAt:0};
    this.db.prepare('INSERT INTO slack_reactions VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,status=excluded.status,next_attempt_at=excluded.next_attempt_at,data=excluded.data').run(row.id,row.revision,row.status,0,JSON.stringify(row));
  }
  listPending({limit=20,now=Date.now()}={}){
    const bounded=Math.max(1,Math.min(100,Math.trunc(Number(limit))||20));
    return this.db.prepare("SELECT data FROM slack_reactions WHERE status='pending' AND next_attempt_at<=? ORDER BY next_attempt_at,rowid LIMIT ?").all(now,bounded).map(decode);
  }
  markSent(id,revision){return this.update(id,revision,{status:'sent',error:undefined,nextAttemptAt:0});}
  markFailed(id,revision,error,nextAttemptAt){
    if(!Number.isFinite(nextAttemptAt)||nextAttemptAt<0)throw new Error('Invalid reaction retry time');
    return this.update(id,revision,{status:'pending',error:String(error).slice(0,500),nextAttemptAt});
  }
  update(id,revision,patch){
    const old=decode(this.db.prepare('SELECT data FROM slack_reactions WHERE id=? AND revision=?').get(id,revision));
    if(!old)return false;
    const row={...old,...patch,attempts:old.attempts+1,updatedAt:new Date().toISOString()};
    return this.db.prepare('UPDATE slack_reactions SET status=?,next_attempt_at=?,data=? WHERE id=? AND revision=?').run(row.status,row.nextAttemptAt,JSON.stringify(row),id,revision).changes===1;
  }
  summary(){
    const row=this.db.prepare("SELECT count(*) pending,coalesce(sum(json_extract(data,'$.attempts')>0),0) failed FROM slack_reactions WHERE status='pending'").get();
    return {pending:row.pending,failed:row.failed};
  }
}
