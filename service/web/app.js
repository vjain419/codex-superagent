let token='', timer;
const $=id=>document.getElementById(id);
const notice=message=>{$('notice').textContent=message;};
async function api(path,options={}){const response=await fetch('/api/'+path,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers}});const data=await response.json();if(!response.ok)throw new Error(data.error??'Request failed');return data;}
const display=value=>value===null||value===undefined?'Unavailable':typeof value==='number'?value.toLocaleString(undefined,{maximumFractionDigits:3}):String(value);
function metric(label,value){const div=document.createElement('div');div.className='metric';const strong=document.createElement('strong');strong.textContent=display(value);const span=document.createElement('span');span.textContent=label;div.append(strong,span);return div;}
async function refresh(){try{const [status,tickets]=await Promise.all([api('status'),api('tickets')]);$('mode').textContent=status.mode;$('updated').textContent='Updated '+new Date().toLocaleTimeString();const m=status.metrics;$('metrics').replaceChildren(metric('Tickets',m.total??m.tickets??tickets.tickets.length),metric('Completed turns',m.succeeded??0),metric('Failed turns',m.failed??0),metric('Total tokens',(m.inputTokens??0)+(m.outputTokens??0)));$('health').textContent=JSON.stringify(status.health,null,2);$('economics').replaceChildren();for(const [key,label] of [['estimatedModelCost','Model cost'],['estimatedTotalCost','Total cost'],['estimatedBenefit','Assumed benefit'],['roiPercent','Estimated ROI %']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=display(status.economics[key])+(status.economics[key]!==null&&key!=='roiPercent'?' '+status.economics.currency:'');$('economics').append(dt,dd);} $('ticket-rows').replaceChildren();for(const t of tickets.tickets){const row=document.createElement('tr');for(const value of [t.id.slice(0,12),t.status,t.createdAt?new Date(t.createdAt).toLocaleString():'—']){const td=document.createElement('td');td.textContent=value;row.append(td);}const td=document.createElement('td'),button=document.createElement('button');button.textContent='Inspect';button.onclick=async()=>{try{$('detail').textContent=JSON.stringify(await api('tickets/'+encodeURIComponent(t.id)),null,2);$('ticket-detail').open=true;}catch(e){notice(e.message);}};td.append(button);if(['queued','running','observed'].includes(t.status)){const cancel=document.createElement('button');cancel.className='secondary';cancel.textContent='Cancel';cancel.onclick=async()=>{try{await api('tickets/'+encodeURIComponent(t.id)+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});notice('Cancellation recorded.');await refresh();}catch(e){notice(e.message);}};td.append(cancel);}row.append(td);$('ticket-rows').append(row);}}catch(e){notice(e.message);}}
$('login-form').onsubmit=async event=>{event.preventDefault();token=$('token').value;try{const c=await api('config');$('config').value=JSON.stringify(Object.fromEntries(['mode','pollSeconds','github','jenkins','gerrit','slack','economics'].map(k=>[k,k==='gerrit'?c[k]??[]:c[k]])),null,2);$('login').hidden=true;$('dashboard').hidden=false;$('token').value='';notice('Connected. Polling status every 10 seconds.');await refresh();clearInterval(timer);timer=setInterval(refresh,10000);}catch(e){token='';notice(e.message);}};
$('logout').onclick=()=>{token='';clearInterval(timer);$('dashboard').hidden=true;$('login').hidden=false;$('mode').textContent='Disconnected';$('ticket-rows').replaceChildren();$('detail').textContent='';$('config').value='';$('config-notice').textContent='';notice('Disconnected.');};
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
