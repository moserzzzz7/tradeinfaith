/* Small, explicit journal decisions. Historical records are never migrated in place. */
'use strict';
const Journal = (() => {
  const criteria = [
    ['context', 'HTF context, target and counter-argument are clear'],
    ['trigger', 'Required confirmation from my model was present at entry'],
    ['conditions', 'Entry zone, risk, time window and news rules were met']
  ];
  const focus = {
    repeat: ['Executed cleanly', 'When my full trigger is there, I repeat the planned sequence.'],
    chase: ['Chased the entry', 'Once price has left my entry zone, I skip the entry.'],
    early: ['Entered too early', 'As long as my required confirmation is missing, I send no order.'],
    risk: ['Changed the risk', 'Before the order I check stop and position size against my risk limit.'],
    exit: ['Unplanned exit / breakeven', 'Before I move the exit, I check the exit reason I set beforehand.'],
    pressure: ['Funded / payout pressure', 'When my account target drives the decision, I pause and re-read the original plan.'],
    context: ['Missed HTF / ES', 'Before the order I check the HTF and correlation levels my model requires.'],
    other: ['Other observation', '']
  };
  const pressures = {
    none: 'No noticeable pressure', fomo: 'FOMO / missed something', funded: 'Funded / payout',
    fear: 'Fear of losing', revenge: 'Making a loss back', other: 'Other influence'
  };
  const ruleChecks = {Yes: 'Yes', No: 'No', NA: 'Not applicable'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = value => value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
  const value = id => document.getElementById(id)?.value.trim() || '';
  function grade(checks, extras) {
    const values = criteria.map(([key]) => checks?.[key]);
    if (values.includes('No')) return 'Invalid';
    if (!values.every(v => v === 'Yes')) return '';
    return {all:'A+',some:'A',limited:'B'}[extras] || '';
  }
  function execution(checks) {
    const keys = ['entry','risk','exit'];
    if (!keys.every(key => ['Yes','Partial','No'].includes(checks?.[key]))) return null;
    return Math.round(keys.reduce((sum,key) => sum + ({entry:40,risk:40,exit:20}[key]) * ({Yes:1,Partial:0.5,No:0}[checks[key]]), 0));
  }
  function scoreFor(j) {
    if (j?.execution?.entry==='Yes' && (grade(j.criteria,j.extras)==='Invalid' || ['chase','early'].includes(j.focus))) return null;
    return execution(j?.execution);
  }
  function discipline(trades) {
    const measured = trades.filter(t => !t.isNoTrade && ['yes','partial','no'].includes(t.rulebased));
    return measured.length ? Math.round(measured.reduce((sum,t) => sum + ({yes:100,partial:50,no:0}[t.rulebased]),0) / measured.length) : null;
  }
  function realizedR(t) {
    const pnl = num(t.pnl), risk = num(t.journal?.planSnapshot?.initialRisk) ?? num(t.journal?.initialRisk);
    return pnl !== null && risk > 0 ? pnl/risk : null;
  }
  function issues(t) {
    const out = [];
    if (t.journal?.execution?.entry==='Yes' && scoreFor(t.journal)===null && execution(t.journal.execution)!==null) out.push('Entry marked as rule-based although a required criterion is missing or an entry mistake is selected.');
    if (t.rulebased === 'yes' && (t.toPlan === 'No' || t.deviated === 'Yes' || t.matchesPlaybook === 'No')) out.push('Rule adherence contradicts the plan or the playbook.');
    if (t.toPlan === 'Yes' && t.deviated === 'Yes') out.push('Followed the plan and deviated from the plan are both selected.');
    if (t.matchesPlaybook === 'No' && ['A+','A','B'].includes(t.grade)) out.push('A quality grade is set although the playbook is not met.');
    if (t.confirmationPresent === 'No' && t.execQuality >= 4) out.push('High execution rating despite a missing confirmation.');
    const pnl = num(t.pnl);
    if (pnl !== null && ((t.result === 'Win' && pnl < 0) || (t.result === 'Loss' && pnl > 0))) out.push('Result and P&L sign contradict each other.');
    return out;
  }
  function checks(prefix, keys) { return Object.fromEntries(keys.map(key => [key,value(prefix+key)])); }
  function current() {
    return {
      version:1, model:value('j-model'), mode:value('j-mode'),
      criteria:checks('j-',criteria.map(([key])=>key)), extras:value('j-extras'),
      invalidation:value('j-invalidation'), management:value('j-management'),
      initialRisk:num(value('j-risk')), setupReason:value('j-grade-reason'),
      execution:checks('j-exec-',['entry','risk','exit']),
      pressure:value('j-pressure'), trigger:value('j-psych-trigger'), action:value('j-action'),
      focus:value('j-focus'), ruleId:value('j-rule-id'), ruleCheck:value('j-rule-check'),
      planSnapshot:form.journalPlanSnapshot || null
    };
  }
  function patch() {
    const journal = current(), assessedGrade = grade(journal.criteria,journal.extras);
    const result = {journal};
    journal.setupAssessed=Boolean(form.journalSetupAssessed || Object.values(journal.criteria).some(Boolean) || journal.extras);
    journal.executionAssessed=Boolean(form.journalExecutionAssessed || Object.values(journal.execution).some(Boolean));
    if (journal.setupAssessed) {
      result.grade = assessedGrade;
      result.matchesPlaybook = assessedGrade === 'Invalid' ? 'No':assessedGrade?'Yes':'';
      result.confirmationPresent=journal.criteria.trigger;
    }
    if (['Yes','No'].includes(journal.criteria.trigger)) result.confirmationPresent = journal.criteria.trigger;
    const score = scoreFor(journal);
    if (journal.executionAssessed) Object.assign(result,{executionScore:null,executionScoreVersion:2,rulebased:'',toPlan:'',deviated:'',execQuality:null});
    if (execution(journal.execution)!==null && score===null) {
      result.executionScore=null;
      result.executionScoreVersion=2;
      result.rulebased='';
    }
    if (score !== null) {
      result.executionScore = score;
      result.executionScoreVersion = 2;
      const states = Object.values(journal.execution);
      result.rulebased = states.every(v=>v==='Yes') ? 'yes':states.includes('No') ? 'no':'partial';
      // Missing a mandatory setup condition is itself a rule violation.
      if (assessedGrade === 'Invalid') result.rulebased = 'no';
      else if (!assessedGrade) result.rulebased = states.includes('No') ? 'no' : '';
      result.toPlan = states.every(v=>v==='Yes') ? 'Yes':states.includes('No') ? 'No':'Partial';
      result.deviated = states.every(v=>v==='Yes') ? 'No':'Yes';
      result.execQuality = null; // A computed score must not masquerade as a self-rating.
    }
    if (assessedGrade === 'Invalid') result.rulebased='no';
    return result;
  }
  function restoreFields(t) {
    const j = t.journal || {};
    const fields = {'j-model':j.model,'j-mode':j.mode,'j-extras':j.extras,'j-invalidation':j.invalidation,
      'j-management':j.management,'j-risk':j.initialRisk,'j-grade-reason':j.setupReason,
      'j-pressure':j.pressure,'j-psych-trigger':j.trigger,'j-action':j.action,'j-focus':j.focus,
      'j-rule-id':j.ruleId,'j-rule-check':j.ruleCheck};
    criteria.forEach(([key]) => fields['j-'+key]=j.criteria?.[key]);
    ['entry','risk','exit'].forEach(key=>fields['j-exec-'+key]=j.execution?.[key]);
    return Object.fromEntries(Object.entries(fields).map(([key,v])=>[key,v ?? '']));
  }
  function update() {
    const j=current(), g=grade(j.criteria,j.extras), score=scoreFor(j);
    document.getElementById('j-grade').textContent=g==='Invalid'?'Not in playbook':g||'Not graded yet';
    document.getElementById('j-grade-help').textContent=g==='Invalid'?'A required criterion is missing. Still log a trade you already took, honestly.':g==='B'?'Only valid if your playbook allows this limitation. Name it briefly.':'The grade follows your answers. Optional extras have to be defined in the playbook beforehand.';
    document.getElementById('j-score').textContent=score===null?'\u2014':score+'/100';
    document.getElementById('j-score-help').textContent=score===null?'Three answers are enough. No points for profit or good mood.':'Entry 40 \u00b7 Risk 40 \u00b7 Management/Exit 20. Rates the execution, not the outcome.';
    document.getElementById('j-pressure-detail').hidden=(!j.pressure || j.pressure==='none') && !j.trigger && !j.action;
    const snapshot=j.planSnapshot;
    document.getElementById('j-plan-status').textContent=snapshot?'Plan locked: '+new Date(snapshot.at).toLocaleString('en-GB')+'. Later changes do not replace this state.':'Optional, before the entry. The timestamp alone does not prove a pre-trade entry.';
    document.getElementById('j-freeze').disabled=Boolean(snapshot);
    const warning=document.getElementById('j-save-check');
    const missing=[];
    if (!form.result) missing.push('result');
    if (value('f-pnl')==='') missing.push('net P&L');
    if (!(j.initialRisk>0)) missing.push('original risk for R');
    if (score===null) missing.push('a complete execution check');
    if (!g && !form.grade) missing.push('setup grade');
    if (['A','B'].includes(g) && !j.setupReason) missing.push('the named setup limitation');
    if (j.pressure && j.pressure!=='none' && (!j.trigger || !j.action)) missing.push('trigger and actual action');
    if (j.ruleCheck && !j.ruleId) missing.push('the matching weekly rule');
    if (!value('f-lesson')) missing.push('one concrete lesson');
    if (snapshot?.initialRisk>0 && j.initialRisk!==snapshot.initialRisk) missing.push('risk differs from the locked plan; R uses that original value');
    const old={...form,...patch(),result:form.result,pnl:num(value('f-pnl'))};
    warning.textContent=[missing.length?'Still open: '+missing.join(', ')+'.':'The key entries are there.',...issues(old),'Incomplete trades can still be saved; missing values do not count as zero.'].join(' ');
    const legacy=document.getElementById('j-legacy');
    legacy.hidden=editingTradeId===null;
    if (editingTradeId!==null) document.getElementById('j-legacy-note').textContent='Original values stay untouched until you change them or answer the new check in full.';
  }
  function freezePlan() {
    if (form.journalPlanSnapshot) return;
    const j=current();
    if (!value('f-exp') || !j.model) {showToast('Enter your model and a short if-then plan.');return;}
    form.journalPlanSnapshot={at:new Date().toISOString(),model:j.model,bias:form.htfbias||'',biasWhy:value('f-bwhy'),plan:value('f-exp'),invalidation:j.invalidation,management:j.management,criteria:j.criteria,extras:j.extras,grade:grade(j.criteria,j.extras),reason:j.setupReason,initialRisk:j.initialRisk,entry:value('f-entry'),stop:value('f-sl'),target:value('f-tp'),contracts:value('f-contracts')};
    saveTradeDraftNow(); update();
  }
  function suggestLesson() {
    const suggestion=focus[value('j-focus')]?.[1];
    if (!suggestion) {showToast('Write your own if-then rule for this observation.');return;}
    const field=document.getElementById('f-lesson');
    if (field.value.trim()) {showToast('Your existing lesson stays as it is.');return;}
    field.value=suggestion; field.focus(); scheduleTradeDraft(); update();
  }
  function adoptRule(id) {
    const entry=loadLearn().find(e=>String(e.id)===String(id));
    if (!entry) return;
    document.getElementById('j-rule-id').value=String(entry.id);
    document.getElementById('j-rule-check').value='';
    document.getElementById('j-current-rule').textContent=entry.rule||entry.body;
    scheduleTradeDraft();
  }
  function renderRules() {
    const rules=loadLearn().filter(e=>e.kind==='behavior-rule');
    const host=document.getElementById('j-rules');
    host.replaceChildren();
    rules.slice(0,3).forEach(rule=>{
      const button=document.createElement('button'); button.type='button'; button.className='btn';
      button.textContent=rule.title; button.onclick=()=>adoptRule(rule.id); host.append(button);
    });
    if (!rules.length) host.textContent='Save a lesson in Learn as a weekly rule; pick it here on your next trade.';
    const selected=loadLearn().find(e=>String(e.id)===value('j-rule-id'));
    document.getElementById('j-current-rule').textContent=selected?(selected.rule||selected.body):value('j-rule-id')?'That rule is no longer in Learn.':'';
  }
  async function reuseModel() {
    const previous=(await loadTrades()).find(t=>!t.isNoTrade && t.journal?.model);
    if (!previous) {showToast('After your first short report you can reuse your model here.');return;}
    if (value('j-model') || value('j-management')) {showToast('Existing model and management entries stay as they are.');return;}
    document.getElementById('j-model').value=previous.journal.model;
    document.getElementById('j-management').value=previous.journal.management||'';
    scheduleTradeDraft(); update();
  }
  function playbookTemplate() {
    if (value('ln-title') || value('ln-body')) {showToast('Your unfinished Learn entry stays as it is.');return;}
    learnTab('new');
    document.getElementById('ln-title').value='My ICT playbook \u00b7 v1';
    document.getElementById('ln-body').value='Model / variant:\n\nRequired criteria (before every entry):\n\u2022 HTF zone, liquidity target and counter-argument:\n\u2022 Sweep required? Which level?\n\u2022 IFVG / CISD / MSS: which timeframe, which confirmed close?\n\u2022 ES correlation / SMT: required or optional?\n\u2022 Retest or direct entry? Valid entry zone:\n\u2022 Time window, news block and risk limit:\n\nExtra features for A+:\nOptional feature that may be missing for A:\nExplicitly allowed limitation for B:\nIf a required criterion is missing: not in the playbook.\n\nExit / breakeven / partials only when:\n\nChart examples and counter-examples:\n\nTest changes as a hypothesis first; new version from date:';
    document.getElementById('ln-body').focus();
  }
  function inScope(t,range,mode,now=new Date()) {
    if (mode && (t.journal?.mode||'Unknown')!==mode) return false;
    if (!range) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date||'')) return false;
    const today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),day=new Date(t.date+'T00:00:00');
    const start=new Date(today); start.setDate(start.getDate()-range+1);
    return !isNaN(day) && day>=start && day<=today;
  }
  async function toLearn() {
    if (!await readyLearn()) {showToast('Journal not available yet. Please try again.');return;}
    const rule=value('f-lesson');
    if (!rule) {showToast('Write one concrete lesson first.');return;}
    const entries=loadLearn();
    const existing=entries.find(e=>e.kind==='behavior-rule' && e.rule===rule);
    if (existing) {showToast('That rule is already in Learn.');return;}
    const date=value('f-date');
    const title=(focus[value('j-focus')]?.[0]||'My weekly rule');
    const entry={id:Date.now(),date,kind:'behavior-rule',title,rule,
      body:rule+'\n\nFrom trade: '+date+' \u00b7 '+(form.instrument||'MNQ')+'\nTest: the next ten matching trades. Mark non-matching ones separately.\nWeekly: followed x/y; counter-examples; keep or change.',img:''};
    const button=document.getElementById('j-to-learn'); button.disabled=true;
    try {
      if (!await saveLearn([entry,...entries])) {showToast('Learn could not be saved. Your lesson stays in the form.');return;}
      showToast('Weekly rule saved to Learn.'); renderRules();
    } finally {button.disabled=false;}
  }
  function summary(t) {
    const j=t.journal;
    if (!j) return '';
    const rows=[['Model',j.model],['Environment',j.mode],...criteria.map(([key,label])=>[label,{Yes:'Yes',No:'No'}[j.criteria?.[key]]]),['Extra features',{all:'All present',some:'Optional one missing',limited:'Allowed limitation'}[j.extras]],['Setup reason',j.setupReason],['Invalidation',j.invalidation],['Management',j.management],...['entry','risk','exit'].map(key=>['Execution '+key,{Yes:'Yes',Partial:'Partial',No:'No'}[j.execution?.[key]]]),['Original risk',j.initialRisk>0?'$'+j.initialRisk:''],['Realized R',realizedR(t)!==null?realizedR(t).toFixed(2)+' R':''],['Pressure',pressures[j.pressure]||j.pressure],['Trigger',j.trigger],['Action',j.action],['Focus',focus[j.focus]?.[0]],['Weekly rule followed',ruleChecks[j.ruleCheck]]];
    const snapshot=j.planSnapshot;
    return '<div class="card"><h3>Short report</h3><dl class="journal-summary">'+rows.filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl>'+(snapshot?'<details><summary>Locked plan \u00b7 '+esc(snapshot.at)+'</summary><pre>'+esc(JSON.stringify(snapshot,null,2))+'</pre></details>':'')+'</div>';
  }
  function patterns(trades) {
    const groups=[['Chased the entry',t=>t.chased==='Yes'||t.journal?.focus==='chase'],['Did not chase the entry',t=>t.chased==='No'],['Required confirmation missing',t=>t.confirmationPresent==='No'||t.journal?.focus==='early'],['Unplanned exit / BE',t=>t.journal?.focus==='exit'],['Funded / payout pressure',t=>t.journal?.pressure==='funded'||t.journal?.focus==='pressure']];
    const rows=groups.map(([name,predicate])=>{
      const ts=trades.filter(predicate), pnls=ts.map(t=>num(t.pnl)).filter(v=>v!==null), rs=ts.map(realizedR).filter(v=>v!==null);
      return '<tr><th scope="row">'+name+'</th><td>'+ts.length+'</td><td>'+(pnls.length?(pnls.reduce((a,b)=>a+b,0)/pnls.length).toFixed(2)+' $ ('+pnls.length+')':'\u2014')+'</td><td>'+(rs.length?(rs.reduce((a,b)=>a+b,0)/rs.length).toFixed(2)+' R ('+rs.length+')':'\u2014')+'</td></tr>';
    }).join('');
    return '<div class="card"><h3>What keeps repeating?</h3><p>Check one observation each week and write a rule for it in Learn.</p><div class="journal-table"><table><thead><tr><th>Observation</th><th>Trades</th><th>\u00d8 P&L (n)</th><th>\u00d8 R (n)</th></tr></thead><tbody>'+rows+'</tbody></table></div><p class="field-help">Descriptive groups, not proof of cause. Groups can overlap; risk, model and market phase may differ. New pressure and exit tags are never guessed from older free text.</p></div>';
  }
  async function learnProgress() {
    const host=document.getElementById('j-learn-progress'); if (!host) return;
    const trades=(await loadTrades()).filter(t=>!t.isNoTrade);
    const rules=loadLearn().filter(e=>e.kind==='behavior-rule');
    host.hidden=!rules.length;
    host.innerHTML=rules.length?'<h3>Your rule tests</h3>'+rules.map(rule=>{
      const checked=trades.filter(t=>String(t.journal?.ruleId)===String(rule.id));
      const applicable=checked.filter(t=>['Yes','No'].includes(t.journal?.ruleCheck));
      const yes=applicable.filter(t=>t.journal.ruleCheck==='Yes').length;
      return '<div class="journal-rule"><strong>'+esc(rule.title)+'</strong><p>'+esc(rule.rule)+'</p><span>'+yes+'/'+applicable.length+' followed \u00b7 '+checked.filter(t=>t.journal.ruleCheck==='NA').length+' not applicable \u00b7 '+checked.filter(t=>!t.journal.ruleCheck).length+' unchecked'+(applicable.length>=10?' \u00b7 Time for the weekly review.':' \u00b7 First review after ten matching trades.')+'</span></div>';
    }).join(''):'';
  }
  function init() {
    document.getElementById('trade-wizard').addEventListener('input',e=>{
      if (['f-entry','f-sl','f-tp','f-contracts'].includes(e.target.id)) updateRR();
      update();
    });
    document.getElementById('trade-wizard').addEventListener('change',()=>{scheduleTradeDraft();update();});
    update();
  }
  return {criteria,focus,esc,num,value,grade,execution,scoreFor,discipline,realizedR,issues,current,patch,restoreFields,update,freezePlan,suggestLesson,renderRules,reuseModel,playbookTemplate,inScope,toLearn,summary,patterns,learnProgress,init};
})();
