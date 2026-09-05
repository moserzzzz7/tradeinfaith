/* Small, explicit journal decisions. Historical records are never migrated in place. */
'use strict';
const Journal = (() => {
  const criteria = [
    ['context', 'HTF-Kontext, Ziel und Gegenargument geklärt'],
    ['trigger', 'Pflichtbestätigung meines Modells beim Entry vorhanden'],
    ['conditions', 'Entry-Zone, Risiko, Zeitfenster und News-Regeln erfüllt']
  ];
  const focus = {
    repeat: ['Sauber ausgeführt', 'Wenn mein vollständiger Trigger vorliegt, wiederhole ich den geplanten Ablauf.'],
    chase: ['Entry hinterhergelaufen', 'Wenn meine Entry-Zone verlassen ist, lasse ich den Einstieg aus.'],
    early: ['Zu früh eingestiegen', 'Solange meine Pflichtbestätigung fehlt, sende ich keine Order.'],
    risk: ['Risiko verändert', 'Vor der Order prüfe ich Stop und Positionsgröße gegen mein Risikolimit.'],
    exit: ['Ungeplanter Exit / Breakeven', 'Bevor ich den Exit ändere, prüfe ich meinen vorher festgelegten Exit-Grund.'],
    pressure: ['Funded- / Payout-Druck', 'Wenn mein Kontoziel die Entscheidung treibt, pausiere ich und prüfe den ursprünglichen Plan.'],
    context: ['HTF / ES übersehen', 'Vor der Order prüfe ich die in meinem Modell vorgesehenen HTF- und Vergleichslevels.'],
    other: ['Andere Beobachtung', '']
  };
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
    if (t.journal?.execution?.entry==='Yes' && scoreFor(t.journal)===null && execution(t.journal.execution)!==null) out.push('Entry als regelkonform markiert, obwohl ein Pflichtkriterium fehlt oder ein Entry-Fehler gewählt ist.');
    if (t.rulebased === 'yes' && (t.toPlan === 'No' || t.deviated === 'Yes' || t.matchesPlaybook === 'No')) out.push('Regeltreue widerspricht Plan oder Playbook.');
    if (t.toPlan === 'Yes' && t.deviated === 'Yes') out.push('Plan eingehalten und vom Plan abgewichen sind beide gewählt.');
    if (t.matchesPlaybook === 'No' && ['A+','A','B'].includes(t.grade)) out.push('Qualitätsstufe vergeben, obwohl das Playbook nicht erfüllt ist.');
    if (t.confirmationPresent === 'No' && t.execQuality >= 4) out.push('Hohe Execution-Note trotz fehlender Bestätigung.');
    const pnl = num(t.pnl);
    if (pnl !== null && ((t.result === 'Win' && pnl < 0) || (t.result === 'Loss' && pnl > 0))) out.push('Ergebnis und P&L-Vorzeichen widersprechen sich.');
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
    document.getElementById('j-grade').textContent=g==='Invalid'?'Nicht im Playbook':g||'Noch nicht bewertet';
    document.getElementById('j-grade-help').textContent=g==='Invalid'?'Pflichtkriterium fehlt. Einen bereits genommenen Trade trotzdem ehrlich erfassen.':g==='B'?'Nur zulässig, wenn diese Einschränkung im Playbook erlaubt ist. Kurz benennen.':'Die Einstufung folgt deinen Antworten. Optionale Extras müssen vorher im Playbook feststehen.';
    document.getElementById('j-score').textContent=score===null?'—':score+'/100';
    document.getElementById('j-score-help').textContent=score===null?'Drei Antworten genügen. Keine Punkte für Gewinn oder gute Stimmung.':'Entry 40 · Risiko 40 · Management/Exit 20. Bewertet die Ausführung, nicht den Ausgang.';
    document.getElementById('j-pressure-detail').hidden=(!j.pressure || j.pressure==='none') && !j.trigger && !j.action;
    const snapshot=j.planSnapshot;
    document.getElementById('j-plan-status').textContent=snapshot?'Plan festgehalten: '+new Date(snapshot.at).toLocaleString('de-DE')+'. Spätere Änderungen ersetzen diesen Stand nicht.':'Optional vor dem Entry festhalten. Der Zeitpunkt allein beweist keinen Pre-Trade-Eintrag.';
    document.getElementById('j-freeze').disabled=Boolean(snapshot);
    const warning=document.getElementById('j-save-check');
    const missing=[];
    if (!form.result) missing.push('Ergebnis');
    if (value('f-pnl')==='') missing.push('Netto-P&L');
    if (!(j.initialRisk>0)) missing.push('ursprüngliches Risiko für R');
    if (score===null) missing.push('vollständiger Execution-Check');
    if (!g && !form.grade) missing.push('Setup-Bewertung');
    if (['A','B'].includes(g) && !j.setupReason) missing.push('benannte Setup-Einschränkung');
    if (j.pressure && j.pressure!=='none' && (!j.trigger || !j.action)) missing.push('Auslöser und tatsächliche Handlung');
    if (j.ruleCheck && !j.ruleId) missing.push('zugehörige Wochenregel');
    if (!value('f-lesson')) missing.push('eine konkrete Lesson');
    if (snapshot?.initialRisk>0 && j.initialRisk!==snapshot.initialRisk) missing.push('Risiko weicht vom festgehaltenen Plan ab; R nutzt dessen ursprünglichen Wert');
    const old={...form,...patch(),result:form.result,pnl:num(value('f-pnl'))};
    warning.textContent=[missing.length?'Noch offen: '+missing.join(', ')+'.':'Die wichtigsten Angaben sind vorhanden.',...issues(old),'Unvollständige Trades bleiben speicherbar; fehlende Werte zählen nicht als Null.'].join(' ');
    const legacy=document.getElementById('j-legacy');
    legacy.hidden=editingTradeId===null;
    if (editingTradeId!==null) document.getElementById('j-legacy-note').textContent='Originalwerte bleiben erhalten, bis du sie änderst oder den neuen Check vollständig beantwortest.';
  }
  function freezePlan() {
    if (form.journalPlanSnapshot) return;
    const j=current();
    if (!value('f-exp') || !j.model) {showToast('Modell und kurzen Wenn-dann-Plan eintragen.');return;}
    form.journalPlanSnapshot={at:new Date().toISOString(),model:j.model,bias:form.htfbias||'',biasWhy:value('f-bwhy'),plan:value('f-exp'),invalidation:j.invalidation,management:j.management,criteria:j.criteria,extras:j.extras,grade:grade(j.criteria,j.extras),reason:j.setupReason,initialRisk:j.initialRisk,entry:value('f-entry'),stop:value('f-sl'),target:value('f-tp'),contracts:value('f-contracts')};
    saveTradeDraftNow(); update();
  }
  function suggestLesson() {
    const suggestion=focus[value('j-focus')]?.[1];
    if (!suggestion) {showToast('Für diese Beobachtung eine eigene Wenn-dann-Regel formulieren.');return;}
    const field=document.getElementById('f-lesson');
    if (field.value.trim()) {showToast('Deine bestehende Lesson bleibt erhalten.');return;}
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
    if (!rules.length) host.textContent='Eine Lesson in Learn als Wochenregel vormerken; hier beim nächsten Trade auswählen.';
    const selected=loadLearn().find(e=>String(e.id)===value('j-rule-id'));
    document.getElementById('j-current-rule').textContent=selected?(selected.rule||selected.body):value('j-rule-id')?'Regel nicht mehr in Learn vorhanden.':'';
  }
  async function reuseModel() {
    const previous=(await loadTrades()).find(t=>!t.isNoTrade && t.journal?.model);
    if (!previous) {showToast('Nach dem ersten Kurzrapport kannst du dein Modell hier wiederverwenden.');return;}
    if (value('j-model') || value('j-management')) {showToast('Vorhandene Modell- und Management-Angaben bleiben erhalten.');return;}
    document.getElementById('j-model').value=previous.journal.model;
    document.getElementById('j-management').value=previous.journal.management||'';
    scheduleTradeDraft(); update();
  }
  function playbookTemplate() {
    if (value('ln-title') || value('ln-body')) {showToast('Dein angefangener Learn-Eintrag bleibt erhalten.');return;}
    learnTab('new');
    document.getElementById('ln-title').value='Mein ICT-Playbook · v1';
    document.getElementById('ln-body').value='Modell / Variante:\n\nPflichtkriterien (vor jedem Entry):\n• HTF-Zone, Liquiditätsziel und Gegenargument:\n• Sweep erforderlich? Welches Level?\n• IFVG / CISD / MSS: welcher Timeframe, welcher bestätigte Schluss?\n• ES-Abgleich / SMT: Pflicht oder optional?\n• Retest oder direkter Entry? Zulässige Entry-Zone:\n• Zeitfenster, News-Sperre und Risikolimit:\n\nZusatzmerkmale für A+:\nOptional fehlendes Merkmal für A:\nAusdrücklich erlaubte Einschränkung für B:\nFehlt ein Pflichtkriterium: nicht im Playbook.\n\nExit / Breakeven / Teilgewinne nur bei:\n\nChart-Beispiele und Gegenbeispiele:\n\nÄnderungen erst als Hypothese prüfen; neue Version ab Datum:';
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
    if (!await readyLearn()) {showToast('Journal noch nicht verfügbar. Bitte erneut versuchen.');return;}
    const rule=value('f-lesson');
    if (!rule) {showToast('Zuerst eine konkrete Lesson eintragen.');return;}
    const entries=loadLearn();
    const existing=entries.find(e=>e.kind==='behavior-rule' && e.rule===rule);
    if (existing) {showToast('Diese Regel ist bereits in Learn.');return;}
    const date=value('f-date');
    const title=(focus[value('j-focus')]?.[0]||'Meine Wochenregel');
    const entry={id:Date.now(),date,kind:'behavior-rule',title,rule,
      body:rule+'\n\nAus Trade: '+date+' · '+(form.instrument||'MNQ')+'\nPrüfung: nächste zehn passende Trades. Nicht passend separat markieren.\nWöchentlich: eingehalten x/y; Gegenbeispiele; beibehalten oder ändern.',img:''};
    const button=document.getElementById('j-to-learn'); button.disabled=true;
    try {
      if (!await saveLearn([entry,...entries])) {showToast('Learn konnte nicht gespeichert werden. Deine Lesson bleibt im Formular.');return;}
      showToast('Wochenregel in Learn gespeichert.'); renderRules();
    } finally {button.disabled=false;}
  }
  function summary(t) {
    const j=t.journal;
    if (!j) return '';
    const rows=[['Modell',j.model],['Umgebung',j.mode],...criteria.map(([key,label])=>[label,{Yes:'Ja',No:'Nein'}[j.criteria?.[key]]]),['Zusatzmerkmale',{all:'Alle vorhanden',some:'Optionales fehlt',limited:'Erlaubte Einschränkung'}[j.extras]],['Setup-Begründung',j.setupReason],['Invalidierung',j.invalidation],['Management',j.management],...['entry','risk','exit'].map(key=>['Execution '+key,{Yes:'Ja',Partial:'Teilweise',No:'Nein'}[j.execution?.[key]]]),['Ursprüngliches Risiko',j.initialRisk>0?'$'+j.initialRisk:''],['Realisiertes R',realizedR(t)!==null?realizedR(t).toFixed(2)+' R':''],['Druck',j.pressure],['Auslöser',j.trigger],['Handlung',j.action],['Fokus',focus[j.focus]?.[0]],['Wochenregel geprüft',j.ruleCheck]];
    const snapshot=j.planSnapshot;
    return '<div class="card"><h3>Kurzrapport</h3><dl class="journal-summary">'+rows.filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl>'+(snapshot?'<details><summary>Festgehaltener Plan · '+esc(snapshot.at)+'</summary><pre>'+esc(JSON.stringify(snapshot,null,2))+'</pre></details>':'')+'</div>';
  }
  function coverage(trades) {
    const pnl=trades.filter(t=>num(t.pnl)!==null).length, r=trades.filter(t=>realizedR(t)!==null).length;
    const conflicts=trades.filter(t=>issues(t).length).length;
    const modes=[...new Set(trades.map(t=>t.journal?.mode||'Unbekannt'))];
    return '<div class="journal-notice">Datenbasis: '+trades.length+' Trades · P&L '+pnl+'/'+trades.length+' · R '+r+'/'+trades.length+' · '+conflicts+' mit widersprüchlichen Auswahlfeldern. Fehlende Beträge sind keine Nullwerte. Historische Angaben bleiben unverändert. Umgebung: '+esc(modes.join(', '))+'.'+(modes.length>1?' Für Vergleiche nach Live, Demo oder Replay filtern.':'')+'</div>';
  }
  function patterns(trades) {
    const groups=[['Entry gechased',t=>t.chased==='Yes'||t.journal?.focus==='chase'],['Entry nicht gechased',t=>t.chased==='No'],['Pflichtbestätigung fehlt',t=>t.confirmationPresent==='No'||t.journal?.focus==='early'],['Ungeplanter Exit / BE',t=>t.journal?.focus==='exit'],['Funded- / Payout-Druck',t=>t.journal?.pressure==='funded'||t.journal?.focus==='pressure']];
    const rows=groups.map(([name,predicate])=>{
      const ts=trades.filter(predicate), pnls=ts.map(t=>num(t.pnl)).filter(v=>v!==null), rs=ts.map(realizedR).filter(v=>v!==null);
      return '<tr><th scope="row">'+name+'</th><td>'+ts.length+'</td><td>'+(pnls.length?(pnls.reduce((a,b)=>a+b,0)/pnls.length).toFixed(2)+' $ ('+pnls.length+')':'—')+'</td><td>'+(rs.length?(rs.reduce((a,b)=>a+b,0)/rs.length).toFixed(2)+' R ('+rs.length+')':'—')+'</td></tr>';
    }).join('');
    return '<div class="card"><h3>Was wiederholt sich?</h3><p>Wöchentlich eine Beobachtung prüfen und eine Regel in Learn festhalten.</p><div class="journal-table"><table><thead><tr><th>Beobachtung</th><th>Trades</th><th>Ø P&L (n)</th><th>Ø R (n)</th></tr></thead><tbody>'+rows+'</tbody></table></div><p class="field-help">Beschreibende Gruppen, keine Ursachenbeweise. Gruppen können überlappen; Risiko, Modell und Marktphase können sich unterscheiden. Neue Druck-/Exit-Tags werden nicht aus alten Freitexten erraten.</p></div>';
  }
  async function learnProgress() {
    const host=document.getElementById('j-learn-progress'); if (!host) return;
    const trades=(await loadTrades()).filter(t=>!t.isNoTrade);
    const rules=loadLearn().filter(e=>e.kind==='behavior-rule');
    host.innerHTML=rules.length?'<h3>Deine Regeltests</h3>'+rules.map(rule=>{
      const checked=trades.filter(t=>String(t.journal?.ruleId)===String(rule.id));
      const applicable=checked.filter(t=>['Yes','No'].includes(t.journal?.ruleCheck));
      const yes=applicable.filter(t=>t.journal.ruleCheck==='Yes').length;
      return '<div class="journal-rule"><strong>'+esc(rule.title)+'</strong><p>'+esc(rule.rule)+'</p><span>'+yes+'/'+applicable.length+' eingehalten · '+checked.filter(t=>t.journal.ruleCheck==='NA').length+' nicht passend · '+checked.filter(t=>!t.journal.ruleCheck).length+' ungeprüft'+(applicable.length>=10?' · Jetzt wöchentlich auswerten.':' · Erste Auswertung nach zehn passenden Trades.')+'</span></div>';
    }).join(''):'<p>Speichere eine konkrete Lesson als Wochenregel. Beim nächsten Trade wählst du sie aus und prüfst sie mit einem Klick.</p>';
  }
  function init() {
    document.getElementById('trade-wizard').addEventListener('input',e=>{
      if (['f-entry','f-sl','f-tp','f-contracts'].includes(e.target.id)) updateRR();
      update();
    });
    document.getElementById('trade-wizard').addEventListener('change',()=>{scheduleTradeDraft();update();});
    update();
  }
  return {criteria,focus,esc,num,value,grade,execution,scoreFor,discipline,realizedR,issues,current,patch,restoreFields,update,freezePlan,suggestLesson,renderRules,reuseModel,playbookTemplate,inScope,toLearn,summary,coverage,patterns,learnProgress,init};
})();
