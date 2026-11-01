import { createHash } from 'node:crypto';
import { pollGithub, pollJenkins } from './connectors/ci.mjs';

export class Monitor {
  constructor({runtime,store,config,secrets,slack,fetch=globalThis.fetch}) {Object.assign(this,{runtime,store,config,secrets,slack,fetch});this.health={};this.busy=false;this.stopped=false;}
  async tick() {
    if(this.busy||this.stopped)return; this.busy=true;
    try {
      for(const kind of ['github','jenkins']) for(const configured of this.secrets[kind]) {
        const selectors=kind==='github'?configured.repositories:configured.jobs;
        for(const selector of selectors) {
          if(this.stopped)break;
          const p={...configured,[kind==='github'?'repositories':'jobs']:[selector]};
          const name=typeof selector==='string'?selector:`${selector.owner}/${selector.repo}`;
          const hash=createHash('sha256').update(JSON.stringify([p.baseUrl,selector,p.maxPages,p.perPage,p.maxBuilds])).digest('hex').slice(0,12);
          const key=`${kind}:${p.id}:${name}:${hash}`;
          try {
            const result=await (kind==='github'?pollGithub:pollJenkins)(p,{fetch:this.fetch});
            this.health[key]={healthy:result.healthy,complete:result.complete,checkedAt:new Date().toISOString(),errors:result.errors};
            if(!result.healthy||result.snapshotComplete===false)continue;
            const baseline=!this.store.getState(`baseline:${key}`);
            const events=result.events.map(event=>({...event,reply:event.reply??(this.config.slack.enabled?{team:this.config.slack.teamId,channel:this.config.slack.channelIds[0]}:undefined)}));
            this.runtime.handleEvents(events,{sourceKey:key,baseline});
            this.store.setState(`poll:${key}`,{at:new Date().toISOString(),count:events.length,complete:result.complete});
          }catch{this.health[key]={healthy:false,checkedAt:new Date().toISOString(),errors:['Provider polling failed']};}
        }
      }
      await this.flushReplies();
    }finally{this.busy=false;}
  }
  async flushReplies() {
    if(!this.slack||this.sending)return;this.sending=true;
    try{for(const item of this.store.listOutbox({limit:20})){
      if(this.stopped)break;
      const retry=this.store.getState(`reply-retry:${item.id}`)??0;
      if(Date.now()<retry)continue;
      try{await this.slack.send(item.reply,item.text);this.store.markOutboxSent(item.id);}
      catch(error){this.store.markOutboxFailed(item.id,'Slack delivery failed');const delay=Math.max(Number.isFinite(error.retryAfterMs)?error.retryAfterMs:0,Math.min(3600000,30000*2**Math.min(item.attempts,7)));this.store.setState(`reply-retry:${item.id}`,Date.now()+delay);}
    }}finally{this.sending=false;}
  }
  stop(){this.stopped=true;}
}
