
(function(){
  var ANSWERS_STORAGE_KEY = 'rrn_answers_v1';
  var FOLDER_STORAGE_KEY = 'rrn_folder_checklist_v1';
  var START_URL = '/index.html';
  var stage = document.getElementById('stage');
  var report = document.getElementById('report');
  var percentText = document.getElementById('percentText');
  var phraseText = document.getElementById('phraseText');
  var statusText = document.getElementById('statusText');
  var barFill = document.getElementById('barFill');
  var skipBtn = document.getElementById('skipBtn');
  var needle = document.getElementById('needle');
  var loaderEl = document.getElementById('loader');
  var params = new URLSearchParams(window.location.search);
  var loaderPreviewComplete = params.get('loaderPreview') === 'complete';
  var reportPreview = params.get('reportPreview') === '1';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function denyResultsAccess(){
    document.body.style.opacity = '0';
    window.location.replace(START_URL);
  }

  async function confirmResultsAccess(){
    if (reportPreview || loaderPreviewComplete) return true;
    var answers = readAnswers();
    if (!answers || !answers.lead_id) return false;

    if (window.rrnFetchEntitlements) {
      try {
        var ent = await rrnFetchEntitlements(answers.lead_id);
        if (ent && ent.paid10) return true;
      } catch (_e) {}
    }

    return !!(window.rrnHasRecentFlowAccess && rrnHasRecentFlowAccess('prescreen-results', { statuses: ['confirmed'] }));
  }

  function setBriefStatus(el, text, level){
    if (!el) return;
    el.textContent = text;
    el.className = 'status ' + level;
  }

  function buildBriefResult(){
    var answers = readAnswers();
    var annual = Number(answers.annual_income) || 0;
    var rent = Number(answers.rent_budget) || 0;
    var monthly = annual > 0 ? annual / 12 : 0;
    var ratio = monthly > 0 && rent > 0 ? monthly / rent : 0;
    var credit = answers.credit_score || '';
    var creditGood = ['660_699','700_739','740_799','800_plus'].indexOf(credit) >= 0;
    var creditMid = credit === '620_659';

    var incomeStatus = document.getElementById('incomeStatus');
    var creditStatus = document.getElementById('creditStatus');
    var moveStatus = document.getElementById('moveStatus');
    var strongestCopy = document.getElementById('strongestCopy');
    var strongestStatus = document.getElementById('strongestStatus');
    var verifyCopy = document.getElementById('verifyCopy');
    var verifyStatus = document.getElementById('verifyStatus');
    var outlookState = document.getElementById('outlookState');
    var outlookCopy = document.getElementById('outlookCopy');

    if (ratio >= 3) setBriefStatus(incomeStatus, 'Looks strong', 'good');
    else if (ratio >= 2.5) setBriefStatus(incomeStatus, 'Close — verify', 'warn');
    else if (ratio > 0) setBriefStatus(incomeStatus, 'Needs review', 'risk');
    else setBriefStatus(incomeStatus, 'Not confirmed', 'warn');

    if (creditGood) setBriefStatus(creditStatus, 'Positive range', 'good');
    else if (creditMid) setBriefStatus(creditStatus, 'Worth checking', 'warn');
    else if (credit) setBriefStatus(creditStatus, 'Needs review', 'warn');
    else setBriefStatus(creditStatus, 'Not confirmed', 'warn');

    if (answers.move_timeline) setBriefStatus(moveStatus, 'Plan is clear', 'good');
    else setBriefStatus(moveStatus, 'Not confirmed', 'warn');

    if (ratio >= 3){
      if (strongestCopy) strongestCopy.textContent = 'Your reported income appears to give you a stronger starting point for homes near your target rent.';
      if (strongestStatus) strongestStatus.textContent = 'Income looks strong';
    } else if (creditGood){
      if (strongestCopy) strongestCopy.textContent = 'Your selected credit range is one of the stronger signals in the information you shared.';
      if (strongestStatus) strongestStatus.textContent = 'Credit is a positive signal';
    } else if (answers.preferred_city || answers.move_timeline){
      if (strongestCopy) strongestCopy.textContent = 'You already have a clear search direction, which makes it easier to compare properties before you apply.';
      if (strongestStatus) strongestStatus.textContent = 'Search plan is clear';
    } else {
      if (strongestCopy) strongestCopy.textContent = 'Completing your RentReady questionnaire gives you a clearer starting point than applying without a plan.';
      if (strongestStatus) strongestStatus.textContent = 'Profile started';
    }

    if (ratio > 0 && ratio < 2.5){
      if (verifyCopy) verifyCopy.textContent = 'Confirm the property’s income requirement before paying an application fee. Your target rent may be high if the property uses a strict income multiple.';
      if (verifyStatus) verifyStatus.textContent = 'Check income criteria';
    } else if (credit && !creditGood){
      if (verifyCopy) verifyCopy.textContent = 'Ask how the property reviews credit and whether it uses a fixed minimum, a broader screening model, or conditional approval.';
      if (verifyStatus) verifyStatus.textContent = 'Check credit criteria';
    } else {
      if (verifyCopy) verifyCopy.textContent = 'Confirm the property’s written screening criteria, including income, credit, rental history, and any rules that could affect move-in costs.';
      if (verifyStatus) verifyStatus.textContent = 'Confirm property rules';
    }

    if (ratio >= 3 && creditGood){
      if (outlookState) outlookState.textContent = 'Promising Starting Point';
      if (outlookCopy) outlookCopy.textContent = 'Your income and selected credit range are positive signals. A no-deposit move-in can still depend on the property’s own screening and deposit program.';
    } else if (ratio >= 2.5 || creditGood || creditMid){
      if (outlookState) outlookState.textContent = 'Worth Exploring';
      if (outlookCopy) outlookCopy.textContent = 'Your answers show enough positive signals to keep no-deposit options in the conversation, but property-specific criteria still matter.';
    } else {
      if (outlookState) outlookState.textContent = 'Possible — Prepare First';
      if (outlookCopy) outlookCopy.textContent = 'A no-deposit option may still exist, but your next move should be checking the property’s criteria and strengthening the parts of your profile they are most likely to review.';
    }
  }

  function escapeHtml(value){
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function readAnswers(){
    try {
      return JSON.parse(sessionStorage.getItem(ANSWERS_STORAGE_KEY) || localStorage.getItem(ANSWERS_STORAGE_KEY) || '{}') || {};
    } catch (err) {
      return {};
    }
  }

  function money(value){
    var num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return 'Not Yet Confirmed';
    return '$' + Math.round(num).toLocaleString();
  }

  function formatTimeline(value){
    return ({
      asap: 'ASAP',
      '1_month': 'within 1 month',
      '3_months': 'in 1–3 months',
      '6_months': 'in 3–6 months',
      flexible: 'flexible'
    })[value] || 'Not Yet Confirmed';
  }

  function creditLabel(value){
    return ({
      below_580: 'Below 580',
      '580_619': '580–619',
      '620_659': '620–659',
      '660_699': '660–699',
      '700_739': '700–739',
      '740_799': '740–799',
      '800_plus': '800+'
    })[value] || 'Not Yet Confirmed';
  }

  function statusClass(level){
    return level === 'risk' ? 'is-risk' : level === 'warn' ? 'is-warn' : '';
  }

  function createProfile(answers){
    var annualIncome = Number(answers.annual_income);
    var rentBudget = Number(answers.rent_budget);
    var monthlyIncome = Number.isFinite(annualIncome) && annualIncome > 0 ? annualIncome / 12 : 0;
    var incomeRatio = monthlyIncome && rentBudget ? monthlyIncome / rentBudget : 0;
    var score = 52;
    var strengths = [];
    var riskFactors = [];
    var categories = {};

    if (incomeRatio >= 3){
      score += 18;
      strengths.push({ category:'Income', label:'Income Strength', status:'Strong', text:'Your reported income appears to support your target rental range.' });
      categories.income = { label:'Income', state:'Looking Strong', level:'good', profile:'✓ Looks aligned', value: money(annualIncome) + ' annual income' };
    } else if (incomeRatio >= 2.5){
      score += 10;
      strengths.push({ category:'Income', label:'Income Range', status:'Positive Signal', text:'Your income appears close to a common rent-to-income range.' });
      riskFactors.push({ category:'Income', label:'Income-to-Rent Ratio', status:'Worth Checking', level:'warn', text:'Some properties use stricter income requirements. Confirm the exact rule before applying.', steps:['Ask whether the property uses gross or net income.', 'Compare your monthly income with the property rent requirement.', 'Prepare pay stubs or income documents before touring.'] });
      categories.income = { label:'Income', state:'Worth Checking', level:'warn', profile:'⚠ Confirm ratio', value: money(annualIncome) + ' annual income' };
    } else if (incomeRatio > 0){
      score -= 8;
      riskFactors.push({ category:'Income', label:'Income-to-Rent Ratio', status:'May Need Attention', level:'risk', text:'Your target rent may be high compared with reported income if the property uses a strict income multiple.', steps:['Ask the property for its exact income requirement.', 'Look for properties with flexible income criteria.', 'Prepare any additional income documentation that applies.'] });
      categories.income = { label:'Income', state:'May Need Attention', level:'risk', profile:'⚠ Ask before applying', value: money(annualIncome) + ' annual income' };
    } else {
      riskFactors.push({ category:'Income', label:'Income Details', status:'Not Yet Confirmed', level:'warn', text:'Income details were not available for this review. Confirm what the property requires before applying.', steps:['Ask for the property income requirement.', 'Gather recent income documents.', 'Compare the requirement with your monthly income.'] });
      categories.income = { label:'Income', state:'Not Yet Confirmed', level:'warn', profile:'⚠ Confirm criteria', value:'Not Yet Confirmed' };
    }

    var creditScore = answers.credit_score || '';
    var creditMap = { below_580:-18, '580_619':-12, '620_659':-6, '660_699':8, '700_739':12, '740_799':16, '800_plus':18 };
    score += creditMap[creditScore] || 0;
    if (['660_699','700_739','740_799','800_plus'].indexOf(creditScore) >= 0){
      strengths.push({ category:'Credit', label:'Credit Profile', status:'Positive Signal', text:'Your selected credit range may help you look more prepared at many properties.' });
      categories.credit = { label:'Credit Profile', state:'Looking Strong', level:'good', profile:'✓ Looks aligned', value: creditLabel(creditScore) };
    } else if (creditScore){
      riskFactors.push({ category:'Credit', label:'Credit Profile', status:'Worth Checking', level:'warn', text:'Credit-related information may receive extra attention at properties with stricter screening requirements.', steps:['Review your credit report for errors.', 'Ask the property how it reviews credit.', 'Prepare a short explanation for any credit items you already know about.'] });
      categories.credit = { label:'Credit Profile', state:'Worth Checking', level:'warn', profile:'⚠ Ask first', value: creditLabel(creditScore) };
    } else {
      riskFactors.push({ category:'Credit', label:'Credit Profile', status:'Not Yet Confirmed', level:'warn', text:'Credit details were not available in this review. Ask how the property handles credit before paying an application fee.', steps:['Ask whether there is a minimum credit standard.', 'Ask what happens when credit needs manual review.', 'Review your report before applying.'] });
      categories.credit = { label:'Credit Profile', state:'Not Yet Confirmed', level:'warn', profile:'⚠ Confirm criteria', value:'Not Yet Confirmed' };
    }

    if (answers.preferred_city){
      score += 3;
      strengths.push({ category:'Search', label:'Search Focus', status:'Clear', text:'You identified where you want to look, which makes comparing properties easier.' });
    }
    if (answers.move_timeline){
      score += answers.move_timeline === 'asap' ? 1 : 4;
      strengths.push({ category:'Timing', label:'Move Timing', status:'Known', text:'Your move timing is clear, so you can ask properties about availability with more confidence.' });
      categories.timing = { label:'Move Timing', state:'Confirmed', level:'good', profile:'✓ ' + formatTimeline(answers.move_timeline), value: formatTimeline(answers.move_timeline) };
    } else {
      categories.timing = { label:'Move Timing', state:'Not Yet Confirmed', level:'warn', profile:'⚠ Confirm timing', value:'Not Yet Confirmed' };
    }
    var bedsNeeded = Array.isArray(answers.beds_needed) ? answers.beds_needed : String(answers.beds_needed || '').split(',').filter(Boolean);
    if (bedsNeeded.length){
      strengths.push({ category:'Home Fit', label:'Home Needs', status:'Clear', text:'You selected the bedroom needs for your search, which helps you compare homes faster.' });
    }

    riskFactors.push({
      category:'Rental History',
      label:'Rental History',
      status:'Not Yet Confirmed',
      level:'warn',
      text:'Rental history details were not part of the available data. Have landlord or lease information ready in case it is requested.',
      steps:['Gather previous landlord contact information.', 'Keep current lease details nearby.', 'Ask whether the property requires rental references.']
    });
    categories.rentalHistory = { label:'Rental History', state:'Not Yet Confirmed', level:'warn', profile:'⚠ Ask first', value:'Not Yet Confirmed' };

    riskFactors.push({
      category:'Previous Housing Obligations',
      label:'Previous Housing Obligations',
      status:'Not Yet Confirmed',
      level:'warn',
      text:'Previous housing balances were not confirmed in the questionnaire data. Ask how the property reviews this before applying.',
      steps:['Ask how previous landlord balances are reviewed.', 'Confirm what is showing on any screening reports.', 'Prepare documentation for paid or disputed balances if applicable.']
    });
    categories.housingBalances = { label:'Previous Landlord Debt', state:'Not Yet Confirmed', level:'warn', profile:'⚠ Ask first', value:'Not Yet Confirmed' };

    score = Math.max(35, Math.min(92, Math.round(score)));
    var status = score >= 80 ? 'STRONG' : score >= 62 ? 'GOOD — WITH ITEMS TO CHECK' : 'NEEDS PREPARATION';
    var primaryRisk = riskFactors.find(function(item){ return item.level === 'risk'; }) || riskFactors[0];
    var supportedStrengths = strengths.length ? strengths : [{ category:'Profile', label:'Questionnaire Complete', status:'Complete', text:'Your answers gave RentReady enough context to create a practical preparation plan.' }];

    var recommendedDocuments = [
      { group:'Identity', items:['Government-issued ID'] },
      { group:'Income', items:['Recent pay stubs', 'Employment information', 'Additional income documentation if applicable'] },
      { group:'Rental History', items:['Previous landlord information', 'Current lease information', 'Rental references if requested'] },
      { group:'Other', items:['Property screening criteria', 'Balance documentation if applicable'] }
    ];

    var baseQuestions = [
      { tag:'Criteria', text:'Before I submit an application, can you provide your written rental screening criteria?' },
      { tag:'Income', text:'What income requirement do you use, and how is income calculated?' },
      { tag:'Housing Balance', text:'How does your screening criteria address balances owed to previous landlords?' },
      { tag:'Options', text:'Do you allow guarantors, co-signers, or conditional approval when applicable?' }
    ];
    var recommendedQuestions = baseQuestions.slice().sort(function(a, b){
      var priority = primaryRisk && /income/i.test(primaryRisk.category) ? 'Income' : primaryRisk && /obligations/i.test(primaryRisk.category) ? 'Housing Balance' : primaryRisk && /credit/i.test(primaryRisk.category) ? 'Criteria' : 'Criteria';
      return (a.tag === priority ? -1 : 0) - (b.tag === priority ? -1 : 0);
    });

    return {
      score: score,
      status: status,
      strengths: supportedStrengths,
      riskFactors: riskFactors,
      primaryRisk: primaryRisk,
      recommendedActions: primaryRisk ? primaryRisk.steps : [],
      recommendedDocuments: recommendedDocuments,
      recommendedQuestions: recommendedQuestions,
      readinessCategories: categories,
      propertyComparisonData: {
        annualIncome: annualIncome || 0,
        rentBudget: rentBudget || 0,
        monthlyIncome: monthlyIncome || 0,
        creditScore: creditScore,
        incomeRatio: incomeRatio || 0
      }
    };
  }

  var rentReadyProfile = createProfile(readAnswers());
  window.rentReadyProfile = rentReadyProfile;

  function renderSignalList(id, items, emptyText){
    var el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = items.length ? items.map(function(item){
      return '<li class="rr-signal"><div class="rr-signal-top"><div><div class="rr-signal-name">' + escapeHtml(item.label) + '</div><p>' + escapeHtml(item.text) + '</p></div><span class="rr-pill ' + statusClass(item.level) + '">' + escapeHtml(item.status) + '</span></div></li>';
    }).join('') : '<li class="rr-signal"><div class="rr-signal-name">' + escapeHtml(emptyText) + '</div></li>';
  }

  function renderReport(){
    var scoreValue = document.getElementById('scoreValue');
    var scoreStatus = document.getElementById('scoreStatus');
    var scoreSummary = document.getElementById('scoreSummary');
    var meterState = document.getElementById('meterState');
    var meterHeadline = document.getElementById('meterHeadline');
    var meterSummary = document.getElementById('meterSummary');
    var whyCopy = document.getElementById('whyCopy');
    var positiveCount = document.getElementById('positiveCount');
    var statusLevel = rentReadyProfile.score >= 80 ? 'good' : rentReadyProfile.score >= 62 ? 'warn' : 'risk';
    if (scoreValue) scoreValue.textContent = rentReadyProfile.score;
    if (scoreStatus){
      scoreStatus.textContent = rentReadyProfile.status;
      scoreStatus.className = 'rr-status-pill ' + statusClass(statusLevel);
    }
    if (scoreSummary) scoreSummary.textContent = 'You have ' + rentReadyProfile.strengths.length + ' positive signal' + (rentReadyProfile.strengths.length === 1 ? '' : 's') + ' working in your favor. We also found ' + rentReadyProfile.riskFactors.length + ' area' + (rentReadyProfile.riskFactors.length === 1 ? '' : 's') + ' worth checking before you spend money on applications.';
    if (meterState) meterState.textContent = rentReadyProfile.status;
    if (meterHeadline) meterHeadline.textContent = rentReadyProfile.score >= 80 ? 'Your profile is looking strong.' : rentReadyProfile.score >= 62 ? 'Your profile has strengths.' : 'Your profile needs preparation before applying.';
    if (meterSummary) meterSummary.textContent = 'Before applying, there are ' + rentReadyProfile.riskFactors.length + ' area' + (rentReadyProfile.riskFactors.length === 1 ? '' : 's') + ' we recommend confirming.';
    if (whyCopy) whyCopy.textContent = 'Your answers indicate that ' + rentReadyProfile.riskFactors.map(function(item){ return item.category.toLowerCase(); }).join(', ') + ' may receive additional attention at properties with stricter screening requirements.';

    renderSignalList('strengthList', rentReadyProfile.strengths, 'No confirmed positive signals yet.');
    renderSignalList('riskList', rentReadyProfile.riskFactors, 'No closer-look items found.');

    var achievementGrid = document.getElementById('achievementGrid');
    if (achievementGrid){
      achievementGrid.innerHTML = rentReadyProfile.strengths.map(function(item){
        return '<article class="rr-achievement"><span>' + escapeHtml(item.category) + '</span><strong>✓ ' + escapeHtml(item.status) + '</strong><p>' + escapeHtml(item.label) + '</p></article>';
      }).join('');
    }
    if (positiveCount) positiveCount.textContent = rentReadyProfile.strengths.length + ' positive signal' + (rentReadyProfile.strengths.length === 1 ? ' found.' : 's found.');

    var radarList = document.getElementById('radarList');
    if (radarList){
      var categories = Object.keys(rentReadyProfile.readinessCategories).map(function(key){ return rentReadyProfile.readinessCategories[key]; });
      radarList.innerHTML = categories.map(function(item){
        var icon = item.level === 'good' ? '🟢' : item.level === 'risk' ? '🔴' : '🟡';
        return '<li class="rr-radar-item"><div><div class="rr-radar-name">' + escapeHtml(item.label) + '</div><p class="rr-radar-copy">' + escapeHtml(item.state) + '</p></div><span>' + icon + '</span></li>';
      }).join('');
    }

    if (rentReadyProfile.primaryRisk){
      document.getElementById('primaryRiskName').textContent = rentReadyProfile.primaryRisk.label;
      document.getElementById('primaryRiskWhy').textContent = rentReadyProfile.primaryRisk.text;
      document.getElementById('primaryRiskSteps').innerHTML = rentReadyProfile.primaryRisk.steps.map(function(step){ return '<li>' + escapeHtml(step) + '</li>'; }).join('');
      document.getElementById('verifyCopy').textContent = rentReadyProfile.primaryRisk.text;
    }

    renderFolder();
    renderQuestions();
    updateComparison();
  }

  function folderState(){
    try { return JSON.parse(localStorage.getItem(FOLDER_STORAGE_KEY) || '{}') || {}; }
    catch (err) { return {}; }
  }

  function renderFolder(){
    var el = document.getElementById('folderChecklist');
    if (!el) return;
    var saved = folderState();
    el.innerHTML = rentReadyProfile.recommendedDocuments.map(function(group){
      return '<article class="rr-panel"><h3>' + escapeHtml(group.group) + '</h3><ul class="rr-doc-list">' + group.items.map(function(item){
        var key = group.group + ':' + item;
        return '<li class="rr-doc-item"><label><input type="checkbox" data-doc-key="' + escapeHtml(key) + '"' + (saved[key] ? ' checked' : '') + '> <span>' + escapeHtml(item) + '</span></label></li>';
      }).join('') + '</ul></article>';
    }).join('');
    updateFolderProgress();
    el.querySelectorAll('input[type="checkbox"]').forEach(function(box){
      box.addEventListener('change', function(){
        var state = folderState();
        state[box.dataset.docKey] = box.checked;
        localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(state));
        updateFolderProgress();
      });
    });
  }

  function updateFolderProgress(){
    var boxes = document.querySelectorAll('[data-doc-key]');
    var checked = document.querySelectorAll('[data-doc-key]:checked').length;
    var pct = boxes.length ? Math.round((checked / boxes.length) * 100) : 0;
    var pctEl = document.getElementById('folderPct');
    var fill = document.getElementById('folderFill');
    var success = document.getElementById('folderSuccess');
    if (pctEl) pctEl.textContent = pct + '%';
    if (fill) fill.style.width = pct + '%';
    if (success) success.classList.toggle('is-visible', pct === 100);
  }

  function renderQuestions(){
    var el = document.getElementById('questionList');
    if (!el) return;
    el.innerHTML = rentReadyProfile.recommendedQuestions.map(function(q, index){
      return '<article class="rr-question-card"><div><p class="rr-eyebrow">Question ' + (index + 1) + ' — ' + escapeHtml(q.tag) + '</p><p>' + escapeHtml(q.text) + '</p></div><button class="rr-copy-btn" type="button" data-copy="' + escapeHtml(q.text) + '">Copy Question</button></article>';
    }).join('');
  }

  function copyText(text, button){
    function done(){
      var old = button.textContent;
      button.textContent = 'Copied ✓';
      setTimeout(function(){ button.textContent = old; }, 1400);
    }
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done).catch(done);
    } else {
      done();
    }
  }

  function comparisonRow(label, property, profile, level){
    return '<div class="rr-compare-row"><strong>' + escapeHtml(label) + '</strong><span>Property: ' + escapeHtml(property) + '</span><span class="' + statusClass(level) + '">' + escapeHtml(profile) + '</span></div>';
  }

  function updateComparison(){
    var results = document.getElementById('compareResults');
    var summary = document.getElementById('compareSummary');
    if (!results || !summary) return;
    var rent = Number((document.getElementById('propertyRent') || {}).value);
    var req = (document.getElementById('incomeRequirement') || {}).value || 'unknown';
    var history = (document.getElementById('historyRequirement') || {}).value || 'unknown';
    var balance = (document.getElementById('balancePolicy') || {}).value || 'unknown';
    var creditNotes = ((document.getElementById('creditNotes') || {}).value || '').trim();
    var aligned = 0;
    var confirm = 0;

    var incomeProperty = req === 'unknown' ? 'Confirm criteria' : req + '× rent';
    var incomeProfile = '⚠ Confirm criteria';
    var incomeLevel = 'warn';
    if (rent > 0 && req !== 'unknown' && rentReadyProfile.propertyComparisonData.monthlyIncome){
      var needed = rent * Number(req);
      if (rentReadyProfile.propertyComparisonData.monthlyIncome >= needed){
        incomeProfile = '✓ Looks aligned';
        incomeLevel = 'good';
        aligned++;
      } else {
        incomeProfile = '⚠ May need attention';
        incomeLevel = 'risk';
        confirm++;
      }
    } else {
      confirm++;
    }

    var historyProfile = history === 'unknown' ? '⚠ Ask first' : '⚠ Confirm details';
    var balanceProfile = balance === 'unknown' ? '⚠ Ask first' : balance === 'strict' ? '⚠ May need attention' : '✓ Policy may be flexible';
    var balanceLevel = balance === 'strict' ? 'risk' : balance === 'unknown' ? 'warn' : 'good';
    if (balanceLevel === 'good') aligned++; else confirm++;
    confirm += history === 'unknown' ? 1 : 1;

    var creditProfile = creditNotes ? '⚠ Compare with your credit range' : (rentReadyProfile.readinessCategories.credit && rentReadyProfile.readinessCategories.credit.profile) || '⚠ Ask first';
    confirm++;

    results.innerHTML =
      comparisonRow('Income', incomeProperty, incomeProfile, incomeLevel) +
      comparisonRow('Rental History', history === 'unknown' ? 'Confirm criteria' : history + ' months', historyProfile, 'warn') +
      comparisonRow('Credit', creditNotes ? creditNotes : 'Confirm criteria', creditProfile, 'warn') +
      comparisonRow('Previous Landlord Debt', balance === 'unknown' ? 'Confirm criteria' : balance.replace(/_/g, ' '), balanceProfile, balanceLevel);
    summary.textContent = aligned + ' area' + (aligned === 1 ? '' : 's') + ' look aligned ✓ ' + confirm + ' thing' + (confirm === 1 ? '' : 's') + ' to confirm before applying.';
  }

  var phrases = [
    { at: 0,  text: 'Pulling credit signals' },
    { at: 28, text: 'Checking rental history' },
    { at: 55, text: 'Verifying income data' },
    { at: 80, text: 'Calculating deposit risk' }
  ];

  var duration = 3000; // ms
  var start = null;
  var done = false;
  var raf = null;

  function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

  function setPercent(p){
    var shown = Math.round(p);
    percentText.innerHTML = shown + '<span>%</span>';
    barFill.style.width = p + '%';
    var current = phrases[0].text;
    for (var i = 0; i < phrases.length; i++){
      if (p >= phrases[i].at) current = phrases[i].text;
    }
    if (phraseText.textContent !== current){
      phraseText.style.opacity = '0';
      setTimeout(function(){
        phraseText.textContent = current;
        phraseText.style.opacity = '1';
      }, 140);
    }
  }

  function finish(){
    if (done) return;
    done = true;
    if (raf) cancelAnimationFrame(raf);
    setPercent(100);
    statusText.textContent = 'Scan complete';

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced){
      stage.classList.add('is-done');
      stage.setAttribute('aria-hidden', 'true');
      report.classList.add('is-revealed');
      report.removeAttribute('aria-hidden');
      document.body.classList.add('report-mode');
      if (needle) needle.style.transform = 'rotate(' + Math.round((rentReadyProfile.score / 100) * 180 - 90) + 'deg)';
      return;
    }

    setTimeout(function(){
      stage.classList.add('is-done');
      stage.setAttribute('aria-hidden', 'true');
    }, 220);
    setTimeout(function(){
      report.classList.add('is-revealed');
      report.removeAttribute('aria-hidden');
      document.body.classList.add('report-mode');
    }, 520);
    setTimeout(function(){
      if (needle) needle.style.transform = 'rotate(' + Math.round((rentReadyProfile.score / 100) * 180 - 90) + 'deg)';
    }, 1020);
  }

  function tick(ts){
    if (start === null) start = ts;
    var elapsed = ts - start;
    var t = Math.min(elapsed / duration, 1);
    var eased = easeOutCubic(t);
    setPercent(eased * 100);
    if (t < 1){
      raf = requestAnimationFrame(tick);
    } else {
      finish();
    }
  }

  async function boot(){
    var allowed = await confirmResultsAccess();
    if (!allowed) {
      denyResultsAccess();
      return;
    }

    if (reportPreview){
      done = true;
      stage.classList.add('is-done');
      stage.setAttribute('aria-hidden', 'true');
      report.classList.add('is-revealed');
      report.removeAttribute('aria-hidden');
      document.body.classList.add('report-mode');
      if (needle) needle.style.transform = 'rotate(' + Math.round((rentReadyProfile.score / 100) * 180 - 90) + 'deg)';
    } else if (loaderPreviewComplete){
      document.documentElement.classList.add('loader-preview-complete');
      loaderEl.classList.add('is-complete');
      setPercent(100);
      statusText.textContent = 'Scan complete';
      phraseText.textContent = 'Calculating deposit risk';
    } else if (reduced){
      finish();
    } else {
      raf = requestAnimationFrame(tick);
    }

    skipBtn.addEventListener('click', finish);
    stage.addEventListener('click', function(e){
      if (e.target === skipBtn) return;
      finish();
    });

    buildBriefResult();

    var scrollCue = document.querySelector('.scroll-cue');
    function updateScrollCue(){
      if (!scrollCue) return;
      scrollCue.classList.toggle('is-hidden', window.scrollY > 80);
    }
    updateScrollCue();
    window.addEventListener('scroll', updateScrollCue, { passive: true });

    document.addEventListener('click', function(e){
      var scrollButton = e.target.closest('[data-target]');
      if (scrollButton){
        var target = document.getElementById(scrollButton.dataset.target);
        if (target) target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      }
      var copyButton = e.target.closest('[data-copy]');
      if (copyButton) copyText(copyButton.dataset.copy, copyButton);
    });

    var whyToggle = document.getElementById('whyToggle');
    if (whyToggle){
      whyToggle.addEventListener('click', function(){
        var box = document.getElementById('whyBox');
        var open = box.classList.toggle('is-open');
        whyToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    ['propertyName','propertyRent','incomeRequirement','historyRequirement','creditNotes','balancePolicy','cosignerPolicy'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', updateComparison);
      if (el) el.addEventListener('change', updateComparison);
    });
  }

  boot();
})();
