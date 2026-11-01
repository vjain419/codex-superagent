import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { defaults, loadConfig, saveConfig, resolveSecrets } from './config.mjs';
import { Store } from './core/store.mjs';
import { InstanceLock } from './lock.mjs';
import { Runtime } from './core/runtime.mjs';
import { CodexExecutor } from './codex/executor.mjs';
import { SlackConnector } from './connectors/slack.mjs';
import { Monitor } from './monitor.mjs';
import { createServer } from './server.mjs';

process.umask(0o077);
const file=resolve(process.env.SUPERAGENT_CONFIG??'data/config.json'), data=dirname(file),command=process.argv[2];
if(command==='init') {
  if(existsSync(file)) throw new Error('Configuration exists; refusing to overwrite');
  mkdirSync(data,{recursive:true,mode:0o700});
  saveConfig(file,defaults(data));
  const envPath=join(data,'service.env');
  if(!existsSync(envPath))writeFileSync(envPath,`SUPERAGENT_ADMIN_TOKEN=${randomBytes(32).toString('hex')}\n`,{mode:0o600,flag:'wx'});
  console.log(`Created ${file} and private ${envPath}. Load service.env to start. No secret values printed.`);
} else {
  const config=loadConfig(file);
  if(command==='doctor') {
    const checks={configuration:'valid',node:process.version,integrations:{github:config.github.length,jenkins:config.jenkins.length,slack:config.slack.enabled}};
    try{resolveSecrets(config);checks.environment='ready';}catch(error){checks.environment=error.message;process.exitCode=1;}
    try{checks.codex=execFileSync(config.codexCommand,['--version'],{encoding:'utf8',timeout:5000}).trim();}catch{checks.codex='unavailable';process.exitCode=1;}
    checks.codexHome=existsSync(config.codexHome)?'exists; authentication not verified':'not initialized';
    console.log(JSON.stringify(checks,null,2));
  } else {
    if(command) throw new Error('Usage: node main.mjs [init|doctor]');
    const secrets=resolveSecrets(config);
    const ownership=new InstanceLock(data);
    const store=new Store(join(data,'state.sqlite'));
    const executor=new CodexExecutor({command:config.codexCommand,model:config.model,effort:config.effort,timeoutMs:config.turnTimeoutMs,codexHome:config.codexHome});
    const runtime=new Runtime({store,executor,config});
    const health={startedAt:new Date().toISOString(),slack:config.slack.enabled?'connecting':'disabled',restartRequired:false};
    const slack=secrets.slack?new SlackConnector(secrets.slack,{onEvent:event=>runtime.handleEvent(event),isThreadAuthorized:reply=>store.isThreadAuthorized(reply),onError:()=>{health.slack='error';},onStatus:status=>{health.slack=status;}}):null;
    const monitor=new Monitor({runtime,store,config,secrets,slack});
    const server=createServer({store,config,adminToken:secrets.adminToken,health:()=>({...health,providers:monitor.health,runtimeError:runtime.lastError?'Execution loop failed; inspect tickets':null}),
      updateConfig:async(next,{restartRequired})=>{saveConfig(file,next);health.restartRequired ||= restartRequired;config.mode=next.mode;config.economics=next.economics;queueMicrotask(()=>runtime.drain().catch(()=>{}));},
      submit:text=>runtime.handleEvent({source:'manual',kind:'request',id:randomUUID(),authorized:true,text}),
      cancel:id=>runtime.cancel(id),
    });
    let closing=false,pollTimer,outboxTimer;
    server.listen(config.port,config.host,()=>console.log(`Codex Superagent listening on ${config.host}:${config.port} (${config.mode})`));
    server.on('error',()=>{console.error('HTTP listener failed');void shutdown();process.exitCode=1;});
    if(slack)try{await slack.start();health.slack='connected';}catch{health.slack='error';console.error('Slack connection failed; restart after checking environment and app settings');}
    if(closing) {await slack?.stop(); process.exitCode=1;}
    else {
    pollTimer=setInterval(()=>void monitor.tick(),config.pollSeconds*1000);
    outboxTimer=setInterval(()=>void monitor.flushReplies(),5000);
    void monitor.tick();void runtime.drain();
    }
    async function shutdown(){if(closing)return;closing=true;clearInterval(pollTimer);clearInterval(outboxTimer);monitor.stop();await runtime.stop();await slack?.stop();await new Promise(resolve=>server.close(resolve));while(monitor.busy||monitor.sending)await new Promise(resolve=>setTimeout(resolve,20));store.close();ownership.close();}
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void shutdown());
  }
}
