/* Small, explicit journal decisions. Historical records are never migrated in place. */
'use strict';
const Journal = (() => {
  const criteria = [
    ['context', 'HTF context, target and counter-argument are clear'],
    ['trigger', 'Required confirmation from my model was present at entry'],
    ['conditions', 'Entry zone, risk, time window and news rules were met']
  ];
  const focus = {
    repeat: ['Clean trade', 'Next time: If my setup is clear, then I follow the same plan.'],
    chase: ['Chased entry', 'Next time: If price has left my entry zone, then I skip the trade.'],
    early: ['Too early', 'Next time: If my entry signal is missing, then I wait.'],
    risk: ['Changed risk', 'Next time: If I place an order, then I keep the planned risk.'],
    exit: ['Exited unplanned', 'Next time: If I want to exit early, then I check my plan first.'],
    pressure: ['Pressure', 'Next time: If pressure drives the decision, then I pause and read my plan.'],
    context: ['Missed context', 'Next time: If the wider context is unclear, then I do not enter.'],
    other: ['Other', 'Next time: If this happens again, then I follow my written rule.']
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
    return execution(j?.execution);
  }
  const DISCIPLINE_WINDOW = 20; // recent form, not all-time: a rule break should hit the score, not vanish into a long history.
  function discipline(trades) {
    const measured = trades.filter(t => !t.isNoTrade && ['yes','partial','no'].includes(t.rulebased));
    if (!measured.length) return null;
    const recent = measured.slice().sort((a,b) => (b.date||'').localeCompare(a.date||'') || (b.id||0)-(a.id||0)).slice(0, DISCIPLINE_WINDOW);
    return Math.round(recent.reduce((sum,t) => sum + ({yes:100,partial:50,no:0}[t.rulebased]),0) / recent.length);
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
    // Fees can turn a small win negative; the sign check uses the P&L before fees.
    const pnl = num(t.grossPnl) ?? num(t.pnl);
    if (pnl !== null && ((t.result === 'Win' && pnl < 0) || (t.result === 'Loss' && pnl > 0))) out.push('Result and P&L sign contradict each other.');
    return out;
  }
  function checks(prefix, keys) { return Object.fromEntries(keys.map(key => [key,value(prefix+key)])); }
  function current() {
    const psychology=typeof getPsychology==='function'?getPsychology():[];
    const pressureMap={'No pressure':'none',FOMO:'fomo','Payout pressure':'funded',Fear:'fear',Revenge:'revenge'};
    const selectedPressure=psychology.map(item=>pressureMap[item]).find(Boolean)||'';
    return {
      version:form.journalVersion||2, model:value('j-model'), mode:value('j-mode')||(editingTradeId===null?'Live':''),
      criteria:checks('j-',criteria.map(([key])=>key)), extras:value('j-extras'),
      invalidation:value('j-invalidation'), management:value('j-management'),
      initialRisk:num(value('j-risk')), profitTarget:num(value('j-profit-target')), setupReason:value('j-grade-reason'),
      execution:checks('j-exec-',['entry','risk','exit']),
      psychology, pressure:selectedPressure||value('j-pressure'), trigger:value('j-psych-trigger'), action:value('j-action'),
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
      // Without any setup answers (the wizard no longer asks for them) the
      // three execution answers alone decide rule adherence.
      const setupAnswered = Object.values(journal.criteria).some(Boolean) || Boolean(journal.extras);
      if (assessedGrade === 'Invalid') result.rulebased = 'no';
      else if (!assessedGrade && setupAnswered) result.rulebased = states.includes('No') ? 'no' : '';
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
      'j-management':j.management,'j-risk':j.initialRisk,'j-profit-target':j.profitTarget,'j-grade-reason':j.setupReason,
      'j-pressure':j.pressure,'j-psych-trigger':j.trigger,'j-action':j.action,'j-focus':j.focus,
      'j-rule-id':j.ruleId,'j-rule-check':j.ruleCheck};
    criteria.forEach(([key]) => fields['j-'+key]=j.criteria?.[key]);
    ['entry','risk','exit'].forEach(key=>fields['j-exec-'+key]=j.execution?.[key]);
    return Object.fromEntries(Object.entries(fields).map(([key,v])=>[key,v ?? '']));
  }
  function update() {
    const j=current(), g=grade(j.criteria,j.extras), score=scoreFor(j);
    const warning=document.getElementById('j-save-check');
    const missing=[];
    if (!form.result) missing.push('result');
    if (value('f-pnl')==='') missing.push('P&L');
    if (!(j.initialRisk>0)) missing.push('risk');
    if (j.profitTarget===null) missing.push('profit target');
    if (score===null) missing.push('three execution answers');
    if (j.ruleCheck && !j.ruleId) missing.push('the matching weekly rule');
    if (!value('f-lesson')) missing.push('lesson');
    const old={...form,...patch(),result:form.result,pnl:num(value('f-pnl'))};
    warning.textContent=[missing.length?'Still open: '+missing.join(', ')+'.':'Ready to save.',...issues(old)].join(' ');
    const legacy=document.getElementById('j-legacy');
    legacy.hidden=editingTradeId===null;
    if (editingTradeId!==null) document.getElementById('j-legacy-note').textContent='Original values stay untouched until you change them or answer the new check in full.';
  }
  function suggestLesson() {
    const suggestion=focus[value('j-focus')]?.[1];
    if (!suggestion) return;
    const field=document.getElementById('f-lesson');
    if (field.value.trim()) return;
    field.value=suggestion; scheduleTradeDraft(); update();
  }
  function renderRules() {
    const rules=loadLearn().filter(e=>e.kind==='behavior-rule');
    const storedId=value('j-rule-id');
    const stored=rules.find(e=>String(e.id)===storedId);
    const selected=stored||(!storedId?rules[0]:null)||null;
    if (selected && !storedId) document.getElementById('j-rule-id').value=String(selected.id);
    const text=selected?(selected.rule||selected.body||''):'';
    const plan=document.getElementById('j-plan-rule'), follow=document.getElementById('j-rule-follow');
    document.getElementById('j-current-rule').textContent=text;
    document.getElementById('j-rule-text').textContent=text;
    plan.hidden=!text; follow.hidden=!text;
  }
  function playbookTemplate() {
    if (value('ln-title') || value('ln-body')) {showToast('Your unfinished Playbook entry stays as it is.');return;}
    learnTab('new');
    if (typeof setLearnCat==='function') setLearnCat('setup');
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
  async function toLearn(silent) {
    if (!await readyLearn()) {showToast('Journal not available yet. Please try again.');return;}
    const rule=value('f-lesson');
    if (!rule) {showToast('Write one concrete lesson first.');return;}
    const entries=loadLearn();
    const existing=entries.find(e=>e.kind==='behavior-rule' && e.rule===rule);
    if (existing) {if(!silent)showToast('That rule is already in the Playbook.');return true;}
    const date=value('f-date');
    const title=(focus[value('j-focus')]?.[0]||'My weekly rule');
    const shown=typeof fmtDate==='function'?fmtDate(date):date;
    const entry={id:Date.now(),date,kind:'behavior-rule',category:'rule',title,rule,
      body:rule+'\n\nFrom trade: '+shown+' \u00b7 '+(form.instrument||'MNQ')+'\nTest: the next ten matching trades. Mark non-matching ones separately.\nWeekly: followed x/y; counter-examples; keep or change.',img:''};
    try {
      if (!await saveLearn([entry,...entries])) {showToast('The weekly rule could not be saved.');return false;}
      if(!silent)showToast('Weekly rule saved to the Playbook.'); renderRules(); return true;
    } catch(e) {console.error('Weekly rule save failed',e);showToast('The weekly rule could not be saved.');return false;}
  }
  function summary(t) {
    const j=t.journal;
    if (!j) return '';
    const usd=v=>typeof fmtUSD==='function'?fmtUSD(v):'$'+v;
    const rr=realizedR(t);
    const rows=[['Model',j.model],['Environment',j.mode],...criteria.map(([key,label])=>[label,{Yes:'Yes',No:'No'}[j.criteria?.[key]]]),['Extra features',{all:'All present',some:'Optional one missing',limited:'Allowed limitation'}[j.extras]],['Setup reason',j.setupReason],['Invalidation',j.invalidation],['Management',j.management],...['entry','risk','exit'].map(key=>['Execution '+key,{Yes:'Yes',Partial:'Partial',No:'No'}[j.execution?.[key]]]),['Risk',j.initialRisk>0?usd(j.initialRisk).replace(/^\+/,''):''],['Profit target',j.profitTarget!==null&&j.profitTarget!==undefined?usd(j.profitTarget).replace(/^\+/,''):''],['Realized R',rr!==null?(typeof fmtR==='function'?fmtR(rr):rr.toFixed(2)+' R'):''],['Psychology',Array.isArray(j.psychology)?j.psychology.join(', '):''],['Pressure',Array.isArray(j.psychology)&&j.psychology.length?'':pressures[j.pressure]||j.pressure],['Trigger',j.trigger],['Action',j.action],['Takeaway',focus[j.focus]?.[0]],['Weekly rule followed',ruleChecks[j.ruleCheck]]];
    const snapshot=j.planSnapshot;
    const lockedAt=snapshot?new Date(snapshot.at):null;
    const lockedLabel=lockedAt&&!isNaN(lockedAt)?lockedAt.toLocaleString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).replace(/\//g,'.'):(snapshot?snapshot.at:'');
    return '<div class="card"><h3>Short report</h3><dl class="journal-summary">'+rows.filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl>'+(snapshot?'<details><summary>Locked plan \u00b7 '+esc(lockedLabel)+'</summary><pre>'+esc(JSON.stringify(snapshot,null,2))+'</pre></details>':'')+'</div>';
  }
  function patterns(trades) {
    const groups=[['Chased the entry',t=>t.chased==='Yes'||t.journal?.focus==='chase'],['Did not chase the entry',t=>t.chased==='No'],['Required confirmation missing',t=>t.confirmationPresent==='No'||t.journal?.focus==='early'],['Unplanned exit / BE',t=>t.journal?.focus==='exit'],['Funded / payout pressure',t=>t.journal?.pressure==='funded'||t.journal?.focus==='pressure']];
    const usd=v=>typeof fmtUSD==='function'?fmtUSD(Math.round(v)):v.toFixed(2)+' $';
    const rfmt=v=>typeof fmtR==='function'?fmtR(v):v.toFixed(2)+' R';
    const note=n=>typeof sampleNote==='function'&&sampleNote(n)?' <span class="hint-pill">'+sampleNote(n)+'</span>':'';
    const rows=groups.map(([name,predicate])=>{
      const ts=trades.filter(predicate), pnls=ts.map(t=>num(t.pnl)).filter(v=>v!==null), rs=ts.map(realizedR).filter(v=>v!==null);
      return '<tr><th scope="row">'+name+note(ts.length)+'</th><td>'+ts.length+'</td><td>'+(pnls.length?usd(pnls.reduce((a,b)=>a+b,0)/pnls.length)+' ('+pnls.length+')':'\u2014')+'</td><td>'+(rs.length?rfmt(rs.reduce((a,b)=>a+b,0)/rs.length)+' ('+rs.length+')':'\u2014')+'</td></tr>';
    }).join('');
    return '<div class="card"><h3>What keeps repeating?</h3><p>Check one observation each week and write a rule for it in the Playbook or your weekly review.</p><div class="journal-table"><table><thead><tr><th>Observation</th><th>Trades</th><th>\u00d8 P&L (n)</th><th>\u00d8 R (n)</th></tr></thead><tbody>'+rows+'</tbody></table></div><p class="field-help">Descriptive groups, not proof of cause. Groups can overlap; risk, model and market phase may differ. New pressure and exit tags are never guessed from older free text.</p></div>';
  }
  async function learnProgress() {
    const host=document.getElementById('j-learn-progress'); if (!host) return;
    const trades=(await loadTrades()).filter(t=>!t.isNoTrade);
    const rules=loadLearn().filter(e=>e.kind==='behavior-rule');
    host.hidden=!rules.length;
    host.innerHTML=rules.length?'<h3 class="card-title">Your rule tests</h3>'+rules.map(rule=>{
      const checked=trades.filter(t=>String(t.journal?.ruleId)===String(rule.id));
      const applicable=checked.filter(t=>['Yes','No'].includes(t.journal?.ruleCheck));
      const yes=applicable.filter(t=>t.journal.ruleCheck==='Yes').length;
      return '<div class="journal-rule"><strong>'+esc(rule.title)+'</strong><p>'+esc(rule.rule)+'</p><span>'+yes+'/'+applicable.length+' followed \u00b7 '+checked.filter(t=>t.journal.ruleCheck==='NA').length+' not applicable \u00b7 '+checked.filter(t=>!t.journal.ruleCheck).length+' unchecked'+(applicable.length>=10?' \u00b7 Time for the weekly review.':' \u00b7 First review after ten matching trades.')+'</span></div>';
    }).join(''):'';
  }
  function init() {
    document.getElementById('trade-wizard').addEventListener('input',e=>{
      if (['j-risk','j-profit-target','f-contracts'].includes(e.target.id)) updateRR();
      update();
    });
    document.getElementById('trade-wizard').addEventListener('change',()=>{scheduleTradeDraft();update();});
    update();
  }
  function choose(id,selected,button) {
    document.getElementById(id).value=selected;
    button.closest('.seg').querySelectorAll('.opt').forEach(item=>item.classList.toggle('sel',item===button));
    scheduleTradeDraft(); update();
  }
  function chooseFocus(selected,button) { choose('j-focus',selected,button); suggestLesson(); }
  function syncChoices() {
    document.querySelectorAll('[data-journal-input]').forEach(group=>{
      const selected=value(group.dataset.journalInput);
      group.querySelectorAll('.opt').forEach(button=>button.classList.toggle('sel',button.dataset.v===selected));
    });
  }
  return {criteria,focus,pressures,esc,num,value,grade,execution,scoreFor,discipline,realizedR,issues,current,patch,restoreFields,update,suggestLesson,renderRules,playbookTemplate,inScope,toLearn,summary,patterns,learnProgress,choose,chooseFocus,syncChoices,init};
})();
