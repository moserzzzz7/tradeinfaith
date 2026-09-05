// Isolated browser tests: synthetic account, mocked Supabase, no production writes.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const WebSocket=require('./local-cdp.cjs');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.equal((source.match(/<\/html>/g)||[]).length,1,'HTML must have exactly one document end');
for(const script of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new (require('node:vm').Script)(script[1]);
new (require('node:vm').Script)(fs.readFileSync(path.join(root,'journal-tools.js'),'utf8'));
const mock=`<script>
window.testDB={trades:[],learn:[],settings:{}};window.testFail=false;window.testWrites=0;
window.supabase={createClient:()=>({
 auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{}},
 from:()=>({
  select:()=>({eq:()=>({single:async()=>({data:window.testDB})})}),
  update:patch=>({eq:async()=>{if(window.testFail)return {error:{message:'simulated failure'}};window.testWrites++;Object.assign(window.testDB,structuredClone(patch));return {error:null};}})
 })
})};
</script>`;
const server=http.createServer((req,res)=>{
 const file={'/':'index.html','/index.html':'index.html','/journal-tools.js':'journal-tools.js','/journal-tools.css':'journal-tools.css','/icon-512.png':'icon-512.png','/manifest.json':'manifest.json'}[req.url];
 if(!file){res.writeHead(404);res.end();return;}
 let data=fs.readFileSync(path.join(root,file));
 if(file==='index.html') data=data.toString().replace(/<script src="https:\/\/cdn[^>]*><\/script>/,mock);
 res.setHeader('Content-Type',file.endsWith('html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'application/octet-stream');res.end(data);
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'tif-journal-browser-'));
 const chrome=process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
 const browser=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 console.log('Test process '+process.pid+'; isolated Chrome '+browser.pid);
 browser.on('error',e=>console.error('Chrome error: '+e.message));
 let socket;
 try {
  let port;
  for(let i=0;i<100;i++){try{port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);break}catch{}await sleep(100);}
  if(!port)throw Error('Chrome debugging endpoint unavailable');
  console.log('Debugging port '+port);
  const pages=await new Promise((resolve,reject)=>{const request=http.get('http://127.0.0.1:'+port+'/json/list',res=>{let body='';res.on('data',d=>body+=d);res.on('end',()=>{try{resolve(JSON.parse(body))}catch(e){reject(e)}})});request.setTimeout(5000,()=>request.destroy(Error('Debug endpoint timeout')));request.on('error',reject)});
  const page=pages.find(p=>p.type==='page' && p.url==='about:blank');
  if(!page)throw Error('Isolated page unavailable');
  socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Websocket open timeout')),5000);socket.onopen=()=>{clearTimeout(timer);resolve()};socket.onerror=()=>{clearTimeout(timer);reject(Error('Websocket failed'))}});
  let id=0;const pending=new Map(),errors=[];
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;const timeout=setTimeout(()=>reject(Error('Timeout: '+method+' '+(params.expression||'').slice(0,120))),10000);pending.set(i,{resolve:v=>{clearTimeout(timeout);resolve(v)},reject:e=>{clearTimeout(timeout);reject(e)}});socket.send(JSON.stringify({id:i,method,params}));});
  const run=async expression=>{if(expression.includes('await '))expression='(async()=>{'+expression+'})()';const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  console.log('Chrome connected');await call('Runtime.enable');await call('Page.enable');
  await call('Network.enable');await call('Network.setBlockedURLs',{urls:['https://*']});
  await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
  for(let i=0;i<100;i++){if(await run('(()=>{try{return typeof Journal!=="undefined" && typeof currentUser!=="undefined" && !!document.getElementById("j-score")}catch{return false}})()'))break;await sleep(50);}
  assert.deepEqual(errors,[],'Initial page errors');
  await run(`currentUser={id:'isolated-test',email:'test@example.invalid',user_metadata:{}};_cache=[];_introDone=true;document.getElementById('intro')?.remove();document.getElementById('auth-screen').style.display='none';document.getElementById('auth-loading')?.remove();document.querySelector('.app').style.display='flex';document.getElementById('splash')?.remove();initTradeDraft();window.setField=(id,v)=>{document.getElementById(id).value=v;document.getElementById(id).dispatchEvent(new Event('input',{bubbles:true}));};`);
  assert.equal(await run('document.querySelectorAll("#trade-wizard .wz-panel").length'),3);
  assert.deepEqual(await run(`(()=>{const ids=[...document.querySelectorAll('[id]')].map(x=>x.id);return ids.filter((x,i)=>ids.indexOf(x)!==i)})()`),[]);
  assert.equal(await run('Journal.execution({entry:"Yes",risk:"Yes"})'),null);
  assert.equal(await run('Journal.discipline([{rulebased:"yes",result:"Loss",emotion:"Anxious"}])'),100);
  assert.equal(await run('Journal.discipline([{result:"Win"}])'),null);
  assert.equal(await run('Journal.grade({context:"Yes",trigger:"No",conditions:"Yes"},"all")'),'Invalid');
  assert.equal(await run('Journal.scoreFor({criteria:{context:"Yes",trigger:"No",conditions:"Yes"},extras:"all",execution:{entry:"Yes",risk:"Yes",exit:"Yes"}})'),null);
  assert.equal(await run('Journal.inScope({date:"2026-09-02",journal:{mode:"Replay"}},30,"Live",new Date("2026-09-05T12:00:00"))'),false);
  assert.equal(await run('Journal.inScope({date:"2026-09-06"},30,"",new Date("2026-09-05T12:00:00"))'),false);
  await run(`setField('j-model','Test model');setField('f-exp','Wenn Level, dann Trigger');setField('j-context','Yes');setField('j-trigger','Yes');setField('j-conditions','Yes');setField('j-extras','all');setField('j-risk','100');setField('f-pnl','-100');setField('j-exec-entry','Yes');setField('j-exec-risk','Yes');setField('j-exec-exit','Yes');form.result='Loss';Journal.freezePlan();`);
  assert.equal(await run('Journal.patch().grade'),'A+');
  assert.equal(await run('Journal.patch().executionScore'),100);
  const snapshot=await run('JSON.stringify(form.journalPlanSnapshot)');
  await run(`setField('f-exp','Später geändert');Journal.freezePlan();saveTradeDraftNow();`);
  assert.equal(await run('JSON.stringify(form.journalPlanSnapshot)'),snapshot);
  await run('window.savedDraft=collectTradeDraft();clearForm();applyTradeDraft(window.savedDraft);');
  assert.equal(await run('Journal.value("j-model")'),'Test model');
  assert.equal(await run('JSON.stringify(form.journalPlanSnapshot)'),snapshot);
  await run(`testFail=true;await saveTrade();`);
  assert.equal(await run('_cache.length'),0);
  assert.equal(await run('Journal.value("j-model")'),'Test model');
  await run(`testFail=false;await saveTrade();`);
  assert.equal(await run('_cache.length'),1);
  assert.equal(await run('Journal.realizedR(_cache[0])'),-1);
  assert.equal(await run('_cache[0].executionScore'),100);
  assert.equal(await run('localStorage.getItem(tradeDraftKey())'),null);
  await run(`await editTrade(_cache[0].id);setField('j-exec-entry','');setField('j-context','');await saveTrade();`);
  assert.equal(await run('_cache[0].executionScore'),null,'Cleared modern assessment must not keep its previous score');
  assert.equal(await run('_cache[0].grade'),'','Cleared modern criterion must not keep its previous grade');
  assert.equal(await run('_cache[0].rulebased'),'','Incomplete check must not claim rule compliance');
  // Round-trip a historical record with old aliases, unsupported tags and unknown fields.
  await run(`window.old={id:123,date:'2026-08-18',instrument:'MNQ',direction:'Short',result:'Loss',pnl:-50,grade:'A',matchesPlaybook:'No',rulebased:'partial',toPlan:'Yes',deviated:'No',confirmationPresent:'Yes',chased:'Yes',patience:'No',execQuality:4,executionScore:57,biasWhy:'Original bias',expectations:'Original plan',biggestFactor:'Factor',why:'Older distinct explanation',lesson:'Current lesson',better:'Older distinct adjustment',setup:['Custom old tag','IFVG 1m'],emotion:'Unknown legacy emotion',screenshot:'',customData:{keep:true}};_cache=[structuredClone(old)];await editTrade(123);await saveTrade();`);
  const differences=await run(`Object.keys(old).filter(k=>JSON.stringify(old[k])!==JSON.stringify(_cache[0][k]))`);
  assert.deepEqual(differences,[],'Historical fields changed: '+differences);
  if(process.env.TRADE_FIXTURE){
    const originals=JSON.parse(fs.readFileSync(process.env.TRADE_FIXTURE,'utf8')).filter(t=>!t.isNoTrade).map(t=>({...t,screenshot:''}));
    await run('window.legacyFixtures='+JSON.stringify(originals));
    const r=await run(`return await (async()=>{const failures=[];for(const original of legacyFixtures){_cache=[structuredClone(original)];await editTrade(original.id);await saveTrade();for(const key of Object.keys(original)){if(JSON.stringify(original[key])!==JSON.stringify(_cache[0][key]))failures.push(key);}}return failures;})()`);
    assert.deepEqual(r,[],'Export round-trip changed historical fields');
    console.log('PASS: '+originals.length+' historical export records round-trip without changing original fields.');
  }
  await run(`clearForm();setField('f-lesson','Wenn <script>, dann Plan prüfen.');setField('j-focus','early');testFail=true;await Journal.toLearn();`);
  assert.equal(await run('loadLearn().length'),0);
  await run('testFail=false;await Journal.toLearn();Journal.renderRules();document.querySelector("#j-rules button").click();setField("j-rule-check","Yes");form.result="Breakeven";await saveTrade();await Journal.learnProgress();');
  assert.equal(await run('loadLearn().length'),1);
  assert.equal(await run('_cache[0].executionScore'),null,'Missing execution must not become zero');
  assert.ok((await run('document.getElementById("j-learn-progress").textContent')).includes('1/1'));
  await run(`statsRange=30;_cache=[{id:1,date:new Date().toISOString().slice(0,10),result:'Loss',rulebased:'yes',pnl:-10},{id:2,date:'2020-01-01',result:'Win',rulebased:'no',pnl:30}];await renderReview();`);
  assert.ok((await run('document.getElementById("stats-sub").textContent')).includes('1 Trades'));
  await run('await renderStats();');
  assert.ok(!(await run('document.getElementById("stats-el").textContent')).includes('Emotional control'));
  assert.equal(await run('disciplineStreak([{date:"2020-01-01",rulebased:"yes"}]).count'),1,'Waiting must not reset discipline');
  await run('setField("stats-mode","Replay");await renderReview();');
  assert.ok((await run('document.getElementById("stats-sub").textContent')).includes('0 Trades'));
  await run('setField("stats-mode","");');
  // Screenshot an empty, usable form at desktop and mobile widths.
  await sleep(400);
  await run(`clearForm();buildDock();switchTab('log',true);goStep(1);`);
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await sleep(500);
  assert.ok(await run('document.getElementById("trade-wizard").getBoundingClientRect().width>0'));
  const artifacts=path.join(os.tmpdir(),'tif-journal-qa');fs.mkdirSync(artifacts,{recursive:true});
  fs.writeFileSync(path.join(artifacts,'desktop.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(200);
  fs.writeFileSync(path.join(artifacts,'mobile.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  for(const step of [1,2,3]){
    await run('goStep('+step+')');
    await sleep(300);
    assert.ok(await run('document.documentElement.scrollWidth<=window.innerWidth'),'Mobile page overflows');
    assert.ok(await run('document.querySelector("#wz-'+step+'").getBoundingClientRect().width>0'),'Form panel must be visible');
    fs.writeFileSync(path.join(artifacts,'mobile-step'+step+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  await run('applyTheme("dark");goStep(2)');
  await sleep(300);
  fs.writeFileSync(path.join(artifacts,'mobile-dark.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  assert.deepEqual(errors,[],'Browser exceptions');
  console.log('PASS: draft/plan snapshots, failed/successful trade and Learn saves, legacy round-trip, rules, metrics, filters, mobile layout.');
  console.log('Screenshots: '+artifacts);
 } finally {socket?.close();browser.kill();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
