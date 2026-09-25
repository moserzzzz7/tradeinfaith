// Isolated browser tests: synthetic account, mocked Supabase, no production writes.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const WebSocket=require('./local-cdp.cjs');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.equal((source.match(/<\/html>/g)||[]).length,1,'HTML must have exactly one document end');
assert.ok(!/prefers-reduced-motion|matchMedia/.test(source),'Animations must not depend on the OS reduced-motion setting');
assert.ok(!/prefers-reduced-motion|matchMedia/.test(fs.readFileSync(path.join(root,'journal-tools.css'),'utf8')));
assert.ok(!/prefers-reduced-motion|matchMedia/.test(fs.readFileSync(path.join(root,'journal-tools.js'),'utf8')));
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
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
  for(let i=0;i<100;i++){if(await run('(()=>{try{return typeof Journal!=="undefined" && typeof currentUser!=="undefined" && !!document.getElementById("trade-wizard")}catch{return false}})()'))break;await sleep(50);}
  assert.deepEqual(errors,[],'Initial page errors');
  assert.equal(await run('!!document.getElementById("intro")'),true,'Intro still starts when reduced motion is enabled');
  await run(`currentUser={id:'isolated-test',email:'test@example.invalid',user_metadata:{}};_cache=[];_introDone=true;document.getElementById('intro')?.remove();document.getElementById('auth-screen').style.display='none';document.getElementById('auth-loading')?.remove();document.querySelector('.app').style.display='flex';document.getElementById('splash')?.remove();initTradeDraft();window.setField=(id,v)=>{document.getElementById(id).value=v;document.getElementById(id).dispatchEvent(new Event('input',{bubbles:true}));};`);
  assert.equal(await run('document.querySelectorAll("#trade-wizard .wz-panel").length'),3);
  await run('goStep(2)');
  assert.equal(await run('getComputedStyle(document.getElementById("wz-2")).animationName'),'fadein','Wizard transitions still run with reduced motion enabled');
  await run('goStep(1)');
  assert.deepEqual(await run(`(()=>{const ids=[...document.querySelectorAll('[id]')].map(x=>x.id);return ids.filter((x,i)=>ids.indexOf(x)!==i)})()`),[]);
  assert.equal(await run('Journal.execution({entry:"Yes",risk:"Yes"})'),null);
  assert.equal(await run('Journal.discipline([{rulebased:"yes",result:"Loss",emotion:"Anxious"}])'),100);
  assert.equal(await run('Journal.discipline([{result:"Win"}])'),null);
  // Not journaling costs 0.5 per missed weekday; weekends and today do not count.
  const idleScore=(entries,today)=>run('Journal.disciplineNow('+JSON.stringify(entries)+',new Date("'+today+'T12:00:00")).score');
  assert.equal(await idleScore([{date:'2026-09-18',rulebased:'yes'}],'2026-09-21'),100,'A weekend is no journaling gap');
  assert.equal(await idleScore([{date:'2026-09-14',rulebased:'yes'}],'2026-09-21'),80,'A week without journaling costs at least 2 points');
  assert.equal(await idleScore([{date:'2026-09-11',rulebased:'yes'}],'2026-09-21'),75,'A full missed trading week costs 2.5');
  assert.equal(await idleScore([{date:'2026-08-01',rulebased:'partial'}],'2026-09-21'),0,'The score bottoms out at zero');
  assert.equal(await idleScore([{date:'2026-09-01',rulebased:'yes'},{date:'2026-09-18',isNoTrade:true}],'2026-09-21'),100,'A no-trade day counts as journaling');
  assert.equal(await run('Journal.grade({context:"Yes",trigger:"No",conditions:"Yes"},"all")'),'Invalid');
  assert.equal(await run('Journal.scoreFor({criteria:{context:"Yes",trigger:"No",conditions:"Yes"},extras:"all",execution:{entry:"Yes",risk:"Yes",exit:"Yes"}})'),100);
  assert.equal(await run('Journal.inScope({date:"2026-09-02",journal:{mode:"Replay"}},30,"Live",new Date("2026-09-05T12:00:00"))'),false);
  assert.equal(await run('Journal.inScope({date:"2026-09-06"},30,"",new Date("2026-09-05T12:00:00"))'),false);
  assert.equal(await run('document.querySelectorAll("#trade-wizard details").length'),1,'Only the legacy ratings disclosure remains');
  await run(`Journal.chooseFocus('early',document.querySelector('.lesson-chips .opt[data-v="early"]'));toggleEmo(document.querySelector('#psychology-chips .emo[data-emo="Calm"]'));toggleEmo(document.querySelector('#psychology-chips .emo[data-emo="Focused"]'));`);
  assert.ok((await run('Journal.value("f-lesson")')).startsWith('Next time: If'),'A takeaway chip prefills a lesson');
  assert.deepEqual(await run('getPsychology()'),['Calm','Focused'],'Psychology chips allow multiple selections');
  await run(`setField('f-exp','If level holds, then wait for the trigger.');setField('j-risk','100');setField('j-profit-target','250');setField('f-contracts','2');setField('f-pnl','-100');setField('j-exec-entry','Yes');setField('j-exec-risk','Yes');setField('j-exec-exit','Yes');setField('j-focus','early');setField('f-lesson','Next time: If the trigger is missing, then I wait.');form.result='Loss';`);
  assert.equal(await run('Journal.patch().grade'),undefined);
  assert.equal(await run('Journal.patch().executionScore'),100);
  assert.equal(await run('plannedRR()'),2.5);
  assert.equal(await run('Journal.current().mode'),'Live');
  await run(`saveTradeDraftNow();`);
  await run('window.savedDraft=collectTradeDraft();clearForm();applyTradeDraft(window.savedDraft);');
  assert.equal(await run('Journal.value("f-exp")'),'If level holds, then wait for the trigger.');
  assert.equal(await run('Journal.value("j-profit-target")'),'250');
  await run(`testFail=true;await saveTrade();`);
  assert.equal(await run('_cache.length'),0);
  assert.equal(await run('Journal.value("f-exp")'),'If level holds, then wait for the trigger.');
  await run(`testFail=false;await saveTrade();`);
  assert.equal(await run('_cache.length'),1);
  assert.equal(await run('Journal.realizedR(_cache[0])'),-1);
  assert.equal(await run('_cache[0].plannedRR'),2.5);
  assert.equal(await run('_cache[0].journal.profitTarget'),250);
  assert.equal(await run('_cache[0].journal.mode'),'Live');
  assert.deepEqual(await run('_cache[0].journal.psychology'),['Calm','Focused']);
  assert.equal(await run('_cache[0].executionScore'),100);
  assert.equal(await run('_cache[0].rulebased'),'yes','Three execution answers of Yes count as rule-based without setup criteria');
  assert.equal(await run('Journal.discipline(_cache)'),100);
  assert.deepEqual(await run(`['chased','patience','preEnergy','satisfied','biggestFactor','better','why'].filter(k=>k in _cache[0])`),[],'New trades do not write empty legacy fields');
  assert.equal(await run('localStorage.getItem(tradeDraftKey())'),null);
  await run(`await editTrade(_cache[0].id);setField('j-exec-entry','');await saveTrade();`);
  assert.equal(await run('_cache[0].executionScore'),null,'Cleared modern assessment must not keep its previous score');
  assert.equal(await run('_cache[0].rulebased'),'','Incomplete check must not claim rule compliance');
  // Standard risk: new trades start with the risk; fees are no longer tracked, the P&L is stored as entered.
  await run(`_cache=[];_settingsCache={defaultRisk:200,feePerContract:1.5};clearForm();`);
  assert.equal(await run('Journal.value("j-risk")'),'200','Standard risk prefills a new trade');
  assert.equal(await run('document.getElementById("f-fees")'),null,'No fee field in the wizard');
  await run(`setField('f-contracts','3');setField('f-pnl','100');form.result='Win';setField('j-exec-entry','Yes');setField('j-exec-risk','Yes');setField('j-exec-exit','Yes');await saveTrade();`);
  assert.deepEqual(await run('(()=>{const s=JSON.parse(JSON.stringify(_cache[0]));return [s.pnl,"fees" in s,"grossPnl" in s]})()'),[100,false,false],'P&L is saved as entered');
  assert.equal(await run('Journal.realizedR(_cache[0])'),100/200);
  await run(`_cache[0]={..._cache[0],pnl:95.5,grossPnl:100,fees:4.5};await editTrade(_cache[0].id);`);
  assert.equal(await run('Journal.value("f-pnl")'),'95.5','Editing an old trade with fees shows the net P&L');
  await run('await saveTrade();');
  assert.deepEqual(await run('(()=>{const s=JSON.parse(JSON.stringify(_cache[0]));return [s.pnl,"fees" in s,"grossPnl" in s]})()'),[95.5,false,false],'Saving drops the old fee breakdown');
  await run(`_cache=[];setMode('quick');qResetForm();`);
  assert.equal(await run('Journal.value("q-risk")'),'200','Standard risk prefills quick capture');
  await run(`qChoice('q-result',document.querySelector('#quick-form .opt[data-v="Loss"]'));setField('q-contracts','2');await saveQuickTrade();`);
  assert.deepEqual(await run('[_cache[0].pnl,"fees" in _cache[0],_cache[0].contracts]'),[-200,false,'2']);
  // 15s timeframe and London targets are selectable tags.
  await run(`setMode('trade');clearForm();toggleTf(document.querySelector('.tf-main[data-concept="IFVG"]'),'IFVG');[...document.querySelectorAll('#tf-IFVG .tf-chip')].find(b=>b.textContent==='15s').click();[...document.querySelectorAll('#setup-tags .tag')].find(b=>b.textContent==='London Session High').click();`);
  assert.deepEqual(await run('getSetup().sort()'),['IFVG 15s','London Session High'].sort());
  await run(`_settingsCache={};qResetForm();setMode('trade');clearForm();`);
  assert.equal(await run('Journal.value("j-risk")'),'','Without a standard risk the field stays empty');
  // Round-trip a historical record with old aliases, unsupported tags and unknown fields.
  await run(`window.old={id:123,date:'2026-08-18',instrument:'MNQ',direction:'Short',result:'Loss',pnl:-50,grade:'A',matchesPlaybook:'No',rulebased:'partial',toPlan:'Yes',deviated:'No',confirmationPresent:'Yes',chased:'Yes',patience:'No',execQuality:4,executionScore:57,biasWhy:'Original bias',expectations:'Original plan',biggestFactor:'Factor',why:'Older distinct explanation',lesson:'Current lesson',better:'Older distinct adjustment',setup:['Custom old tag','IFVG 1m'],emotion:'Unknown legacy emotion',screenshot:'',customData:{keep:true}};_cache=[structuredClone(old)];await editTrade(123);await saveTrade();`);
  const differences=await run(`Object.keys(old).filter(k=>JSON.stringify(old[k])!==JSON.stringify(_cache[0][k]))`);
  assert.deepEqual(differences,[],'Historical fields changed: '+differences);
  await run('await openDetail(123)');
  const oldDetail=await run('document.getElementById("detail-el").textContent');
  assert.ok(oldDetail.includes('Original plan')&&oldDetail.includes('Unknown legacy emotion')&&oldDetail.includes('Factor')&&oldDetail.includes('Current lesson'),'Historical values remain visible in the detail view');
  await run('closeDetail()');
  if(process.env.TRADE_FIXTURE){
    const originals=JSON.parse(fs.readFileSync(process.env.TRADE_FIXTURE,'utf8')).filter(t=>!t.isNoTrade).map(t=>({...t,screenshot:''}));
    await run('window.legacyFixtures='+JSON.stringify(originals));
    const r=await run(`return await (async()=>{const failures=[];for(const original of legacyFixtures){_cache=[structuredClone(original)];await editTrade(original.id);await saveTrade();for(const key of Object.keys(original)){if(JSON.stringify(original[key])!==JSON.stringify(_cache[0][key]))failures.push(key);}}return failures;})()`);
    assert.deepEqual(r,[],'Export round-trip changed historical fields');
    console.log('PASS: '+originals.length+' historical export records round-trip without changing original fields.');
  }
  await run(`clearForm();setField('f-lesson','Wenn <script>, dann Plan prüfen.');setField('j-focus','early');testFail=true;await Journal.toLearn();`);
  assert.equal(await run('loadLearn().length'),0);
  await run('testFail=false;await Journal.toLearn();Journal.renderRules();setField("j-rule-check","Yes");form.result="Breakeven";await saveTrade();await Journal.learnProgress();');
  assert.equal(await run('loadLearn().length'),1);
  assert.equal(await run('document.getElementById("j-plan-rule").hidden'),false,'The current weekly rule is visible without a disclosure');
  assert.equal(await run('_cache[0].executionScore'),null,'Missing execution must not become zero');
  assert.ok((await run('document.getElementById("j-learn-progress").textContent')).includes('1/1'));
  await run(`clearForm();setField('f-lesson','Next time: If I feel rushed, then I wait.');document.getElementById('j-save-rule').checked=true;form.result='Breakeven';await saveTrade();`);
  assert.equal(await run('loadLearn().length'),2,'The checkbox saves the lesson as a weekly rule with the trade');
  // Quick capture: risk and take profit are plain amounts; the result sets the
  // sign. A negative or comma-typed figure must not be rejected as "> 0".
  await run(`_cache=[];clearForm();setMode('quick');qChoice('q-result',document.querySelector('#quick-form .seg[data-field="q-result"] .opt[data-v="Loss"]'));setField('q-risk','-240');setField('q-tp','480');await saveQuickTrade();`);
  assert.equal(await run('_cache.length'),1,'Quick capture stores a trade');
  assert.equal(await run('_cache[0].result'),'Loss');
  assert.equal(await run('_cache[0].pnl'),-240,'A loss books minus the risk amount');
  assert.equal(await run('_cache[0].quickCapture'),true,'Quick capture is marked');
  assert.equal(await run('_cache[0].journal.initialRisk'),240,'Risk is stored as a positive amount whatever sign was typed');
  assert.equal(await run('Journal.realizedR(_cache[0])'),-1,'A stopped-out quick trade is -1R');
  assert.equal(await run('currentMode'),'trade','Saving a quick trade returns to the full journal');
  assert.equal(await run('document.getElementById("quick-form").style.display'),'none','Quick form hides after save');
  await run('await saveQuickTrade();');
  assert.equal(await run('_cache.length'),1,'A quick save without a result is rejected');
  // A win books the take profit; comma decimals parse; realized R is TP over risk.
  await run(`setMode('quick');qChoice('q-result',document.querySelector('#quick-form .seg[data-field="q-result"] .opt[data-v="Win"]'));setField('q-risk','200,00');setField('q-tp','500');await saveQuickTrade();`);
  assert.equal(await run('_cache.length'),2,'The win is stored alongside the loss');
  assert.equal(await run('_cache[0].pnl'),500,'A win books the take profit amount');
  assert.equal(await run('_cache[0].journal.initialRisk'),200,'Comma-typed risk parses to a plain number');
  await run(`await editTrade(_cache[0].id);setField('j-exec-entry','Yes');setField('j-exec-risk','Yes');setField('j-exec-exit','Yes');setField('j-context','Yes');setField('j-trigger','Yes');setField('j-conditions','Yes');setField('j-extras','all');await saveTrade();`);
  assert.equal(await run('_cache[0].executionScore'),100,'A quick trade can be enriched in the full wizard');
  assert.equal(await run('_cache[0].pnl'),500,'Enriching keeps the quick P&L');
  assert.equal(await run('Journal.realizedR(_cache[0])'),2.5,'Enriching keeps R from the quick risk');
  // Quick capture keeps its screenshot: Ctrl+V while the quick form is on screen
  // routes into it, and the image is stored on the saved trade.
  assert.ok(await run('!!document.querySelector("#quick-form #q-shot")'),'The quick form keeps its screenshot drop zone');
  await run(`setMode('quick');(function(){const ev=new Event('paste');ev.clipboardData={items:[{type:'image/png',getAsFile:()=>new File([new Uint8Array([137,80,78,71])],'s.png',{type:'image/png'})}]};document.dispatchEvent(ev);})();await new Promise(r=>setTimeout(r,60));`);
  assert.equal(await run('document.getElementById("q-img-prev").style.display'),'block','Ctrl+V routes the screenshot into the visible quick form');
  await run(`qClearShot();qChoice('q-result',document.querySelector('#quick-form .seg[data-field="q-result"] .opt[data-v="Breakeven"]'));qSetShot('data:image/png;base64,iVBORw0KGgo=');await saveQuickTrade();`);
  assert.equal(await run('_cache[0].screenshot'),'data:image/png;base64,iVBORw0KGgo=','A quick screenshot is stored on the trade');
  assert.equal(await run('document.getElementById("q-img-prev").style.display'),'none','Saving resets the quick screenshot preview');
  // Format helpers: USD only, sign always, cents only when present; dates dd.mm.yyyy.
  assert.equal(await run('fmtUSD(1250)'),'+$1250');
  assert.equal(await run('fmtUSD(-500)'),'-$500');
  assert.equal(await run('fmtUSD(697.98)'),'+$697.98');
  assert.equal(await run('fmtUSD(0)'),'$0');
  assert.equal(await run('fmtUSD(null)'),'–','Missing P&L is never shown as 0');
  assert.equal(await run('fmtR(-1)'),'-1R');
  assert.equal(await run('fmtR(2.5)'),'+2.5R');
  assert.equal(await run('fmtDate("2026-09-05")'),'05.09.2026');
  assert.equal(await run('hasPnl({pnl:""})'),false);
  assert.equal(await run('pnlOf({pnl:null})'),null,'Missing P&L is null, not 0');
  assert.equal(await run('weekInfo("2026-09-02").key'),'2026-W36');
  assert.equal(await run('weekInfo("2026-09-02").start'),'2026-08-31');
  assert.equal(await run('maxDrawdown([{pnl:-300},{pnl:200},{pnl:-500},{pnl:400}])'),600,'Drawdown is measured chronologically (list is newest first): +400 peak, then -500/+200/-300 to -200');
  // Review > Trade lessons: every takeaway written on a trade shows up, newest first, grouped by week.
  await run(`_cache=[{id:11,date:'2026-09-02',instrument:'MNQ',direction:'Long',result:'Loss',lesson:'Wait for the confirmed close.'},{id:12,date:'2026-09-05',instrument:'MES',direction:'Short',result:'Win',better:'Repeat the A+ sequence.'},{id:13,date:'2026-09-04',isNoTrade:true,instrument:'MNQ',lesson:'No setup is a position.'},{id:14,date:'2026-09-01',result:'Win'},{id:15,date:'2026-08-20',instrument:'MNQ',direction:'Long',result:'Loss',lesson:'Wait for the confirmed close.'}];await renderLessons();`);
  assert.equal(await run('document.querySelectorAll("#lessons-el .lesson-item").length'),4,'Only entries with a lesson are listed');
  assert.ok((await run('document.getElementById("lessons-el").textContent')).indexOf('Repeat the A+ sequence.')<(await run('document.getElementById("lessons-el").textContent')).indexOf('No setup is a position.'),'Newest lesson comes first');
  assert.ok((await run('document.getElementById("lessons-desc").textContent')).includes('4 lessons'));
  assert.equal(await run('document.querySelectorAll("#lessons-el .lesson-group").length'),2,'Lessons are grouped by calendar week');
  assert.ok((await run('document.querySelector("#lessons-el .lesson-group-head").textContent')).includes('Week 36'),'Newest week group comes first');
  assert.equal(await run('document.querySelectorAll("#lessons-el .lesson-flag").length'),3,'Repeated lesson is flagged on both occurrences, no-trade day is flagged once');
  // Each card is the lesson itself, not a trade card: no instrument/direction/result badge.
  assert.ok(!(await run('document.getElementById("lessons-el").textContent')).includes('MES'),'No instrument badge on a lesson card');
  assert.equal(await run('document.querySelectorAll("#lessons-el .instr, #lessons-el .badge").length'),0,'No trade badges on lesson cards');
  assert.ok((await run('document.getElementById("lessons-el").textContent')).includes('05.09.2026'),'The date is shown as dd.mm.yyyy');
  await run('setLessonGroup("month")');
  assert.equal(await run('document.querySelectorAll("#lessons-el .lesson-group").length'),2,'Grouping by month works');
  await run('setLessonGroup("week")');
  // Weekly review: automatic summary, answers, saved review + weekly rule in the playbook.
  await run(`_learnCache=[];reviewWeekStart='2026-08-31';await renderWeekly();`);
  assert.ok((await run('document.getElementById("weekly-el").textContent')).includes('Week 36'));
  assert.ok((await run('document.getElementById("weekly-el").textContent')).includes('Wait for the confirmed close.'),'Lessons of the week are listed');
  assert.equal(await run('weekSummary(_cache,weekInfo("2026-09-02")).trades'),3);
  assert.equal(await run('weekSummary(_cache,weekInfo("2026-09-02")).net'),null,'No P&L logged means no net figure, not 0');
  assert.equal(await run('weekSummary(_cache,weekInfo("2026-09-02")).nt'),1);
  await run(`setField('rv-good','Waited for the close.');setField('rv-rule','If the 1m close is missing, then no order.');await saveWeeklyReview();`);
  assert.equal(await run('loadReviews().length'),1,'Review is stored');
  assert.equal(await run('loadPlaybook().filter(e=>e.kind==="behavior-rule").length'),1,'The weekly rule lands in the playbook');
  assert.equal(await run('loadPlaybook().length'),1,'Reviews are not listed as playbook entries');
  await run(`setField('rv-rule','If the 1m close is missing, then wait.');await saveWeeklyReview();`);
  assert.equal(await run('loadReviews().length'),1,'Editing keeps one review per week');
  assert.equal(await run('loadPlaybook().filter(e=>e.kind==="behavior-rule").length'),1,'Editing updates the linked rule instead of adding one');
  assert.equal(await run('loadPlaybook().find(e=>e.kind==="behavior-rule").rule'),'If the 1m close is missing, then wait.');
  await run('await addLessonToReview(15);');
  assert.deepEqual(await run('loadReviews()[0].lessonIds'),[15],'An older lesson can be added to the review');
  await run('renderPrevious()');
  assert.ok((await run('document.getElementById("previous-el").textContent')).includes('Week 36'),'Previous reviews list the saved week');
  // Weekly recap: scenes come from real data only, images pause until a click, overlay is removed on close.
  await run(`_cache=[{id:41,date:'2026-09-01',instrument:'MNQ',direction:'Long',result:'Win',pnl:600,rulebased:'yes',setup:['OB','CISD'],emotion:'😶 Neutral',lesson:'Wait for the close.',screenshot:'data:image/png;base64,iVBORw0KGgo='},{id:42,date:'2026-09-02',instrument:'MNQ',direction:'Short',result:'Loss',rulebased:'no',setup:['OB'],emotion:'😶 Neutral',lesson:'No chasing.'},{id:43,date:'2026-09-03',isNoTrade:true,lesson:'Sat out.'},{id:44,date:'2026-08-25',result:'Win'}];`);
  assert.equal(await run('recapSubject("2026-08-31","2026-09-06",_cache).lead'),'This week');
  assert.equal(await run('recapSubject("2026-08-31","2026-09-13",_cache).lead'),'In these 2 weeks');
  assert.equal(await run('recapSubject("2026-08-25","2026-09-03",_cache).lead'),'Across all your trades');
  // Counting numbers start at 0 in the markup and animate to data-count; strip them before checking the prose.
  const scenes=await run('JSON.stringify(buildRecapScenes(_cache,"2026-08-31","2026-09-06","").map(s=>({hold:s.hold,cls:s.cls,html:s.html,text:s.html.replace(/<[^>]*data-count[^>]*>[^<]*<\\/[^>]+>/g," ").replace(/<[^>]+>/g," ")})))');
  const sc=JSON.parse(scenes);
  assert.ok(sc[1].text.includes('This week') && sc[1].html.includes('data-count="2"') && sc[1].text.includes('trades taken'),'Trade count scene counts up to the real number');
  assert.ok(sc.some(s=>s.html.includes('data-count="600"') && s.html.includes('data-fmt="usd"') && s.text.includes('1 without P&L not counted')),'Net P&L counts only trades with P&L and says so');
  assert.ok(!sc.some(s=>s.text.includes('$0')),'No fake zero anywhere in the recap');
  assert.ok(sc.some(s=>s.html.includes('rc-bar') && s.html.includes('data-w="50%"')),'Discipline bars grow to the real share');
  assert.equal(sc.filter(s=>s.hold&&s.cls==='rc-img-scene').length,1,'Image scenes wait for a click');
  assert.ok(sc.find(s=>s.cls==='rc-img-scene').text.includes('Click to continue'),'First image scene says click to continue');
  assert.ok(sc.some(s=>s.text.includes('No chasing.')),'Lessons of trades without a screenshot are still told');
  assert.ok(!sc.some(s=>s.text.includes('Most frequent setups')||s.text.includes('Most logged feeling')),'No aggregate setup or feeling scenes');
  assert.ok(sc.find(s=>s.cls==='rc-img-scene').text.includes('OB, CISD') && sc.find(s=>s.cls==='rc-img-scene').text.includes('Psychology') && sc.find(s=>s.cls==='rc-img-scene').text.includes('Neutral'),'Setup and psychology are shown on the trade itself');
  assert.ok(sc.some(s=>s.text.includes('Sat out.')),'No-trade day lessons are told');
  assert.equal(sc[sc.length-1].cls,'rc-end','Ends with the replay scene');
  const empty=JSON.parse(await run('JSON.stringify(buildRecapScenes(_cache,"2020-01-01","2020-01-07","").map(s=>s.html.replace(/<[^>]+>/g," ")))'));
  assert.ok(empty[1].includes('Nothing logged'),'An empty period is stated, not invented');
  await run(`reviewWeekStart='2026-08-31';await renderWeekly();await startRecap();`);
  assert.ok(await run('!!document.getElementById("recap")'),'Recap overlay is created');
  assert.equal(await run('document.querySelectorAll("#recap .rc-seg").length'),JSON.parse(scenes).length,'One progress segment per scene');
  await run('recapShow(_recap.scenes.findIndex(s=>s.hold))');
  await sleep(500);
  assert.equal(await run('_recap.timer'),null,'No auto-advance while an image is shown');
  assert.equal(await run('document.querySelectorAll("#recap .rc-scene").length'),1,'Old scene is removed before the new one appears');
  await run('document.querySelector("#recap .rc-shot").click()');
  assert.equal(await run('document.getElementById("img-lightbox").classList.contains("open")'),true,'Clicking the screenshot opens it in full');
  assert.equal(await run('_recap.i'),await run('_recap.scenes.findIndex(s=>s.hold)'),'Opening the image does not advance the story');
  await run('closeLightbox()');
  assert.equal(await run('document.getElementById("recap").classList.contains("rc-show-bg")'),true,'Candlestick background stays on');
  await run('recapShow(1)'); await sleep(1900);
  assert.equal(await run('document.querySelector("#recap [data-count]").textContent'),'2','Counter reaches the real value');
  await run('recapClose()');
  assert.equal(await run('!!document.getElementById("recap")'),false,'Recap is removed from the DOM on close');
  assert.equal(await run('_recap'),null,'Recap data is discarded');
  // Playbook: categories, editing, old entries without a category stay readable.
  await run(`_learnCache=[{id:1,date:'2026-08-01',title:'Old note',body:'Legacy body',img:''},{id:2,date:'2026-08-02',kind:'behavior-rule',title:'Old rule',rule:'Old rule text',body:'Old rule text'}];renderLearnList();`);
  assert.equal(await run('document.querySelectorAll("#learn-entries .learn-item").length'),2);
  assert.equal(await run('entryCategory(_learnCache[1])'),'rule','behavior-rule entries count as rules');
  await run('setPlaybookFilter("rule")');
  assert.equal(await run('document.querySelectorAll("#learn-entries .learn-item").length'),1,'Category filter works');
  await run('setPlaybookFilter("all");editLearnEntry(1);setField("ln-title","Old note edited");setLearnCat("concept");await saveLearnEntry();');
  assert.equal(await run('_learnCache.find(e=>e.id===1).title'),'Old note edited','Playbook entries can be edited');
  assert.equal(await run('_learnCache.find(e=>e.id===1).category'),'concept');
  assert.equal(await run('_learnCache.find(e=>e.id===1).body'),'Legacy body','Editing keeps the existing body');
  await run('clearLearnForm();await lessonToPlaybook(41);');
  assert.equal(await run('Journal.value("ln-body").startsWith("Wait for the close.")'),true,'A lesson prefills a playbook entry');
  await run('clearLearnForm();');
  // All trades: collapsible filters, no 0 for missing P&L, cards are buttons.
  await run(`_cache=[{id:21,date:'2026-09-02',instrument:'MNQ',direction:'Long',result:'Loss',pnl:-500,emotion:'😓 FOMO',journal:{mode:'Live',initialRisk:250}},{id:22,date:'2026-08-05',instrument:'MES',direction:'Short',result:'Win',emotion:'😌 Calm'},{id:23,date:'2026-09-03',isNoTrade:true,instrument:'Both',emotion:'Relieved'}];clearListFilters();await renderList();`);
  assert.equal(await run('document.querySelectorAll("#trades-el .trade-item[role=button]").length'),3,'Trade cards are buttons');
  assert.ok((await run('document.getElementById("trades-el").textContent')).includes('-$500'),'P&L shows as USD with sign');
  assert.ok((await run('document.getElementById("trades-el").textContent')).includes('-2R'),'R is shown next to the P&L');
  assert.ok((await run('document.getElementById("trades-el").textContent')).includes('no P&L'),'A missing P&L is labelled, not shown as 0');
  assert.ok(!(await run('document.getElementById("trades-el").textContent')).includes('$0'),'No fake zero');
  await run('setField("lf-instrument","MES");onListFilterChange();');
  assert.equal(await run('document.querySelectorAll("#trades-el .trade-item").length'),2,'Instrument filter keeps MES and the no-trade day watching both');
  await run('setField("lf-instrument","");setField("lf-mode","Live");onListFilterChange();');
  assert.equal(await run('document.querySelectorAll("#trades-el .trade-item").length'),1,'Environment filter');
  await run('setField("lf-mode","");setField("lf-emotion","Calm");onListFilterChange();');
  assert.equal(await run('document.querySelectorAll("#trades-el .trade-item").length'),1,'Emotion filter matches the stored value without its emoji');
  await run('setField("lf-emotion","");setField("lf-on","2026-09-02");onListFilterChange();');
  assert.equal(await run('document.querySelectorAll("#trades-el .trade-item").length'),1,'Single-day date filter');
  assert.equal(await run('document.getElementById("list-filter-count").textContent'),'1','Active filter count');
  await run('clearListFilters();');
  assert.equal(await run('document.querySelectorAll("#trades-el .trade-item").length'),3);
  // Stats: new KPIs, honest small-sample labels, USD formatting.
  await run(`statsRange=0;_cache=[{id:31,date:'2026-09-02',result:'Win',rulebased:'yes',pnl:600,journal:{initialRisk:200}},{id:32,date:'2026-09-01',result:'Loss',rulebased:'no',pnl:-200,journal:{initialRisk:200}},{id:33,date:'2026-08-30',result:'Win',rulebased:'yes'}];await renderStats();`);
  const statsText=await run('document.getElementById("stats-el").textContent');
  assert.ok(statsText.includes('Profit factor'),'Profit factor KPI');
  assert.ok(statsText.includes('3.00'),'Profit factor = 600/200');
  assert.ok(statsText.includes('Max drawdown'),'Max drawdown KPI');
  assert.ok(!statsText.includes('Average R')&&!statsText.includes('Total R'),'R cards stay hidden below 10 trades with risk');
  assert.ok(statsText.includes('R stats from 10 trades with risk')&&statsText.includes('2/10 so far'),'R hint shows the coverage');
  assert.ok(statsText.includes('Expectancy'),'Expectancy KPI');
  assert.ok(statsText.includes('+$200'),'Expectancy = 400 / 2 trades with P&L');
  assert.ok(statsText.includes('payoff 3.00'),'Payoff = avg win 600 / avg loss 200');
  assert.ok(statsText.includes('very limited data'),'Small samples are labelled');
  assert.ok(await run('!!document.querySelector(".st-wr .donut-svg")'),'Win rate keeps its donut');
  assert.equal(await run('[...document.querySelectorAll(".st-wr .wr-row b")].map(b=>b.textContent).join()'),'2,1,0','Donut legend carries the counts');
  assert.ok(!/Streak|Trades taken|Rule check logged|Total trades/.test(statsText),'Duplicate cards are gone');
  assert.ok((await run('document.querySelector(".disc-strip").textContent')).includes('3/3 rated'),'Rated count sits under the score');
  assert.equal(await run('document.querySelector(".st-pnl .hero-num").style.color'),'var(--muted)','Thin samples are grey');
  assert.ok(statsText.includes('without P&L not counted'),'Trades without P&L are excluded, not zeroed');
  assert.ok(!statsText.includes('$0'),'No fake zero');
  await run(`_cache=Array.from({length:10},(_,i)=>({id:60+i,date:'2026-09-0'+(i%9+1),result:i%2?'Loss':'Win',rulebased:'yes',pnl:i%2?-100:200,journal:{initialRisk:100}}));await renderStats();`);
  const rText=await run('document.getElementById("stats-el").textContent');
  assert.ok(rText.includes('Average R')&&rText.includes('+0.5R')&&rText.includes('Total R')&&rText.includes('+5R'),'R cards appear from 10 trades with risk');
  assert.ok(!rText.includes('very limited data'),'No sample note from 10 trades');
  await run(`statsRange=30;_cache=[{id:1,date:new Date().toISOString().slice(0,10),result:'Loss',rulebased:'yes',pnl:-10},{id:2,date:'2020-01-01',result:'Win',rulebased:'no',pnl:30}];await renderReview();`);
  assert.ok((await run('document.getElementById("stats-sub").textContent')).includes('1 Trade'));
  await run('await renderStats();');
  assert.ok(!(await run('document.getElementById("stats-el").textContent')).includes('Emotional control'));
  assert.equal(await run('disciplineStreak([{date:"2020-01-01",rulebased:"yes"}]).count'),1,'Waiting must not reset discipline');
  await run(`statsRange=0;_cache=[{id:3,date:'2020-01-06',result:'Win',rulebased:'yes',pnl:50}];await renderStats();`);
  const idleStrip=await run('document.querySelector(".disc-strip").textContent');
  assert.ok(idleStrip.includes('0.0')&&idleStrip.includes('without a journal entry'),'Idle journaling drags the cockpit score down and says why');
  await run('setField("stats-mode","Replay");await renderReview();');
  assert.ok((await run('document.getElementById("stats-sub").textContent')).includes('0 Trades'));
  await run('setField("stats-mode","");');
  // Faith: no copies of the Stats cockpit, a reading of the last entry, faithful moments.
  await run(`_cache=[{id:41,date:'2026-09-03',result:'Loss',rulebased:'yes',instrument:'MNQ',direction:'Long',mindset:'Waited for the <b>retest</b>.',lesson:'Stop was fine.'},{id:42,date:'2026-09-02',isNoTrade:true,result:'No Trade',noTradeReasons:['No setup']},{id:43,date:'2026-09-01',result:'Win',rulebased:'no',instrument:'MES',direction:'Short'}];switchTab('faith',true);await renderFaith();`);
  const faithText=await run('document.getElementById("faith-el").textContent');
  assert.ok(!/win rate|Discipline Streak|This week/i.test(faithText),'Faith does not repeat Stats numbers');
  assert.ok(faithText.includes('That is faithfulness, not failure'),'Rule-based loss is read as faithfulness');
  assert.ok(faithText.includes('Waited for the <b>retest</b>.'),'Own words are shown escaped');
  assert.ok(faithText.includes('Kept your rules through a loss')&&faithText.includes('Stayed out'),'Faithful moments list');
  assert.ok(!faithText.includes('MES Short'),'A deviated win is not a faithful moment');
  assert.equal(await run('document.querySelector("#verse-picker .vchip.active").dataset.cat'),'loss');
  await run("pickVerseCat('win')");
  assert.equal(await run('document.getElementById("faith-verse-title").textContent'),'After a win','Picker updates its own card title');
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await sleep(600);
  const faithShots=path.join(os.tmpdir(),'tif-journal-qa');fs.mkdirSync(faithShots,{recursive:true});
  fs.writeFileSync(path.join(faithShots,'faith-desktop.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:1280,height:await run('document.querySelector(".main").scrollHeight+40'),scale:1}})).data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(300);
  assert.ok(await run('document.documentElement.scrollWidth<=window.innerWidth'),'Faith overflows on mobile');
  fs.writeFileSync(path.join(faithShots,'faith-mobile.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:390,height:await run('document.querySelector(".main").scrollHeight+40'),scale:1}})).data,'base64'));
  // Stats cockpit for visual inspection: 12 trades, 3 with risk, one no-trade day.
  await run(`statsRange=0;_cache=Array.from({length:12},(_,i)=>({id:80+i,date:'2026-09-'+String(i+1).padStart(2,'0'),instrument:'MNQ',direction:'Long',result:i%3===2?'Breakeven':i%2?'Loss':'Win',rulebased:i%4?'yes':'no',toPlan:i%4?'Yes':'No',pnl:i%3===2?0:i%2?-150:240,journal:i<3?{initialRisk:150}:undefined})).concat([{id:99,date:'2026-09-14',isNoTrade:true}]);switchTab('stats');await renderStats();`);
  await sleep(500);
  for(const [w,h,name] of [[1280,1000,'stats-desktop.png'],[390,844,'stats-mobile.png']]){
    await call('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:w<500});
    await sleep(400);
    fs.writeFileSync(path.join(faithShots,name),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:w,height:Math.min(2600,await run('document.querySelector(".main").scrollHeight+40')),scale:1}})).data,'base64'));
  }
  assert.equal(await run(`[...document.querySelectorAll("#stats-el .gcard")].every(c=>c.getBoundingClientRect().right<=390)`),true,"Stats cards fit on mobile");
  await run('applyTheme("dark")');
  await sleep(200);
  fs.writeFileSync(path.join(faithShots,'faith-mobile-dark.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:390,height:await run('document.querySelector(".main").scrollHeight+40'),scale:1}})).data,'base64'));
  await run('applyTheme("light")');
  // Screenshot an empty, usable form at desktop and mobile widths.
  await sleep(400);
  await run(`clearForm();hydrateIcons();buildDock();switchTab('log',true);goStep(1);`);
  assert.equal(await run('document.querySelectorAll("#dock .dock-item[data-tab]").length'),6);
  assert.ok((await run('document.getElementById("dock").textContent')).includes('Playbook'),'Learn is renamed to Playbook');
  assert.ok((await run('document.getElementById("dock").textContent')).includes('Review'),'Lessons is replaced by Review');
  // Section switch: exactly one section visible at any time, no overlap.
  await run("switchTab('playbook')");
  assert.equal(await run('document.querySelectorAll(".section.active").length'),1,'Only one section is active after a switch');
  assert.equal(await run('document.querySelector(".section.active").id'),'sec-playbook');
  await run("switchTab('review')");
  assert.equal(await run('document.querySelectorAll(".section.active").length'),1);
  assert.equal(await run('document.querySelectorAll(".section.sec-out").length'),0,'No ghosting class is left behind');
  await run("switchTab('log',true)");
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
  console.log('PASS: draft/plan snapshots, failed/successful trade and Playbook saves, legacy round-trip, rules, weekly review, lessons, list filters, metrics, formatting, mobile layout.');
  console.log('Screenshots: '+artifacts);
 } finally {socket?.close();browser.kill();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
