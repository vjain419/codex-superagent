let token='', timer, selectedId;
const $=id=>document.getElementById(id);
const notice=message=>{$('notice').textContent=message;};
async function api(path,options={}){const response=await fetch('/api/'+path,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers}});const data=await response.json();if(!response.ok)throw new Error(data.error??'Request failed');return data;}
const display=value=>value===null||value===undefined?'Unavailable':typeof value==='number'?value.toLocaleString(undefined,{maximumFractionDigits:3}):String(value);
function metric(label,value){const div=document.createElement('div');div.className='metric';const strong=document.createElement('strong');strong.textContent=display(value);const span=document.createElement('span');span.textContent=label;div.append(strong,span);return div;}
const stateLabels={running:'In progress',queued:'Queued',observed:'Observed',succeeded:'Succeeded',failed:'Failed',interrupted:'Interrupted'};
const date=value=>value?new Date(value).toLocaleString():'Unavailable';
const source=t=>({manual:'Manual request',slack:'Slack request',ci:'CI failure',gerrit:'Gerrit review'}[t.event?.source]??'Unknown source');
function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function fields(pairs){const dl=element('dl');for(const [label,value] of pairs)dl.append(element('dt',label),element('dd',display(value)));return dl;}
function detailSection(title,content){const article=element('article',undefined,'detail-section');article.append(element('h3',title),content);return article;}
function renderHealth(health){
  const list=element('ul',undefined,'health-list');
  for(const text of [`Slack: ${health.slack??'Unavailable'}`,`Service started: ${date(health.startedAt)}`,health.restartRequired?'Configuration changes require a service restart.':'No configuration restart pending.'])list.append(element('li',text));
  if(health.runtimeError)list.append(element('li','Runtime: '+health.runtimeError));
  const providers=Object.entries(health.providers??{});
  for(const [name,p] of providers){const item=element('li',`${name}: ${p.healthy?'Healthy':'Unhealthy'} · checked ${date(p.checkedAt)}${p.complete===false?' · Incomplete poll':''}`);for(const error of p.errors??[])item.append(element('p',error));list.append(item);}
  if(!providers.length)list.append(element('li','No provider checks recorded yet.'));
  $('health').replaceChildren(list);
}
function renderTicket(t){
  const detail=$('detail'),rawOpen=detail.querySelector('details')?.open??false;
  const status=stateLabels[t.status]??t.status;
  detail.replaceChildren(element('h3',status+' · '+source(t)),fields([['Ticket',t.id],['Created',date(t.createdAt)],['Last updated',date(t.updatedAt)]]));
  detail.append(detailSection('Request',element('p',t.event?.text||'No request text recorded.','ticket-text')));
  const timeline=element('ol',undefined,'timeline');
  for(const [label,value] of [['Ticket recorded',t.createdAt],['Execution started',t.startedAt],[(t.startedAt?'Execution finished':'Ticket closed')+' · '+status,t.finishedAt]])if(value)timeline.append(element('li',`${label} — ${date(value)}`));
  const history=element('div');history.append(timeline,element('p','Saved lifecycle timestamps only. Tool-by-tool activity is not recorded.','muted'));detail.append(detailSection('Lifecycle',history));
  const outcome=element('div');
  if(t.result)outcome.append(element('p',t.result,'ticket-text'));
  if(t.error)outcome.append(element('p','Error: '+t.error,'ticket-text'));
  if(!t.result&&!t.error)outcome.append(element('p',({running:'Execution in progress; no final result yet.',queued:'Waiting for execution.',observed:'Observed only; execution has not started.'}[t.status]??'No outcome text recorded.')));
  detail.append(detailSection('Outcome',outcome),detailSection('Usage',fields([['Input tokens',t.usage?.inputTokens],['Output tokens',t.usage?.outputTokens],['Total tokens',t.usage?.totalTokens]])));
  const delivery=element('div');
  if(!t.event?.reply?.channel)delivery.append(element('p','No Slack reply destination configured for this ticket.'));
  else if(!t.deliveries?.length)delivery.append(element('p',t.finishedAt?'No reply delivery record available.':'Reply pending execution completion.'));
  else for(const d of t.deliveries){
    const item=element('div',undefined,'delivery');
    item.append(element('p',d.status==='sent'?'Sent to Slack.':d.attempts?'Pending retry.':'Pending delivery; not yet attempted.'));
    item.append(fields([['Attempts',d.attempts],['Reply queued',date(d.createdAt)],...(d.updatedAt?[['Last attempt',date(d.updatedAt)]]:[]),...(d.nextAttemptAt?[['Next retry',date(d.nextAttemptAt)]]:[])]));
    if(d.error)item.append(element('p','Delivery error: '+d.error,'ticket-text'));
    delivery.append(item);
  }
  detail.append(detailSection('Reply delivery',delivery));
  const raw=element('details');raw.open=rawOpen;raw.append(element('summary','Raw JSON'),element('pre',JSON.stringify(t,null,2)));detail.append(raw);
}
async function refreshSelected(){const id=selectedId;if(!id)return;try{const ticket=await api('tickets/'+encodeURIComponent(id));if(selectedId===id)renderTicket(ticket);}catch(e){if(selectedId===id)notice('Ticket detail refresh failed: '+e.message);}}
async function inspect(id){selectedId=id;$('detail').textContent='Loading ticket…';$('ticket-detail').open=true;await refreshSelected();if(selectedId===id)$('ticket-detail').scrollIntoView({block:'start'});}
async function refresh(){try{
  const [status,tickets]=await Promise.all([api('status'),api('tickets')]);
  $('mode').textContent=status.mode;$('updated').textContent='Updated '+new Date().toLocaleTimeString();
  const m=status.metrics;
  $('metrics').replaceChildren(metric('Tickets',m.total??tickets.tickets.length),metric('In progress',m.running??0),metric('Queued',m.queued??0),metric('Observed',m.observed??0),metric('Succeeded',m.succeeded??0),metric('Failed',m.failed??0),metric('Interrupted',m.interrupted??0),metric('Pending replies',m.pendingReplies??0),metric('Total tokens',(m.inputTokens??0)+(m.outputTokens??0)));
  renderHealth(status.health);
  $('economics').replaceChildren();for(const [key,label] of [['estimatedModelCost','Model cost'],['estimatedTotalCost','Total cost'],['estimatedBenefit','Assumed benefit'],['roiPercent','Estimated ROI %']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=display(status.economics[key])+(status.economics[key]!==null&&key!=='roiPercent'?' '+status.economics.currency:'');$('economics').append(dt,dd);}
  $('ticket-rows').replaceChildren();
  for(const t of tickets.tickets){
    const row=document.createElement('tr');
    for(const value of [t.id.slice(0,12),(t.event?.text||'No request text').replace(/\s+/g,' ').slice(0,140)+((t.event?.text?.length??0)>140?'…':''),source(t),stateLabels[t.status]??t.status,date(t.createdAt)]){const td=element('td',value);row.append(td);}
    const td=document.createElement('td'),button=element('button','Inspect');button.onclick=()=>inspect(t.id);td.append(button);
    if(['queued','running','observed'].includes(t.status)){const cancel=element('button','Cancel','secondary');cancel.onclick=async()=>{try{await api('tickets/'+encodeURIComponent(t.id)+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});notice('Cancellation recorded.');await refresh();}catch(e){notice(e.message);}};td.append(cancel);}
    row.append(td);$('ticket-rows').append(row);
  }
  if(selectedId&&$('ticket-detail').open)await refreshSelected();
}catch(e){notice(e.message);}}
$('login-form').onsubmit=async event=>{event.preventDefault();token=$('token').value;try{const c=await api('config');$('config').value=JSON.stringify(Object.fromEntries(['mode','pollSeconds','github','jenkins','gerrit','slack','economics'].map(k=>[k,k==='gerrit'?c[k]??[]:c[k]])),null,2);$('login').hidden=true;$('dashboard').hidden=false;$('token').value='';notice('Connected. Polling status every 10 seconds.');await refresh();clearInterval(timer);timer=setInterval(refresh,10000);}catch(e){token='';notice(e.message);}};
$('logout').onclick=()=>{token='';selectedId=undefined;clearInterval(timer);$('dashboard').hidden=true;$('login').hidden=false;$('mode').textContent='Disconnected';$('ticket-rows').replaceChildren();$('detail').textContent='';$('config').value='';$('config-notice').textContent='';notice('Disconnected.');};
$('config-form').onsubmit=async event=>{
  event.preventDefault();
  const button=$('config-save'), feedback=$('config-notice');
  const report=message=>{feedback.textContent=message;feedback.scrollIntoView({block:'nearest'});};
  button.disabled=true;
  button.textContent='Saving…';
  report('Validating and saving…');
  try{
    const body=JSON.stringify(JSON.parse($('config').value));
    const result=await api('config',{method:'PUT',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(15000)});
    report(result.restartRequired?'Saved. Restart the VM service to apply provider/poll changes. Mode and economics applied now.':'Saved and applied.');
    void refresh();
  }catch(e){
    const reason=e.name==='TimeoutError'?'The service did not respond within 15 seconds.':e instanceof TypeError?'Cannot reach the service. Check your connection or SSH tunnel.':e.message;
    report('Save not confirmed: '+reason+' Your edits are still here. Check saved settings after reconnecting before retrying.');
  }finally{
    button.disabled=false;
    button.textContent='Validate & save';
  }
};
$('task-form').onsubmit=async event=>{event.preventDefault();try{const result=await api('tickets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:$('task').value})});notice('Request recorded'+(result.ticket?.id?': '+result.ticket.id:'.'));$('task').value='';await refresh();}catch(e){notice(e.message);}};
