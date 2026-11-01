import { createServer as httpServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateConfig } from './config.mjs';

export function estimateEconomics(metrics, rates) {
  const input=metrics.inputTokens ?? 0, cached=Math.min(metrics.cachedInputTokens ?? 0,input), output=metrics.outputTokens ?? 0;
  const known=[rates.inputPerMillion,rates.cachedInputPerMillion,rates.outputPerMillion].every(n=>Number.isFinite(n));
  const cost=known ? ((input-cached)*rates.inputPerMillion+cached*rates.cachedInputPerMillion+output*rates.outputPerMillion)/1e6 : null;
  const benefit=Number.isFinite(rates.hourlyRate) && Number.isFinite(rates.savedMinutesPerSuccess) ? (metrics.succeeded ?? 0)*rates.savedMinutesPerSuccess/60*rates.hourlyRate : null;
  const total=cost===null?null:cost+(rates.fixedCost ?? 0);
  return {currency:rates.currency,estimatedModelCost:cost,estimatedBenefit:benefit,estimatedTotalCost:total,roiPercent:total>0&&benefit!==null?(benefit-total)/total*100:null};
}
const assets=new Map([['/',['index.html','text/html']],['/app.js',['app.js','text/javascript']],['/style.css',['style.css','text/css']]]);
function decodePathComponent(value) {
  try { return decodeURIComponent(value); }
  catch { throw Object.assign(new Error('Invalid path encoding'),{status:400}); }
}
function authenticated(req,token) {
  const got=Buffer.from(req.headers.authorization ?? ''), want=Buffer.from(`Bearer ${token}`);
  return got.length===want.length && timingSafeEqual(got,want);
}
async function jsonBody(req) {
  if((req.headers['content-type']??'').split(';',1)[0].trim().toLowerCase() !== 'application/json') throw Object.assign(new Error('JSON required'),{status:415});
  const chunks=[]; let size=0;
  for await(const chunk of req) {size+=chunk.length;if(size>65536) throw Object.assign(new Error('Request too large'),{status:413});chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}
}
export function createServer({store,config,adminToken,health=()=>({}),updateConfig,submit,cancel}) {
  if(typeof adminToken!=='string'||adminToken.length<32) throw new Error('Admin token must have at least 32 characters');
  let desiredConfig={...structuredClone(config),gerrit:structuredClone(config.gerrit??[])};
  return httpServer(async(req,res)=>{
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    try {
      const path=new URL(req.url,'http://localhost').pathname;
      if(path==='/healthz'&&req.method==='GET') return send(200,{ok:true});
      if(assets.has(path)&&req.method==='GET') {const [file,type]=assets.get(path);res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});return res.end(readFileSync(new URL(`web/${file}`,import.meta.url)));}
      if(!path.startsWith('/api/')) return send(404,{error:'Not found'});
      if(!authenticated(req,adminToken)) return send(401,{error:'Authentication required'});
      if(req.headers.origin) {
        const expected=`http://${req.headers.host}`; const httpsExpected=`https://${req.headers.host}`;
        if(![expected,httpsExpected].includes(req.headers.origin)) return send(403,{error:'Origin denied'});
      }
      if(req.method==='GET'&&path==='/api/status') {const metrics=store.metrics();return send(200,{mode:config.mode,health:health(),metrics,economics:estimateEconomics(metrics,config.economics)});}
      if(req.method==='GET'&&path==='/api/tickets') return send(200,{tickets:store.listTickets({limit:100})});
      if(req.method==='GET'&&path.startsWith('/api/tickets/')) {const t=store.getTicket(decodePathComponent(path.slice(13)));return send(t?200:404,t??{error:'Ticket not found'});}
      if(req.method==='GET'&&path==='/api/config') return send(200,desiredConfig);
      if(req.method==='PUT'&&path==='/api/config') {
        const patch=await jsonBody(req),allowed=['mode','pollSeconds','github','jenkins','gerrit','slack','economics'];
        if(!patch||Array.isArray(patch)||Object.keys(patch).some(k=>!allowed.includes(k))) return send(400,{error:'Only operational settings can be edited here; edit paths/model in the VM configuration file'});
        let next;
        try { next=validateConfig({...desiredConfig,...patch}); }
        catch(error) { return send(400,{error:error.message}); }
        if(!updateConfig) return send(503,{error:'Configuration persistence unavailable'});
        const restartRequired=Object.keys(patch).some(k=>!['mode','economics'].includes(k) && JSON.stringify(next[k])!==JSON.stringify(desiredConfig[k]));
        await updateConfig(next,{restartRequired});
        desiredConfig=next;
        config.mode=next.mode;config.economics=next.economics;
        return send(200,{saved:true,restartRequired});
      }
      if(req.method==='POST'&&path==='/api/tickets') {
        const body=await jsonBody(req);
        if(typeof body?.text!=='string'||!body.text.trim()||body.text.length>16000) return send(400,{error:'Request text must contain 1–16000 characters'});
        if(!submit) return send(503,{error:'Executor unavailable'});
        return send(202,await submit(body.text));
      }
      if(req.method==='POST'&&path.match(/^\/api\/tickets\/[^/]+\/cancel$/)) {
        await jsonBody(req); if(!cancel) return send(503,{error:'Cancellation unavailable'});
        return send(200,await cancel(decodePathComponent(path.split('/')[3])));
      }
      return send(404,{error:'Not found'});
    }catch(error){send(error.status??500,{error:error.status?error.message:'Request could not be applied; check configuration and service health'});}
  });
}
