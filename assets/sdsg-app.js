/* ============================================================
   SDSG Unified Athlete App — shared logic
   Driven by window.SDSG_CONFIG (set inline per athlete page).
   Tabs: Log · Program · Progress · Scouting.
   No login — anonymous Supabase writes (publishable key), same
   contract as the legacy trackers. Persistence logic ported
   verbatim from the proven tonnie tracker.
   ============================================================ */
(function(){
'use strict';

var CFG = window.SDSG_CONFIG || {};
var ATHLETES = CFG.athletes || {};
var DUAL = !!CFG.dual;
var cur = CFG.defaultAthlete || Object.keys(ATHLETES)[0];
function A(){ return ATHLETES[cur]; }            // active athlete object
function slug(){ return A().slug; }

// === CANONICAL SUPABASE BLOCK · DO NOT REMOVE OR REPLACE WITH localStorage ===
// Persistence layer for public.sdsg_logs. See /CONTRIBUTING.md before editing.
// Relocated to the shared app; logic is byte-equivalent to the legacy trackers.
var SUPABASE_URL = 'https://qfprpepqzckymbijeexw.supabase.co';
var SUPABASE_KEY = 'sb_publishable_SSGUga1zczVXmn3OZfZvwQ_VVU1IjPv';
var COMP_DATE   = new Date('2026-09-27T00:00:00');
var BLOCK_START = new Date('2026-05-11T00:00:00');

async function sbFetch(path, opts){
  opts = opts || {};
  var url = SUPABASE_URL + '/rest/v1' + path;
  var headers = Object.assign({
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  }, opts.headers || {});
  var res = await fetch(url, Object.assign({}, opts, {headers: headers}));
  if(!res.ok){ throw new Error('Supabase ' + res.status + ': ' + (await res.text())); }
  var ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}
async function loadLogs(athleteSlug){
  var data = await sbFetch('/sdsg_logs?athlete_slug=eq.'+athleteSlug+'&select=*&order=log_date.asc,created_at.asc');
  return data.map(function(r){ return {event:r.event, value:r.value, date:r.log_date, note:r.note||'', id:r.id}; });
}
async function insertLog(athleteSlug, event, value, date, note){
  var body = JSON.stringify([{athlete_slug:athleteSlug, event:event, value:String(value), log_date:date, note:note||null}]);
  var res = await sbFetch('/sdsg_logs', {method:'POST', body:body});
  return res && res[0];
}
async function deleteAllLogs(athleteSlug){
  await sbFetch('/sdsg_logs?athlete_slug=eq.'+athleteSlug, {method:'DELETE'});
}
async function ensureBaselines(athleteSlug){
  // Idempotent delta-seed. Inserts any config baseline not already present
  // in the DB (matched by event + log_date + value). This way, baselines
  // added to an athlete's config AFTER initial seeding still get written.
  var bls = A().baselines || [];
  if(!bls.length) return;
  var have = {};
  cachedLogs.forEach(function(l){ have[l.event+'|'+l.date+'|'+String(l.value)] = true; });
  var missing = bls.filter(function(b){ return !have[b.event+'|'+b.date+'|'+String(b.value)]; });
  if(!missing.length) return;
  setSyncStatus('syncing','Seeding');
  var rows = missing.map(function(b){ return {athlete_slug:athleteSlug, event:b.event, value:String(b.value), log_date:b.date, note:b.note||null}; });
  await sbFetch('/sdsg_logs', {method:'POST', body:JSON.stringify(rows)});
  cachedLogs = await loadLogs(athleteSlug);
}
async function deleteLog(id){
  if(!id) return;
  await sbFetch('/sdsg_logs?id=eq.'+encodeURIComponent(id), {method:'DELETE'});
  cachedLogs = cachedLogs.filter(function(l){ return l.id !== id; });
}
// === END CANONICAL SUPABASE BLOCK ===

// === EVENT MODEL (identical to legacy trackers) ===
var EVENTS = {
  prowler:   {name:'Prowler Push',           unit:'time',  lowerBetter:true},
  kbsquat:   {name:'KB Box Squat',           unit:'reps',  lowerBetter:false},
  dynamax:   {name:'Dynamax Overhead Throw', unit:'inches',lowerBetter:false},
  bench:     {name:'Bench Press',            unit:'reps',  lowerBetter:false},
  hang:      {name:'Overhead Arm Hang',      unit:'time',  lowerBetter:false},
  slams:     {name:'Med Ball Slams',         unit:'reps',  lowerBetter:false},
  jumprope:  {name:'Jump Rope (60s)',        unit:'reps',  lowerBetter:false},
  broadjump: {name:'Standing Broad Jump',    unit:'inches',lowerBetter:false},
  row:       {name:'Concept Row 500m',       unit:'time',  lowerBetter:true},
  shuttle:   {name:'300 Yd Shuttle Run',     unit:'time',  lowerBetter:true}
};
// === ALL-TIME RECORD BOOK ============================================
// Source: FitnessQuest10 Masters 50+ "Commissioners' Record Book" (2019–2025),
// released by the San Diego Senior Games Association. Each entry is
//   [value, holder(s), year]  (+ test weight as a 4th element for kbsquat/bench)
// stored in the event's natively-recorded unit:
//   time events  → "M:SS" / "M:SS.dd"   ·  dynamax → FEET (app logs inches → ×12)
//   broadjump    → inches               ·  reps events → reps
// G = gender ('W'/'M'); band keys match the per-athlete config `ageBand`.
var RECORDS = {
  prowler: {
    W:{'50-54':['0:12.00','DeHart, Rachel',2025],'55-59':['0:12.81','Hyacinth, Flora',2022],'60-64':['0:15.00','Howell, Karen',2025],'65-69':['0:15.00','Daigle, Nancy',2025],'70-74':['0:16.38','Matthews, Brenda Steele',2023],'75-79':['0:23.58','Petrie, Marlene',2023],'80-84':['0:21.12','Walker, Sandra',2021],'85-89':['0:34.00','Walker, Sandra',2025]},
    M:{'50-54':['0:11.40','DeHart, John',2024],'55-59':['0:12.81','Surprenant, Mike',2022],'60-64':['0:13.15','Sitzer, Matthew',2021],'65-69':['0:13.54','Navarro, David',2022],'70-74':['0:14.88','Roberts, Byron',2022],'75-79':['0:16.95','Williams, Stan',2023],'80-84':['0:17.06','Sepin, Arthur',2023],'85-89':['0:18.22','Sepin, Arthur',2024],'90-94':['0:30.26','Walker, Stafford',2023],'95-99':['1:33.00','Schneider, Ronald',2025]}
  },
  kbsquat: {
    W:{'50-54':['62','Hays Morena, Jennifer',2025,'20 kg'],'55-59':['70','Reyes-Williamson, Margarita',2023,'20 kg'],'60-64':['150','Murray, Rowena',2022,'16 kg'],'65-69':['82','Daigle, Nancy',2025,'16 kg'],'70-74':['70','Paine, Constance',2022,'12 kg'],'75-79':['50','Hazard, Gail',2023,'12 kg'],'80-84':['60','Nicholson, Catherine',2025,'8 kg']},
    M:{'50-54':['125','Fine, Justin',2022,'24 kg'],'55-59':['90','Surprenant, Mike',2022,'24 kg'],'60-64':['90','Butsumyo, Vince',2022,'20 kg'],'65-69':['86','Lawrence, Kirk',2023,'20 kg'],'70-74':['70','Moylan, Jerome',2025,'16 kg'],'75-79':['81','Bridges, John',2025,'16 kg'],'80-84':['61','Scott, Cliff',2023,'12 kg'],'85-89':['48','Scott, Cliff',2025,'12 kg']}
  },
  dynamax: {
    W:{'50-54':['39.4','Reyes-Williamson, Margarita',2021],'55-59':['43.3','Hyacinth, Flora',2022],'60-64':['35.1','Cummings, Kirsten',2024],'65-69':['32.9','Halstead, Paula',2023],'70-74':['29','Halstead, Paula',2024],'75-79':['20.2','Petrie, Marlene',2023],'80-84':['24.7','Nicholson, Catherine',2023]},
    M:{'50-54':['45.6','Porter, Rod',2021],'55-59':['43','Snowden, Gregg',2024],'60-64':['42.8','Southwick, Jeff',2021],'65-69':['38.6','Hrenko, Ray',2021],'70-74':['35.8','Doyle, William',2021],'75-79':['28.9','Stanton, Edward',2022],'80-84':['27.1','Sepin, Arthur',2022],'85-89':['24.5','Sepin, Arthur',2025],'90-94':['10','Walker, Stafford',2023],'95-99':['7.6','Schneider, Ronald',2025]}
  },
  bench: {
    W:{'50-54':['65','Leano, Alma',2021,'55 lb'],'55-59':['51','Hesser, Michele',2021,'55 lb'],'60-64':['47','Williams, Tonya Davis',2023,'50 lb'],'65-69':['50','Dahl, Tonnie',2025,'50 lb'],'70-74':['46','Clark, Melia',2022,'45 lb'],'75-79':['76','Petrie, Marlene',2023,'45 lb'],'80-84':['50','Nicholson, Catherine',2023,'40 lb'],'85-89':['19','Walker, Sandra',2025,'40 lb']},
    M:{'50-54':['64','DeHart, John',2025,'115 lb'],'55-59':['49','Surprenant, Mike',2022,'115 lb'],'60-64':['61','Sitzer, M. · Thomas, W. · Harris, O.',2023,'95 lb'],'65-69':['55','Wallace, Mark',2025,'95 lb'],'70-74':['68','Linder, Gary',2025,'75 lb'],'75-79':['42','Edwards, Stanton',2023,'75 lb'],'80-84':['91','Sepin, Arthur',2023,'55 lb'],'85-89':['75','Sepin, Arthur',2025,'55 lb'],'90-94':['29','Walker, Stafford',2025,'50 lb'],'95-99':['9','Schneider, Ronald',2025,'50 lb']}
  },
  hang: {
    W:{'50-54':['2:07','Kim, Lee Ann',2023],'55-59':['3:08','Lyda-Savich, Dianna',2023],'60-64':['3:01','Amaral, Joan',2023],'65-69':['2:41','Greenwood, Karilyn',2023],'70-74':['2:30','Paine, Constance',2023],'75-79':['2:47','Hazard, Gail',2023],'80-84':['1:27','Carraway, Kristine',2025],'85-89':['1:16','Walker, Sandra',2025]},
    M:{'50-54':['2:34','Porter, Rod',2021],'55-59':['2:47','Sasso, Paul',2021],'60-64':['6:00','Kaplan, Jim',2023],'65-69':['3:43','Hemme, Jerry',2023],'70-74':['4:33','Hemme, Jerry',2025],'75-79':['2:24','Rhodes, Oliver',2025],'80-84':['4:25','Holbrook, John',2023],'85-89':['1:33','Scott, Cliff',2025],'90-94':['0:19','Walker, Stafford',2023]}
  },
  slams: {
    W:{'50-54':['53','Tyrrell, Laurie',2022],'55-59':['53','Southwick, Cheri',2021],'60-64':['58','Southwick, Cheri',2022],'65-69':['48','Dahl, T. · Greenwood, K.',2024],'70-74':['49','Halstead, Paula',2024],'75-79':['29','Sheridan, Suzanne',2025],'80-84':['34','Nicholson, Catherine',2024]},
    M:{'50-54':['60','Porter, Rod',2019],'55-59':['58','Snowden, Gregg',2024],'60-64':['64','Hrenko, Ray',2019],'65-69':['51','Lawrence, Kirk',2024],'70-74':['48','Doyle, William',2023],'75-79':['44','Williams, Stan',2025],'80-84':['38','Owen, James',2024],'85-89':['27','McAleenan, Michael',2023],'90-94':['22','Schneider, Ronald',2024],'95-99':['15','Schneider, Ronald',2025]}
  },
  jumprope: {
    W:{'50-54':['171','Kim, Lee Ann',2023],'55-59':['226','Sterger, Tara',2025],'60-64':['175','Murray, Rowena',2023],'65-69':['189','Murray, Rowena',2024],'70-74':['152','Halstead, Paula',2024],'75-79':['124','Walker, Sandra',2019],'80-84':['133','Walker, Sandra',2021]},
    M:{'50-54':['217','Kumar, Akash',2024],'55-59':['183','Vonk, Eric',2024],'60-64':['201','Butsumyo, Vince',2024],'65-69':['197','Lawrence, Kirk',2024],'70-74':['168','Pittman, Patrick',2025],'75-79':['149','Rhodes, Oliver',2025],'80-84':['87','Kim, Yong',2023]}
  },
  broadjump: {
    W:{'50-54':['65','Hallmark, A. · Kim, L. · De Ley, I.',2023],'55-59':['96.2','Hyacinth, Flora',2022],'60-64':['76','Howell, Karen',2025],'65-69':['71','Halstead, P. · Singleton, D.',2025],'70-74':['54','Matthews, Brenda Steele',2023],'75-79':['48','Sheridan, Suzanne',2025],'80-84':['50','Nicholson, Catherine',2025]},
    M:{'50-54':['95.5','Rogers, Ryan',2022],'55-59':['99','Hightower, Lloyd',2025],'60-64':['92','Butsumyo, Vince',2023],'65-69':['74','Lawrence, Kirk',2023],'70-74':['72','Roberts, Byron',2023],'75-79':['72.5','Gast, Monte',2022],'80-84':['58','Kim, Yong',2023],'85-89':['37','Sepin, Arthur',2025]}
  },
  row: {
    W:{'50-54':['1:52','Reyes-Williamson, M. · Hayes, K.',2025],'55-59':['1:48','White, Tracy',2022],'60-64':['1:47','Towne, Diane',2024],'65-69':['1:54','Daigle, Nancy',2024],'70-74':['1:59','Harris, Sharon',2021],'75-79':['2:19','Petrie, Marlene',2023],'80-84':['2:30','Walker, Sandra',2021],'85-89':['2:37','Walker, Sandra',2025]},
    M:{'50-54':['1:28','Higgins, Matt',2023],'55-59':['1:36','Sasso, Paul',2021],'60-64':['1:34','Sitzer, Matthew',2021],'65-69':['1:39','Goldman, Danny',2022],'70-74':['1:48','Roberts, Byron',2022],'75-79':['1:54','Bridges, John',2025],'80-84':['2:04','Holbrook, J. · Christison, R.',2025],'90-94':['3:05','Schneider, Ronald',2024],'95-99':['3:22','Schneider, Ronald',2025]}
  },
  shuttle: {
    W:{'50-54':['1:08','Parsons, Natalie',2019],'55-59':['1:02','Hyacinth, Flora',2022],'60-64':['1:12','Murray, R. · Howell, K.',2025],'65-69':['1:13','Murray, Rowena',2024],'70-74':['1:24','Halstead, Paula',2024],'75-79':['1:47','Sheridan, Suzanne',2025],'80-84':['1:46','Nicholson, Catherine',2024]},
    M:{'50-54':['0:53','Porter, Rod',2022],'55-59':['0:59','Hightower, Lloyd',2025],'60-64':['0:59','Butsumyo, Vince',2024],'65-69':['1:04','Hrenko, Ray',2021],'70-74':['1:08','Hemme, Jerry',2024],'75-79':['1:10','Rose, Ed',2024],'80-84':['1:53','Kim, Yong',2023],'90-94':['3:16','Schneider, Ronald',2024]}
  }
};
// Known Senior Games competition dates → label for the Progress history badge (B5).
var COMP_DATES = {'2025-09-21':'2025 Senior Games', '2026-09-27':'2026 Senior Games'};
var EVENT_ORDER = (function(){
  // Product requirement: Prowler Push is always displayed last, regardless of the
  // per-athlete eventOrder. This deliberate override is documented here (B7).
  var arr = (CFG.eventOrder || ['prowler','kbsquat','dynamax','bench','hang','slams','jumprope','broadjump','row','shuttle']).slice();
  var i = arr.indexOf('prowler');
  if(i>-1){ arr.splice(i,1); arr.push('prowler'); }
  return arr;
})();

var TIMER_CONFIG = {
  prowler:  {type:'countup',   label:'Push Timer'},
  hang:     {type:'countup',   label:'Hang Timer'},
  row:      {type:'countup',   label:'500m Timer'},
  shuttle:  {type:'countup',   label:'300yd Timer'},
  slams:    {type:'countdown', seconds:60, label:'60s Slams'},
  jumprope: {type:'countdown', seconds:60, label:'60s Rope'}
};

var cachedLogs = [];
var currentView = 'dashboard';
var _timerState = {};
var _programCache = null;
var _loadToken = 0;   // guards against stale async loads clobbering a newer one (B4, D3)

// ===== TIMER (ported verbatim, with 10-sec prep) =====
function _timerEl(ev, part){ return document.getElementById('tmr_'+part+'_'+ev); }
function _formatTimerSec(s){ var m=Math.floor(s/60), sec=s%60; return m+':'+(sec<10?'0':'')+sec; }
function _beep(){
  try{
    var ctx = window._audioCtx || (window._audioCtx = new (window.AudioContext||window.webkitAudioContext)());
    if(ctx.state==='suspended') ctx.resume();
    for(var i=0;i<3;i++){
      var osc=ctx.createOscillator(), gain=ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value=880;
      gain.gain.setValueAtTime(0, ctx.currentTime+i*0.25);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime+i*0.25+0.01);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime+i*0.25+0.18);
      osc.start(ctx.currentTime+i*0.25); osc.stop(ctx.currentTime+i*0.25+0.2);
    }
  }catch(e){}
}
function _beepShort(){
  try{
    var ctx = window._audioCtx || (window._audioCtx = new (window.AudioContext||window.webkitAudioContext)());
    if(ctx.state==='suspended') ctx.resume();
    var osc=ctx.createOscillator(), gain=ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value=520;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime+0.01);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime+0.10);
    osc.start(); osc.stop(ctx.currentTime+0.12);
  }catch(e){}
}
function startTimer(ev){
  var cfg=TIMER_CONFIG[ev]; if(!cfg) return;
  var state=_timerState[ev]=_timerState[ev]||{};
  if(state.intervalId) return;
  var block=_timerEl(ev,'block');
  var lbl=block?block.querySelector('.t-label'):null;
  var disp=_timerEl(ev,'display');
  if(block){ block.classList.remove('warn','done','prep'); }
  var PREP_SEC=10;
  var anchorMs=Date.now();
  var baseElapsed=state.elapsed||0;
  if(cfg.type!=='countup' && state.remaining==null) state.remaining=cfg.seconds;
  var baseRemaining=state.remaining;
  state.phase='prep'; state.mainAnchor=0; state._lastPrepBeep=-1;
  if(block) block.classList.add('prep');
  if(lbl) lbl.textContent='Get Ready';
  if(disp) disp.textContent='0:'+String(PREP_SEC).padStart(2,'0');
  state.intervalId=setInterval(function(){
    if(state.phase==='prep'){
      var remain=PREP_SEC-Math.floor((Date.now()-anchorMs)/1000);
      if(remain<=0){
        state.phase='main'; state.mainAnchor=Date.now();
        if(block) block.classList.remove('prep');
        if(lbl) lbl.textContent=cfg.label;
        _beep(); return;
      }
      if(disp) disp.textContent='0:'+String(remain).padStart(2,'0');
      if(remain<=3 && remain!==state._lastPrepBeep){ state._lastPrepBeep=remain; _beepShort(); }
    } else {
      var secs=Math.floor((Date.now()-state.mainAnchor)/1000);
      if(cfg.type==='countup'){
        state.elapsed=baseElapsed+secs;
        if(disp) disp.textContent=_formatTimerSec(state.elapsed);
      } else {
        state.remaining=Math.max(0,baseRemaining-secs);
        if(disp) disp.textContent=_formatTimerSec(state.remaining);
        if(block){
          if(state.remaining<=10 && state.remaining>0) block.classList.add('warn');
          if(state.remaining===0){ block.classList.remove('warn'); block.classList.add('done'); _beep(); stopTimer(ev); }
        }
      }
    }
  },250);
  var sb=_timerEl(ev,'start'), pb=_timerEl(ev,'stop');
  if(sb) sb.style.display='none';
  if(pb) pb.style.display='inline-block';
}
function stopTimer(ev){
  var state=_timerState[ev]; if(!state) return;
  if(state.intervalId){ clearInterval(state.intervalId); state.intervalId=null; }
  var cfg=TIMER_CONFIG[ev];
  var b=_timerEl(ev,'block');
  if(b){ b.classList.remove('prep'); var lbl=b.querySelector('.t-label'); if(lbl&&cfg) lbl.textContent=cfg.label; }
  if(state.phase==='prep' && cfg){
    if(cfg.type==='countup'){ state.elapsed=0; } else { state.remaining=cfg.seconds; }
    var disp=_timerEl(ev,'display');
    if(disp) disp.textContent=_formatTimerSec(cfg.type==='countup'?0:cfg.seconds);
  }
  state.phase=null;
  var sb=_timerEl(ev,'start'), pb=_timerEl(ev,'stop');
  if(sb) sb.style.display='inline-block';
  if(pb) pb.style.display='none';
}
function resetTimer(ev){
  stopTimer(ev);
  var cfg=TIMER_CONFIG[ev]; if(!cfg) return;
  var state=_timerState[ev]=_timerState[ev]||{};
  state.phase=null;
  if(cfg.type==='countup'){ state.elapsed=0; } else { state.remaining=cfg.seconds; }
  var disp=_timerEl(ev,'display');
  if(disp) disp.textContent=_formatTimerSec(cfg.type==='countup'?0:cfg.seconds);
  var b=_timerEl(ev,'block');
  if(b){ b.classList.remove('warn','done','prep'); var lbl=b.querySelector('.t-label'); if(lbl) lbl.textContent=cfg.label; }
}
function _renderTimerBlock(ev){
  var cfg=TIMER_CONFIG[ev]; if(!cfg) return '';
  var initSec=cfg.type==='countup'?0:cfg.seconds;
  return '<div class="timer-block" id="tmr_block_'+ev+'">'+
    '<span class="t-label">'+cfg.label+'</span>'+
    '<span class="t-display" id="tmr_display_'+ev+'">'+_formatTimerSec(initSec)+'</span>'+
    '<button class="timer-btn" id="tmr_start_'+ev+'" onclick="SDSG.startTimer(\''+ev+'\')">Start</button>'+
    '<button class="timer-btn stop" id="tmr_stop_'+ev+'" onclick="SDSG.stopTimer(\''+ev+'\')" style="display:none">Stop</button>'+
    '<button class="timer-btn reset" id="tmr_reset_'+ev+'" onclick="SDSG.resetTimer(\''+ev+'\')">Reset</button>'+
  '</div>';
}

// ===== Per-pattern timer (Program tab) =====
// If a prescribed pattern is for time, surface a timer right on the pattern card.
// Detection: a "work" duration in seconds/minutes (rest/between segments are
// skipped), or a "for time / hold for time / max ... time" stopwatch.
function _patternTimerCfg(rxRaw){
  if(!rxRaw) return null;
  var rx = String(rxRaw);
  var workMatchers = [
    /×\s*(\d+)\s*sec\b/i,                                              // "× 60 sec"
    /\bin\s+(\d+)\s*sec\b/i,                                           // "max reps in 60 sec"
    /\b(\d+)\s*sec\s+(?:hold|hard|easy|walk|steady|work|max)\b/i,      // "120 sec hold", "30 sec hard"
    /×\s*(\d+)\s*min\b/i,
    /\b(\d+)\s*min\s+(?:hold|max|work)\b/i
  ];
  for(var i=0;i<workMatchers.length;i++){
    var m=rx.match(workMatchers[i]);
    if(m){
      var n=parseInt(m[1],10);
      if(workMatchers[i].source.indexOf('min')>=0) n*=60;
      if(n>0 && n<=3600) return {type:'countdown', seconds:n};
    }
  }
  if(/\bfor\s+time\b|\bhold\s+for\s+time\b|\bmax\s+\w+\s+time\b/i.test(rx)) return {type:'countup'};
  return null;
}
var _progTimerState = {};
var _progTimerCfgs  = {};
function _ptEl(k, part){ return document.getElementById('ptmr_'+part+'_'+k); }
function _renderProgPatternTimer(k, cfg){
  var initSec = cfg.type==='countup' ? 0 : cfg.seconds;
  var lbl = cfg.type==='countup' ? 'Stopwatch' : (cfg.seconds+'s Timer');
  return '<div class="pt-timer" id="ptmr_block_'+k+'">'+
    '<span class="pt-label">'+lbl+'</span>'+
    '<span class="pt-display" id="ptmr_display_'+k+'">'+_formatTimerSec(initSec)+'</span>'+
    '<button class="pt-btn" id="ptmr_start_'+k+'" onclick="SDSG.startProgTimer(\''+k+'\')">Start</button>'+
    '<button class="pt-btn stop" id="ptmr_stop_'+k+'" onclick="SDSG.stopProgTimer(\''+k+'\')" style="display:none">Stop</button>'+
    '<button class="pt-btn reset" id="ptmr_reset_'+k+'" onclick="SDSG.resetProgTimer(\''+k+'\')">Reset</button>'+
  '</div>';
}
function startProgTimer(k){
  var cfg=_progTimerCfgs[k]; if(!cfg) return;
  var state=_progTimerState[k]=_progTimerState[k]||{};
  if(state.intervalId) return;
  if(cfg.type!=='countup' && state.remaining==null) state.remaining=cfg.seconds;
  var block=_ptEl(k,'block'), disp=_ptEl(k,'display');
  if(block) block.classList.remove('warn','done');
  state.anchor=Date.now();
  state.baseElapsed=state.elapsed||0;
  state.baseRemaining=state.remaining;
  state.intervalId=setInterval(function(){
    var secs=Math.floor((Date.now()-state.anchor)/1000);
    if(cfg.type==='countup'){
      state.elapsed=state.baseElapsed+secs;
      if(disp) disp.textContent=_formatTimerSec(state.elapsed);
    } else {
      state.remaining=Math.max(0,state.baseRemaining-secs);
      if(disp) disp.textContent=_formatTimerSec(state.remaining);
      if(block){
        if(state.remaining<=10 && state.remaining>0) block.classList.add('warn');
        if(state.remaining===0){ block.classList.remove('warn'); block.classList.add('done'); _beep(); stopProgTimer(k); }
      }
    }
  },250);
  var sb=_ptEl(k,'start'), pb=_ptEl(k,'stop');
  if(sb) sb.style.display='none';
  if(pb) pb.style.display='inline-block';
}
function stopProgTimer(k){
  var state=_progTimerState[k]; if(!state) return;
  if(state.intervalId){ clearInterval(state.intervalId); state.intervalId=null; }
  var sb=_ptEl(k,'start'), pb=_ptEl(k,'stop');
  if(sb) sb.style.display='inline-block';
  if(pb) pb.style.display='none';
}
function resetProgTimer(k){
  stopProgTimer(k);
  var cfg=_progTimerCfgs[k]; if(!cfg) return;
  var state=_progTimerState[k]=_progTimerState[k]||{};
  if(cfg.type==='countup'){ state.elapsed=0; } else { state.remaining=cfg.seconds; }
  var disp=_ptEl(k,'display');
  if(disp) disp.textContent=_formatTimerSec(cfg.type==='countup'?0:cfg.seconds);
  var block=_ptEl(k,'block');
  if(block) block.classList.remove('warn','done');
}

// ===== iPhone time input =====
function autoColonTime(el){
  var raw=el.value;
  var digits=raw.replace(/[^\d:]/g,'');
  if(digits.includes(':')){ el.value=digits; updateTimePreview(el); return; }
  if(digits.length===0){ el.value=''; updateTimePreview(el); return; }
  el.value = digits.length>4 ? digits.slice(0,4) : digits;
  if(digits.length===3){ var s3=parseInt(digits.slice(1),10); if(s3>=0&&s3<=59) el.value=digits[0]+':'+digits.slice(1); }
  else if(digits.length===4){ var s4=parseInt(digits.slice(2),10); if(s4>=0&&s4<=59) el.value=digits.slice(0,2)+':'+digits.slice(2); }
  updateTimePreview(el);
}
function updateTimePreview(el){
  var wrap=el.parentElement; if(!wrap) return;
  var preview=wrap.querySelector('.time-preview');
  var v=el.value.trim();
  if(!v){ if(preview) preview.textContent=''; return; }
  var m=/^(\d{1,2}):([0-5]\d)$/.exec(v);
  if(!preview){ preview=document.createElement('span'); preview.className='time-preview'; wrap.appendChild(preview); }
  if(m){
    var mins=parseInt(m[1],10), secs=parseInt(m[2],10), total=mins*60+secs;
    preview.textContent='= '+(mins>0?mins+' min ':'')+secs+' sec ('+total+'s)';
    preview.classList.remove('time-preview-warn');
  } else { preview.textContent='needs M:SS format'; preview.classList.add('time-preview-warn'); }
}

// ===== Value helpers =====
function esc(s){
  // HTML-escape any DB-sourced string before it enters innerHTML (C1).
  return String(s==null?'':s).replace(/[&<>"']/g,function(c){
    return c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':c==='"'?'&quot;':'&#39;';
  });
}
function parseTime(t){
  if(t==null) return null;
  if(typeof t==='number') return isNaN(t)?null:t;
  var s=String(t).trim();
  if(s==='') return null;
  if(s.includes(':')){
    var parts=s.split(':');
    if(parts.length!==2) return null;
    var m=parseInt(parts[0],10), sec=parseInt(parts[1],10);
    if(isNaN(m)||isNaN(sec)||m<0||sec<0||sec>59) return null;
    return m*60+sec;
  }
  var n=parseFloat(s); return isNaN(n)?null:n;
}
function formatTime(sec){
  if(sec==null||isNaN(sec)) return '—';
  var m=Math.floor(sec/60), s=(sec-m*60);
  return m+':'+(s<10?'0':'')+s.toFixed(s%1?1:0);
}
function fmtVal(ev,v){
  // Always returns HTML-escaped text (DB-sourced values are untrusted — C1, B2).
  if(v==null||v==='') return '—';
  var cfg=EVENTS[ev];
  if(!cfg) return esc(String(v));
  if(cfg.unit==='time'){ if(typeof v==='string'&&v.includes(':')) return esc(v); return esc(formatTime(parseTime(v))); }
  return esc(String(v));
}
function bestScore(ev){
  var cfg=EVENTS[ev]; if(!cfg) return null;   // B2: ignore unknown events
  var logs=cachedLogs.filter(function(l){ return l.event===ev&&l.value!=null&&l.value!==''; });
  if(!logs.length) return null;
  var parser=cfg.unit==='time'?parseTime:parseFloat;
  var vals=logs.map(function(l){ return Object.assign({},l,{n:parser(l.value)}); }).filter(function(l){ return !isNaN(l.n); });
  if(!vals.length) return null;
  vals.sort(function(a,b){ return cfg.lowerBetter?a.n-b.n:b.n-a.n; });
  return vals[0];
}
function goldDelta(ev){
  var best=bestScore(ev); if(!best) return null;
  var pod=A().podium[ev]; var goldRaw=pod&&pod[0]&&pod[0][2];
  if(!goldRaw||goldRaw==='—') return null;
  var cfg=EVENTS[ev];
  var b=cfg.unit==='time'?parseTime(best.value):parseFloat(best.value);
  var g=cfg.unit==='time'?parseTime(goldRaw):parseFloat(goldRaw);
  if(isNaN(b)||isNaN(g)) return null;
  var pct = cfg.lowerBetter ? ((g-b)/g)*100 : ((b-g)/g)*100;
  return {pct:pct, gold:goldRaw, best:best.value};
}
function deltaBadge(ev){
  var d=goldDelta(ev);
  if(!d) return '<span class="badge gray">No Data</span>';
  var cls=d.pct>=10?'green':d.pct>=0?'yellow':'red';
  return '<span class="badge '+cls+'">'+(d.pct>=0?'+':'')+d.pct.toFixed(1)+'%</span>';
}
function medalFor(ev){
  var best=bestScore(ev); if(!best) return null;
  var athlete=A();
  if(!athlete||!athlete.podium||!athlete.podium[ev]) return null;
  var cfg=EVENTS[ev];
  var parser=cfg.unit==='time'?parseTime:parseFloat;
  var bestN=parser(best.value); if(isNaN(bestN)) return null;
  var podium=athlete.podium[ev];
  function val(row){ if(!row||row[2]==='—'||row[2]==null) return null; var n=parser(row[2]); return isNaN(n)?null:n; }
  var g=val(podium.find(function(p){return p[0]==='GOLD';}));
  var s=val(podium.find(function(p){return p[0]==='SILVER';}));
  var b=val(podium.find(function(p){return p[0]==='BRONZE';}));
  var better=function(mine,th){ return cfg.lowerBetter?mine<=th:mine>=th; };
  if(g!==null && better(bestN,g)) return 'gold';
  if(s!==null && better(bestN,s)) return 'silver';
  if(b!==null && better(bestN,b)) return 'bronze';
  return null;
}
function medalIcon(level){
  if(!level) return '';
  var icon = level==='gold'?'🥇':level==='silver'?'🥈':'🥉';
  var label = level.charAt(0).toUpperCase()+level.slice(1);
  return '<span class="medal-trophy medal-'+level+'" title="'+label+' medal pace">'+icon+'</span>';
}

// ===== Coach recommendations (Log tab header) =====
// Two cards above the event list, framed positive then aspirational:
//   🥇 "Closest to Gold"   — events just below the 2025 Gold pace; today's
//                            quickest wins (smallest negative delta).
//   ⛰  "Biggest Climb"     — events farthest from Gold; where the hardest
//                            work pays off most.
// If every event is already at/above Gold pace, a single celebratory card
// replaces both.
function _coachBelowGold(){
  var out=[];
  EVENT_ORDER.forEach(function(ev){
    var d=goldDelta(ev);
    if(d && d.pct<0) out.push({ev:ev, pct:d.pct, gold:d.gold, best:d.best});
  });
  return out;
}
function _gapToGold(r){
  var cfg=EVENTS[r.ev];
  if(cfg.unit==='time'){
    var bSec=parseTime(r.best), gSec=parseTime(r.gold);
    if(isNaN(bSec)||isNaN(gSec)) return '';
    return formatTime(Math.abs(bSec-gSec))+' to gold ('+esc(r.gold)+')';
  }
  var b=parseFloat(r.best), g=parseFloat(r.gold);
  if(isNaN(b)||isNaN(g)) return '';
  var gap=Math.round(Math.abs(b-g)*10)/10;
  var unit=cfg.unit==='reps'?'reps':'in';
  return gap+' '+unit+' to gold ('+esc(r.gold)+')';
}
function _crRow(r){
  var nm=EVENTS[r.ev].name;
  return '<li><span class="cr-nm">'+esc(nm)+'</span><span class="cr-gap">−'+_gapToGold(r)+'</span></li>';
}
function renderCoachRecs(){
  // Only show on athletes whose podium data lets us compute a gold delta.
  var below=_coachBelowGold();
  if(!cachedLogs.length) return '';
  if(!below.length){
    return '<div class="coach-recs all-gold">'+
      '<div class="cr-i">🏆</div>'+
      '<div class="cr-body"><div class="cr-h">Gold Pace, Across the Board</div>'+
      '<div class="cr-sub">Your best meets or beats the 2025 Gold in every event. Today is about holding the line and stacking quality reps.</div></div>'+
    '</div>';
  }
  below.sort(function(a,b){ return a.pct-b.pct; });   // most negative first
  // With only one event below gold, both cards would name the same event; show
  // a single "Biggest Climb" card plus a "you're at gold pace everywhere else"
  // header. Otherwise split: worst → Biggest Climb, smallest negatives → Closest.
  var totalBelow = below.length;
  var totalGold = EVENT_ORDER.filter(function(ev){ var d=goldDelta(ev); return d&&d.pct>=0; }).length;
  var bothCards = totalBelow >= 2;
  var nClimb = bothCards ? Math.min(3, Math.ceil(totalBelow/2)) : totalBelow;
  var climb = below.slice(0, nClimb);
  var close = bothCards ? below.slice(nClimb).reverse().slice(0,2) : [];
  var goldNote = totalGold>0
    ? '<div class="cr-goldnote">🏆 At or above 2025 Gold in '+totalGold+' of '+(totalGold+totalBelow)+' event'+(totalGold+totalBelow>1?'s':'')+'.</div>'
    : '';
  return '<div class="coach-recs">'+
    '<div class="cr-h0">🎯 Today\'s Plan</div>'+
    goldNote+
    (close.length ? '<div class="cr-card cr-close">'+
      '<div class="cr-ch"><span class="cr-ico">🥇</span><span class="cr-t">Closest to Gold</span></div>'+
      '<div class="cr-tag">Your quickest wins today — small gains land you on the podium.</div>'+
      '<ul class="cr-list">'+close.map(_crRow).join('')+'</ul>'+
    '</div>' : '')+
    '<div class="cr-card cr-climb">'+
      '<div class="cr-ch"><span class="cr-ico">⛰</span><span class="cr-t">Biggest Climb</span></div>'+
      '<div class="cr-tag">Where to spend your hardest work — the largest gaps to bridge.</div>'+
      '<ul class="cr-list">'+climb.map(_crRow).join('')+'</ul>'+
    '</div>'+
  '</div>';
}

// ===== All-time record helpers =====
function _recClock(s){
  // Parse a record clock that may carry decimals ("0:16.38") or be plain seconds.
  s=String(s);
  if(s.indexOf(':')>-1){ var p=s.split(':'); return parseInt(p[0],10)*60 + parseFloat(p[1]); }
  return parseFloat(s);
}
function recordFor(ev){
  // All-time record entry for the active athlete's gender + division, or null.
  var a=A(); if(!a||!a.gender||!a.ageBand) return null;
  var g=RECORDS[ev]; if(!g||!g[a.gender]) return null;
  var e=g[a.gender][a.ageBand]; if(!e) return null;
  return {raw:e[0], holder:e[1], year:e[2], weight:e[3]||null};
}
function _recordValueN(ev, raw){
  var cfg=EVENTS[ev]; if(!cfg) return NaN;
  if(cfg.unit==='time') return _recClock(raw);
  if(ev==='dynamax') return parseFloat(raw)*12;   // book feet → app inches
  return parseFloat(raw);
}
function recordDisplay(ev, rec){
  // Plain-text record value in the event's native display unit (already escaped).
  // Dynamax is the unit-mismatch event: the book records in feet, but every
  // other value in the app (logs, baselines, 2025 podiums) is inches, so we
  // convert ft → in for display to match the surrounding column.
  if(!rec) return '—';
  var cfg=EVENTS[ev];
  if(cfg.unit==='time') return esc(rec.raw);
  if(ev==='dynamax') return Math.round(parseFloat(rec.raw)*12)+' in';
  if(cfg.unit==='inches') return esc(rec.raw)+' in';
  return esc(rec.raw)+' reps'+(rec.weight?' @ '+esc(rec.weight):'');
}
function recordStatus(ev){
  // {rec, best, beats, tie} — does the athlete's logged best meet/beat the
  // current all-time record in their division? null when no record applies.
  var rec=recordFor(ev); if(!rec) return null;
  var best=bestScore(ev);
  if(!best) return {rec:rec, best:null, beats:false, tie:false};
  var cfg=EVENTS[ev];
  var bestN = cfg.unit==='time'?parseTime(best.value):parseFloat(best.value);
  var recN  = _recordValueN(ev, rec.raw);
  if(isNaN(bestN)||isNaN(recN)) return {rec:rec, best:best, beats:false, tie:false};
  var beats = cfg.lowerBetter ? bestN<=recN : bestN>=recN;
  return {rec:rec, best:best, beats:beats, tie:bestN===recN};
}
function holdsRecord(ev){
  // Explicit per-config flag — avoids fragile holder-name matching across bands.
  var a=A(), held=a&&a.recordsHeld; if(!held) return null;
  for(var i=0;i<held.length;i++){ if(held[i].event===ev) return held[i]; }
  return null;
}
function recordIcons(ev){
  // Compact 🏅/🔥 chips for collapsed card headers + Progress rows.
  var out='';
  var held=holdsRecord(ev);
  if(held){
    var ht='Holds the all-time '+esc(held.band||'')+' record'+(held.value?' · '+esc(held.value):'')+(held.year?' ('+held.year+')':'');
    out+='<span class="rec-icon held" title="'+ht+'" aria-label="Record holder">🏅</span>';
  }
  var st=recordStatus(ev);
  if(st&&st.beats&&st.best){
    var verb=st.tie?'matches':'beats';
    var pt='Your best '+verb+' the all-time '+esc(A().division)+' record ('+recordDisplay(ev,st.rec)+')';
    out+='<span class="rec-icon pace" title="'+pt+'" aria-label="On record pace">🔥</span>';
  }
  return out;
}
function recordStrip(ev){
  // Full record context line for the expanded Log card body.
  var rec=recordFor(ev); if(!rec) return '';
  var st=recordStatus(ev);
  var badges='';
  var held=holdsRecord(ev);
  if(held) badges+='<span class="rec-badge held">🏅 Record Holder</span>';
  if(st&&st.beats&&st.best) badges+='<span class="rec-badge pace">'+(st.tie?'🔥 Record Tie':'🔥 Record Pace')+'</span>';
  return '<div class="rec-strip'+(st&&st.beats?' on':'')+'">'+
    '<div class="rs-top"><span class="rs-lbl">🏆 All-Time '+esc(A().division)+' Record</span>'+badges+'</div>'+
    '<div class="rs-val">'+recordDisplay(ev,rec)+'</div>'+
    '<div class="rs-who">'+esc(rec.holder)+(rec.year?' · '+rec.year:'')+'</div>'+
  '</div>';
}

// ===== Renders =====
function _medalFromNote(note){
  if(!note) return '';
  var m=/\b(Gold|Silver|Bronze)\b/i.exec(note);
  if(!m) return '';
  var t=m[1].toLowerCase();
  var icon=t==='gold'?'🥇':t==='silver'?'🥈':'🥉';
  return '<span class="inc-medal" title="'+m[1]+' in their 2025 bracket">'+icon+'</span>';
}
function _renderIncomingBlock(ev){
  var inc=A().incoming;
  var list=(inc&&inc[ev])||[];
  if(!list.length) return '';
  var rows=list.map(function(r){
    return '<div class="incoming-row"><span class="who">'+_medalFromNote(r[2])+r[0]+'<span class="nt">'+r[2]+'</span></span><span class="sc">'+r[1]+'</span></div>';
  }).join('');
  return '<div class="incoming"><div class="ph">Incoming Competitors · Aging In</div>'+rows+'</div>';
}
function renderEventCard(ev){
  var cfg=EVENTS[ev], best=bestScore(ev), athlete=A();
  var podium=(athlete.podium&&athlete.podium[ev])||[];
  var load=(athlete.loads&&athlete.loads[ev])||'';
  var inputCtl;
  if(cfg.unit==='reps'){
    var opts='<option value="">Select reps</option>';
    for(var i=1;i<=200;i++) opts+='<option value="'+i+'">'+i+' reps</option>';
    inputCtl='<select id="in_'+ev+'">'+opts+'</select>';
  } else if(cfg.unit==='inches'){
    inputCtl='<input id="in_'+ev+'" type="number" inputmode="decimal" placeholder="inches" step="0.5" min="1" max="600">';
  } else {
    inputCtl='<span class="input-wrap"><input id="in_'+ev+'" type="text" inputmode="numeric" pattern="^\\d{1,2}:[0-5]\\d$" placeholder="M:SS  (e.g. 2:00)" oninput="SDSG.autoColonTime(this)"></span>';
  }
  return '<div class="event-card collapsed" id="ec_'+ev+'">'+
    '<div class="event-head" role="button" tabindex="0" aria-expanded="false" onclick="SDSG.toggleEventCard(\''+ev+'\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();SDSG.toggleEventCard(\''+ev+'\')}"><div><div class="name">'+cfg.name+'</div><div class="meta">Comp Load · '+load+'</div></div><div class="eh-right">'+recordIcons(ev)+deltaBadge(ev)+'<span class="ec-chevron" aria-hidden="true">&#9662;</span></div></div>'+
    '<div class="card-body">'+
      '<div class="scores">'+
        '<div class="score-box"><div class="lbl">Your Best</div><div class="val">'+(best?fmtVal(ev,best.value):'—')+(best?medalIcon(medalFor(ev)):'')+'</div><div class="sub">'+(best?esc(best.date):'No log yet')+'</div></div>'+
        '<div class="score-box gold"><div class="lbl">2025 Gold</div><div class="val">'+((podium[0]&&podium[0][2])||'—')+'</div><div class="sub">'+((podium[0]&&podium[0][1])||'—')+'</div></div>'+
      '</div>'+
      recordStrip(ev)+
      '<div class="podium"><div class="ph">'+(athlete.podiumLabel||'2025 Podium')+'</div>'+
        podium.map(function(p){ return '<div class="podium-row"><span class="place '+(p[0]==='GOLD'?'g':p[0]==='SILVER'?'s':'b')+'">'+p[0]+'</span><span class="who">'+p[1]+'</span><span class="sc">'+p[2]+'</span></div>'; }).join('')+
      '</div>'+
      _renderIncomingBlock(ev)+
      _renderTimerBlock(ev)+
      '<div class="input-row">'+inputCtl+'<button id="btn_'+ev+'" onclick="SDSG.logScore(\''+ev+'\')">Log</button></div>'+
    '</div>'+
  '</div>';
}
function renderLog(){
  document.getElementById('eventList').innerHTML=EVENT_ORDER.map(renderEventCard).join('');
}
function renderProgress(){
  // Status dashboard — top row carries event name + delta pill;
  // bottom row keeps the medals on a single line + your-best on the right.
  var dash=EVENT_ORDER.map(function(ev){
    var cfg=EVENTS[ev], best=bestScore(ev), athlete=A();
    var pod=athlete.podium&&athlete.podium[ev];
    function val(level){ var i=level==='GOLD'?0:level==='SILVER'?1:2; return (pod&&pod[i]&&pod[i][2])||'—'; }
    var podRows='<div class="pod-mini"><span class="pm-lbl">2025 Results</span>'+
      '<span class="pm-row"><span class="pm-i pm-g">🥇</span><span class="pm-v">'+val('GOLD')+'</span></span>'+
      '<span class="pm-row"><span class="pm-i pm-s">🥈</span><span class="pm-v">'+val('SILVER')+'</span></span>'+
      '<span class="pm-row"><span class="pm-i pm-b">🥉</span><span class="pm-v">'+val('BRONZE')+'</span></span>'+
    '</div>';
    var loadTxt=(athlete.loads&&athlete.loads[ev])||'';
    return '<div class="dash-row">'+
      '<div class="dr-head"><div class="nm">'+cfg.name+'</div>'+deltaBadge(ev)+'</div>'+
      (loadTxt?'<div class="sb">'+loadTxt+'</div>':'')+
      '<div class="dr-body">'+
        '<div class="info">'+podRows+'</div>'+
        '<div class="vals"><div class="you">'+(best?fmtVal(ev,best.value):'—')+(best?medalIcon(medalFor(ev)):'')+recordIcons(ev)+'</div></div>'+
      '</div>'+
    '</div>';
  }).join('');
  // Records summary — what this athlete holds + where their best is on record pace.
  // Written as a sentence + bulleted list so it reads cleanly under fatigue.
  var heldList=[], paceList=[];
  EVENT_ORDER.forEach(function(ev){
    if(holdsRecord(ev)){
      var h=holdsRecord(ev);
      heldList.push(EVENTS[ev].name+(h.band?' · '+h.band:'')+(h.value?' ('+h.value+')':''));
    }
    var st=recordStatus(ev);
    if(st&&st.beats&&st.best) paceList.push(EVENTS[ev].name+(st.tie?' (tied)':''));
  });
  var recSummary='';
  if(heldList.length||paceList.length){
    var div=esc(A().division);
    function ul(items){ return '<ul class="rsum-list">'+items.map(function(t){ return '<li>'+esc(t)+'</li>'; }).join('')+'</ul>'; }
    recSummary='<div class="rec-summary">'+
      (heldList.length
        ? '<div class="rsum-row"><span class="rsum-i">🏅</span><div class="rsum-t">'+
            '<b>You hold the all-time record</b> in '+heldList.length+' event'+(heldList.length>1?'s':'')+
            ' (the highest mark ever set in your past division, 2019–2025):'+
            ul(heldList)+
          '</div></div>'
        : '')+
      (paceList.length
        ? '<div class="rsum-row"><span class="rsum-i">🔥</span><div class="rsum-t">'+
            '<b>Your best is on all-time record pace</b> in '+paceList.length+' event'+(paceList.length>1?'s':'')+'. '+
            'Your logged best matches or beats the highest mark ever set in <b>'+div+'</b> across the 2019–2025 record books:'+
            ul(paceList)+
          '</div></div>'
        : '')+
    '</div>';
  }
  // History
  var hist;
  if(!cachedLogs.length){ hist='<div class="empty"><div class="ico">📋</div><div class="msg">No sessions logged yet</div></div>'; }
  else {
    var byDate={};
    cachedLogs.slice().reverse().forEach(function(l){ (byDate[l.date]=byDate[l.date]||[]).push(l); });
    var dates=Object.keys(byDate).sort().reverse();
    hist=dates.map(function(date){
      var rows=byDate[date].map(function(l){
        var best=bestScore(l.event);
        var isPR=best&&best.date===l.date&&String(best.value)===String(l.value);
        var delBtn = l.id ? '<button class="hist-del" data-id="'+esc(l.id)+'" title="Delete">🗑</button>' : '';
        var evName = EVENTS[l.event] ? EVENTS[l.event].name : esc(l.event);   // B2
        return '<div class="hist-row"><span class="ev">'+evName+(isPR?'<span class="pr">PR</span>':'')+'</span><span class="actions"><span class="sc">'+fmtVal(l.event,l.value)+'</span>'+delBtn+'</span></div>';
      }).join('');
      var compName = COMP_DATES[date];   // B5: data-driven comp-day badge
      var compTag = compName ? ' <span class="comp-day">🏆 '+esc(compName)+'</span>' : '';
      return '<div class="hist-day"><div class="date">'+esc(date)+compTag+'</div>'+rows+'</div>';
    }).join('');
  }
  document.getElementById('progressView').innerHTML=
    recSummary+
    '<div class="section-title">Status · Best vs 2025 Gold</div>'+dash+
    '<div class="section-title" style="margin-top:24px">Training History</div><div id="historyList">'+hist+'</div>';
  // wire deletes
  document.querySelectorAll('#historyList .hist-del').forEach(function(btn){
    btn.addEventListener('click', async function(){
      var id=btn.dataset.id;
      if(!confirm('Delete this entry? This cannot be undone.')) return;
      try{ setSyncStatus('syncing','Deleting'); await deleteLog(id); setSyncStatus('synced'); render(); toast('Entry deleted'); }
      catch(e){ console.error(e); setSyncStatus('offline','Delete failed'); toast('Delete failed — check connection'); }
    });
  });
}
function renderScouting(){
  var athlete=A();
  var inc=athlete.incoming||{};
  var any=EVENT_ORDER.some(function(ev){ return (inc[ev]||[]).length; });
  var html='<div class="prog-banner"><h2>Field Watch</h2><div class="sub">Incoming Competitors · Aging In</div>'+
    '<div class="dates">Competitors who podiumed in the band below and may age up into '+athlete.division+' for 2026. Coach reviews and prunes by birthday.</div>'+
    '<a class="open" href="/scouting/">Full Scouting Board →</a></div>';
  if(!any){
    html+='<div class="empty"><div class="ico">🎯</div><div class="msg">No incoming competitors flagged for this athlete.</div></div>';
  } else {
    html+=EVENT_ORDER.map(function(ev){
      var list=inc[ev]||[]; if(!list.length) return '';
      var best=bestScore(ev);
      var youLoad=(athlete.loads&&athlete.loads[ev])||'';
      if(/^(bw|body\s*weight)$/i.test(youLoad)) youLoad='';   // E8
      var youSub=athlete.division+(youLoad?' · '+youLoad:'');
      var youCard='<div class="scout-you">'+
        '<div class="sy-lbl">Your Best</div>'+
        '<div class="sy-val">'+(best?fmtVal(ev,best.value):'—')+(best?medalIcon(medalFor(ev)):'')+'</div>'+
        '<div class="sy-sub">'+esc(youSub)+(best?' · '+esc(best.date):'')+'</div>'+
      '</div>';
      var caveat='<div class="scout-caveat"><span class="cv-flag">🚩</span>Incoming athletes below come from a different division. Their load or standard may differ — your Best above is your apples-to-apples baseline.</div>';
      var rows=list.map(function(r){ return '<div class="incoming-row"><span class="who">'+_medalFromNote(r[2])+r[0]+'<span class="nt">'+r[2]+'</span></span><span class="sc">'+r[1]+'</span></div>'; }).join('');
      return '<div class="prog-event"><div class="prog-event-head"><span class="pe-name">'+EVENTS[ev].name+'</span></div>'+
        '<div class="scout-body">'+youCard+caveat+'<div class="scout-incoming">'+rows+'</div></div>'+
      '</div>';
    }).join('');
  }
  document.getElementById('scoutingView').innerHTML=html;
}
function renderProfileInto(elId){
  var a=A();
  var el=document.getElementById(elId); if(!el) return;
  var html='<div class="profile-card"><div class="profile-head"><div class="profile-tag">Athlete Profile</div><div class="profile-title">'+a.name+'</div><div class="profile-sub">'+a.division+(a.trains?' · '+a.trains:'')+'</div></div><div class="profile-body">';
  if(a.background) html+='<div class="profile-section"><div class="lbl teal">Background</div><p>'+a.background+'</p></div>';
  if(a.strong||a.weak) html+='<div class="profile-pillars">'+(a.strong?'<div class="pillar s"><div class="ph">Strengths</div><div class="pb">'+a.strong+'</div></div>':'')+(a.weak?'<div class="pillar w"><div class="ph">Focus Areas</div><div class="pb">'+a.weak+'</div></div>':'')+'</div>';
  if(a.arc) html+='<div style="margin-top:14px"><div class="block-arc"><div class="ah">'+a.arc.title+'</div><div class="ai">'+a.arc.body+'</div></div></div>';
  html+='</div></div>';
  el.innerHTML=html;
}

// ===== Personalized program prescriptions =====
// Goal: substitute the shared /program/ pattern text with the athlete's own
// numbers so they never do mental math fatigued on the gym floor.
// Per-pattern lookup keyed by (event_name, pattern_name); returns either
//   {load:'…'}                          — override the load line
//   {load:'…', cue:'👉 Your number: …'} — also append a personal-target cue
// Anything not matched falls through to the original /program/ copy.
function _personalizePattern(eventName, p, athlete){
  if(!athlete) return null;
  var loads=athlete.loads||{};
  var name=String(p.name||'');
  // KB Box Squat
  if(eventName==='KB Box Squat' && /Comp-Pace Box Squat/i.test(name)){
    return {load:'Your competition KB — <b>'+esc(loads.kbsquat||'')+'</b> — at your competition box height'};
  }
  if(eventName==='KB Box Squat' && /Heavy Goblet Squat/i.test(name)){
    return {load:'Same KB as last week — <b>'+esc(loads.kbsquat||'')+'</b>. The pause is the progression, not more weight.'};
  }
  // Dynamax — strip the (women)/(men) split and show just the athlete's ball.
  if(eventName==='Dynamax OH Throw' && /Throw Technique Practice/i.test(name)){
    return {load:'Dynamax ball — <b>'+esc(loads.dynamax||'')+'</b>'};
  }
  if(eventName==='Dynamax OH Throw' && /Hip Hinge \+ Med Ball Toss/i.test(name)){
    return {load:'One size up from your '+esc(loads.dynamax||'')+' Dynamax (heavier med ball for power)'};
  }
  // Bench Press — compute the rep target from the latest bench best.
  if(eventName==='Bench Press' && /Bench Volume/i.test(name)){
    var benchBest=bestScore('bench');
    var w=esc(loads.bench||'');
    if(benchBest){
      var n=parseInt(benchBest.value,10);
      if(!isNaN(n)){
        var lo=Math.max(1,Math.round(n*0.50)), hi=Math.max(lo,Math.round(n*0.60));
        var tgt=lo===hi?(lo+''):(lo+'–'+hi);
        return {load:w+' · 3 sets × <b>'+tgt+' reps</b> per set',
          cue:'👉 Your number: <b>'+tgt+' reps × 3 sets</b> at '+w+' (50–60% of your '+n+'-rep test on '+esc(benchBest.date)+').'};
      }
    }
    return {load:w+' · 3 sets to ~50–60% of your max-rep test',
      cue:'👉 Log a max-rep bench test first so we can compute your exact rep target.'};
  }
  // Slams — substitute the D-ball weight.
  if(eventName==='Med Ball Slams' && /(Standing Slam Volume|60-Sec Slam Practice)/i.test(name)){
    return {load:'D-ball at your competition weight — <b>'+esc(loads.slams||'')+'</b>'};
  }
  if(eventName==='Med Ball Slams' && /Heavy Standing Slam/i.test(name)){
    return {load:'One size heavier than your '+esc(loads.slams||'')+' comp ball'};
  }
  // Prowler — show just the athlete's plate config, drop the (women)/(men) split.
  if(eventName==='Prowler Push' && /Comp-Distance Sled Push/i.test(name)){
    return {load:'Competition load — <b>'+esc(loads.prowler||'')+'</b>'};
  }
  // Hang — if any future week uses a "% of best" prescription, compute the
  // actual goal time so they don't do math on the bar.
  if(eventName==='Overhead Arm Hang'){
    var pctRx=/(\d{1,3})\s*%\s*of\s*(?:your\s*)?(?:best|max|pr)/i.exec(p.rx||'');
    var hangBest=bestScore('hang');
    if(pctRx && hangBest){
      var pct=parseInt(pctRx[1],10);
      var sec=parseTime(hangBest.value);
      if(!isNaN(pct) && sec!=null){
        var goal=Math.max(1,Math.round(sec*pct/100));
        var m=Math.floor(goal/60), s=goal%60;
        var goalStr=m+':'+(s<10?'0':'')+s;
        return {cue:'👉 Your target: <b>'+goalStr+'</b> hold ('+pct+'% of your '+esc(hangBest.value)+' best from '+esc(hangBest.date)+').'};
      }
    }
  }
  return null;
}

// ===== Program tab (fetch /program/, render this week) =====
async function renderProgram(){
  var host=document.getElementById('programView');
  // Coach recs are always live — they depend on cachedLogs, which can change
  // between Program-tab visits without invalidating the heavier events cache.
  var recsHtml=renderCoachRecs();
  if(_programCache){ host.innerHTML=recsHtml+_programCache; return; }
  host.innerHTML=recsHtml+'<div class="empty"><div class="spinner"></div><div class="msg" style="margin-top:14px">Loading this week’s program…</div></div>';
  try{
    var res=await fetch('/program/');
    if(!res.ok) throw new Error('HTTP '+res.status);
    var txt=await res.text();
    var em=txt.match(/<script type="application\/json" id="program-events">([\s\S]*?)<\/script>/);
    if(!em) throw new Error('program-events JSON block not found');
    var events=JSON.parse(em[1]);
    var TYPE={sprint:'<span class="pe-mode">⚡ Sprint</span>',marathon:'<span class="pe-mode">🔋 Marathon</span>'};
    var html='';
    var aLoads=A().loads||{};
    var keyByName={'KB Box Squat':'kbsquat','Dynamax OH Throw':'dynamax','Bench Press':'bench','Overhead Arm Hang':'hang','Med Ball Slams':'slams','Jump Rope · 60s':'jumprope','Standing Broad Jump':'broadjump','Concept Row · 500m':'row','300 Yd Shuttle Run':'shuttle','Prowler Push':'prowler'};
    // Re-render means we rebuild the timer registry; clear any running pattern timers first.
    Object.keys(_progTimerState).forEach(function(k){ var s=_progTimerState[k]; if(s&&s.intervalId) clearInterval(s.intervalId); });
    _progTimerState = {}; _progTimerCfgs = {};
    html+=events.map(function(e,idx){
      var k=keyByName[e.event];
      var load=k&&aLoads[k]?aLoads[k]:'';
      var pats=(e.patterns||[]).map(function(p, patIdx){
        var pers=_personalizePattern(e.event, p, A());
        var loadText = (pers && pers.load) ? pers.load : p.load;
        var cuesArr = (p.cues||[]).slice();
        if(pers && pers.cue) cuesArr.unshift(pers.cue);
        var cues = cuesArr.map(function(c){ return '<li>'+c+'</li>'; }).join('');
        var tcfg=_patternTimerCfg(p.rx);
        var ptK=idx+'_'+patIdx;
        if(tcfg) _progTimerCfgs[ptK]=tcfg;
        var timerHtml=tcfg ? _renderProgPatternTimer(ptK, tcfg) : '';
        return '<div class="prog-pat"><div class="pp-name">'+p.name+'</div><div class="pp-rx">'+(p.rx||'')+'</div>'+(loadText?'<div class="pp-rx pp-load">'+loadText+'</div>':'')+timerHtml+(cues?'<ul class="pp-cues">'+cues+'</ul>':'')+'</div>';
      }).join('');
      return '<div class="prog-event collapsed" id="pe_'+idx+'">'+
        '<div class="prog-event-head" onclick="SDSG.toggleProg('+idx+')">'+
          '<div><span class="pe-name">'+e.event+'</span> <span class="pe-tag">'+(TYPE[e.type]||'')+(e.tag?' <span class="pe-cue">· '+e.tag+'</span>':'')+'</span></div>'+
          (load?'<span class="pe-load">'+load+'</span>':'')+
        '</div>'+
        '<div class="prog-body">'+pats+'</div>'+
      '</div>';
    }).join('');
    _programCache=html;
    host.innerHTML=recsHtml+html;
  }catch(e){
    console.error(e);
    host.innerHTML='<div class="empty"><div class="ico">⚠️</div><div class="msg">Couldn’t load the program.<br>Open <a href="/program/" style="color:var(--teal)">/program/</a> directly.</div></div>';
  }
}
function toggleProg(idx){
  var el=document.getElementById('pe_'+idx); if(!el) return;
  el.classList.toggle('collapsed');
}
function toggleEventCard(ev){
  var el=document.getElementById('ec_'+ev); if(!el) return;
  var collapsed=el.classList.toggle('collapsed');
  var head=el.querySelector('.event-head');
  if(head) head.setAttribute('aria-expanded', collapsed?'false':'true');
}

// ===== Dashboard (block periodization + this-week + stats + profile) =====
// Single source of truth: the block-periodization grid is fetched from
// /program/ so coach changes there propagate everywhere. Stats + profile
// + arc live in the athlete config.
var _dashCache = null;
async function renderDashboard(){
  var host = document.getElementById('dashboardView');
  if(!host) return;
  // Stats block (always fresh — derived from cachedLogs).
  var statsHtml = _renderDashStats();
  if(_dashCache){
    host.innerHTML = statsHtml + _dashCache;
    _wireDashProfile();
    return;
  }
  host.innerHTML = statsHtml + '<div class="empty"><div class="spinner"></div><div class="msg" style="margin-top:14px">Loading your dashboard…</div></div>';
  try{
    var res = await fetch('/program/');
    if(!res.ok) throw new Error('HTTP '+res.status);
    var txt = await res.text();
    // Extract week banner + 4-block + comp-day grid from /program/ HTML.
    var wt = txt.match(/<h2>(Week of [^<]+)<\/h2>/);
    var ws = txt.match(/week-sub">([^<]+)</);
    var wd = txt.match(/week-dates">([^<]+)</);
    var tl = txt.match(/<div class="block-timeline">([\s\S]*?)<\/div>\s*<div class="week-note">/);
    var timeline = tl ? tl[1] : '';
    // /program/ source uses named entities (&middot;, &ndash;, &mdash;, &amp;).
    // They're trusted coach-authored copy — decode the handful we know before esc().
    function _decode(s){ return String(s).replace(/&middot;/g,'·').replace(/&ndash;/g,'–').replace(/&mdash;/g,'—').replace(/&amp;/g,'&'); }
    var weekHtml = '<div class="dash-week">'+
      (wt ? '<div class="dw-title">'+esc(_decode(wt[1]))+'</div>' : '')+
      (ws ? '<div class="dw-sub">'+esc(_decode(ws[1]))+'</div>' : '')+
      (wd ? '<div class="dw-dates">'+esc(_decode(wd[1]))+'</div>' : '')+
      '<a class="dw-open" href="/program/">Open Full Program →</a>'+
    '</div>';
    if(timeline) timeline = _decode(timeline);
    var periodHtml = '<div class="dash-timeline">'+timeline+'</div>';
    _dashCache = '<div class="section-title">This Week</div>'+weekHtml+periodHtml+_renderDashProfile();
    host.innerHTML = statsHtml + _dashCache;
    _wireDashProfile();
  }catch(e){
    console.error(e);
    host.innerHTML = statsHtml + '<div class="empty"><div class="ico">⚠️</div><div class="msg">Couldn’t load the program preview.<br>Open <a href="/program/" style="color:var(--teal)">/program/</a> directly.</div></div>';
  }
}
function _renderDashStats(){
  var logged = new Set(cachedLogs.map(function(l){return l.event;})).size;
  var golds = 0; EVENT_ORDER.forEach(function(ev){ var d=goldDelta(ev); if(d&&d.pct>=0) golds++; });
  var prs = _countPRs();
  // Block-strip — week N of M and % through.
  var now=new Date(), totalDays=Math.ceil((COMP_DATE-BLOCK_START)/86400000);
  var elapsed=Math.max(0,Math.ceil((now-BLOCK_START)/86400000));
  var weeksTotal=Math.ceil(totalDays/7);
  var weekNow=Math.min(weeksTotal,Math.max(1,Math.ceil(elapsed/7)));
  var pct=Math.min(100,Math.max(0,(elapsed/totalDays)*100)).toFixed(0);
  return '<div class="block-strip">'+
      '<div class="bs-top"><span class="bs-week">Week '+weekNow+' of '+weeksTotal+'</span><span class="bs-pct">'+pct+'%</span></div>'+
      '<div class="bar"><div class="fill" style="width:'+pct+'%"></div></div>'+
    '</div>'+
    '<div class="stat-row">'+
      '<div class="stat"><div class="n">'+logged+'/10</div><div class="l">Events Logged</div></div>'+
      '<div class="stat gold"><div class="n">'+golds+'</div><div class="l">At Gold Pace</div></div>'+
      '<div class="stat pink"><div class="n">'+prs+'</div><div class="l">PRs Logged</div></div>'+
    '</div>';
}
function _renderDashProfile(){
  var a = A();
  var html = '<div class="section-title">Athlete Profile</div><div class="profile-card"><div class="profile-head"><div class="profile-tag">Athlete</div><div class="profile-title">'+esc(a.name)+'</div><div class="profile-sub">'+esc(a.division)+(a.trains?' · '+esc(a.trains):'')+'</div></div><div class="profile-body">';
  if(a.background) html += '<div class="profile-section"><div class="lbl teal">Background</div><p>'+a.background+'</p></div>';
  if(a.strong||a.weak) html += '<div class="profile-pillars">'+(a.strong?'<div class="pillar s"><div class="ph">Strengths</div><div class="pb">'+a.strong+'</div></div>':'')+(a.weak?'<div class="pillar w"><div class="ph">Focus Areas</div><div class="pb">'+a.weak+'</div></div>':'')+'</div>';
  if(a.arc) html += '<div style="margin-top:14px"><div class="block-arc"><div class="ah">'+esc(a.arc.title)+'</div><div class="ai">'+a.arc.body+'</div></div></div>';
  html += '</div></div>';
  return html;
}
function _wireDashProfile(){ /* placeholder for future interactive bits */ }

// ===== Header / stats =====
function renderHeader(){
  var now=new Date();
  var days=Math.max(0,Math.ceil((COMP_DATE-now)/86400000));
  document.getElementById('daysNum').textContent=days;
  var totalDays=Math.ceil((COMP_DATE-BLOCK_START)/86400000);
  var elapsed=Math.max(0,Math.ceil((now-BLOCK_START)/86400000));
  var weeksTotal=Math.ceil(totalDays/7);
  var weekNow=Math.min(weeksTotal,Math.max(1,Math.ceil(elapsed/7)));
  var pct=Math.min(100,Math.max(0,(elapsed/totalDays)*100));
  var bw=document.getElementById('blockWeek'); if(bw) bw.textContent='Week '+weekNow+' of '+weeksTotal;
  var bf=document.getElementById('blockFill'); if(bf) bf.style.width=pct.toFixed(0)+'%';
  var bp=document.getElementById('blockPct'); if(bp) bp.textContent=pct.toFixed(0)+'%';
}
// True PRs only: a logged value that beat the prior best for its event,
// processed in chronological order. The initial baseline does not count.
function _countPRs(){
  var grouped={}; cachedLogs.forEach(function(l){ (grouped[l.event]=grouped[l.event]||[]).push(l); });
  var total=0;
  Object.keys(grouped).forEach(function(ev){
    var cfg=EVENTS[ev]; if(!cfg) return;
    var logs=grouped[ev].slice().sort(function(a,b){
      if(a.date!==b.date) return a.date<b.date?-1:1;
      return String(a.id||'')<String(b.id||'')?-1:1;
    });
    var bestN=null;
    logs.forEach(function(l){
      var n=cfg.unit==='time'?parseTime(l.value):parseFloat(l.value);
      if(n==null||isNaN(n)) return;
      var beat = bestN==null ? false : (cfg.lowerBetter ? n<bestN : n>bestN);
      if(bestN==null){ bestN=n; }                       // first log → baseline, not a PR
      else if(beat){ total++; bestN=n; }                // subsequent log that beats the best
    });
  });
  return total;
}
function renderStats(){
  var logged=new Set(cachedLogs.map(function(l){return l.event;})).size;
  var sl=document.getElementById('statLogged'); if(sl) sl.textContent=logged+'/10';
  var golds=0; EVENT_ORDER.forEach(function(ev){ var d=goldDelta(ev); if(d&&d.pct>=0) golds++; });
  var sg=document.getElementById('statGold'); if(sg) sg.textContent=golds;
  var sp=document.getElementById('statPRs'); if(sp) sp.textContent=_countPRs();
}
function render(){
  try{ document.title = A().name + " · SDSG '26 · Yeager's Gym"; }catch(e){}
  // renderHeader/renderStats keep the legacy log-tab header IDs in sync when
  // present (they may be absent on athletes who've moved everything to the
  // Dashboard tab); both checks are no-ops if the elements aren't there.
  renderHeader(); renderStats(); renderProfileInto('profileCard');
  if(currentView==='dashboard') renderDashboard();
  else if(currentView==='log') renderLog();
  else if(currentView==='progress') renderProgress();
  else if(currentView==='scouting') renderScouting();
  else if(currentView==='program') renderProgram();
}
function setView(v){
  currentView=v;
  document.querySelectorAll('.tab').forEach(function(t){
    var on=t.dataset.view===v;
    t.classList.toggle('active',on);
    t.setAttribute('aria-selected', on?'true':'false');   // E3
  });
  ['dashboard','log','program','progress','scouting'].forEach(function(name){
    var el=document.getElementById(name+'View'); if(el) el.hidden=(name!==v);
    var wrap=document.getElementById(name+'Wrap'); if(wrap) wrap.hidden=(name!==v);
  });
  render();
  var panel=document.getElementById(v+'View');   // E2: move focus to the revealed panel
  if(panel){ panel.setAttribute('tabindex','-1'); try{ panel.focus({preventScroll:true}); }catch(e){} }
}
function setSyncStatus(state,label){
  var el=document.getElementById('syncIndicator'); if(!el) return;
  el.classList.remove('show','syncing','offline');
  if(state==='hide') return;
  el.classList.add('show');
  if(state==='syncing') el.classList.add('syncing');
  if(state==='offline') el.classList.add('offline');
  document.getElementById('syncLabel').textContent=label||(state==='synced'?'Synced':state==='syncing'?'Syncing':'Offline');
  if(state==='synced') setTimeout(function(){ el.classList.remove('show'); },1500);
}
function toast(msg,isPR,undoAction){
  var t=document.getElementById('toast');
  t.classList.toggle('pr',!!isPR);
  if(undoAction){
    t.innerHTML='<span></span><button class="toast-undo" type="button">Undo</button>';
    t.querySelector('span').textContent=msg;
    t.querySelector('.toast-undo').addEventListener('click', async function(){ t.classList.remove('show'); try{ await undoAction(); }catch(e){ console.error(e); toast('Undo failed'); } }, {once:true});
  } else { t.textContent=msg; }
  t.classList.add('show');
  clearTimeout(window._toastT);
  window._toastT=setTimeout(function(){ t.classList.remove('show'); },3500);
}
async function logScore(ev){
  var el=document.getElementById('in_'+ev), btn=document.getElementById('btn_'+ev);
  var raw=el.value.trim();
  if(!raw){ toast('Enter a value first'); return; }
  // Per-unit bounds (D1/D2) — reject garbage before it hits the DB.
  var unit=EVENTS[ev].unit;
  if(unit==='time'){
    if(!/^\d{1,2}:[0-5]\d$/.test(raw)){ toast('Use M:SS format (e.g. 2:00)'); return; }
    var ts=parseTime(raw); if(ts==null||ts>1800){ toast('That time looks too long — check M:SS'); return; }
  } else if(unit==='reps'){
    var rn=parseInt(raw,10); if(isNaN(rn)||rn<1||rn>200){ toast('Enter a rep count between 1 and 200'); return; }
  } else { // inches
    var inn=parseFloat(raw); if(isNaN(inn)||inn<1||inn>600){ toast('Enter inches between 1 and 600'); return; }
  }
  btn.disabled=true;
  var prevBest=bestScore(ev);
  var d=new Date();
  var today=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  try{
    setSyncStatus('syncing','Saving');
    var inserted=await insertLog(slug(), ev, raw, today, null);
    cachedLogs=await loadLogs(slug());
    setSyncStatus('synced');
    var newBest=bestScore(ev);
    var isPR=newBest&&(!prevBest||String(prevBest.value)!==String(newBest.value))&&String(newBest.value)===raw;
    el.value='';
    render();
    var undo=async function(){
      try{ if(inserted&&inserted.id){ setSyncStatus('syncing','Removing'); await deleteLog(inserted.id); cachedLogs=await loadLogs(slug()); setSyncStatus('synced'); render(); toast('Removed'); } }
      catch(e){ console.error(e); setSyncStatus('offline','Undo failed'); toast('Undo failed — check connection'); }
    };
    var matched = !isPR && prevBest && newBest && String(newBest.value)===raw && String(prevBest.value)===raw;
    if(isPR&&prevBest) toast('🔥 NEW PR — '+EVENTS[ev].name,true,undo);
    else if(matched) toast('Matched your best — '+EVENTS[ev].name,false,undo);   // D5
    else toast('Logged',false,undo);
  }catch(e){ console.error(e); setSyncStatus('offline','Save failed'); toast('Save failed — check connection'); }
  finally{ btn.disabled=false; }
}
async function resetAthlete(){
  if(!confirm('Reset all logged data for '+A().name+'? Baselines will be re-seeded. This cannot be undone.')) return;
  try{ setSyncStatus('syncing','Resetting'); await deleteAllLogs(slug()); cachedLogs=[]; await ensureBaselines(slug()); setSyncStatus('synced'); render(); toast('Data reset'); }
  catch(e){ console.error(e); setSyncStatus('offline','Reset failed'); toast('Reset failed — check connection'); }
}
async function switchAthlete(key){
  if(!ATHLETES[key]||key===cur) return;
  cur=key;
  // B3: stop any running timers before discarding their state so intervals don't leak.
  Object.keys(_timerState).forEach(function(ev){ var s=_timerState[ev]; if(s&&s.intervalId) clearInterval(s.intervalId); });
  _timerState={};
  Object.keys(_progTimerState).forEach(function(k){ var s=_progTimerState[k]; if(s&&s.intervalId) clearInterval(s.intervalId); });
  _progTimerState={}; _progTimerCfgs={};
  _programCache=null;   // B1: the Program tab badges per-athlete loads — force a refetch.
  _dashCache=null;      // dashboard profile/arc are per-athlete — invalidate on switch.
  document.querySelectorAll('.athlete-switch button').forEach(function(b){ b.classList.toggle('active',b.dataset.athlete===key); });
  setSyncStatus('syncing','Loading');
  var tok=++_loadToken;
  try{
    var logs=await loadLogs(slug()); if(tok!==_loadToken) return;   // B4/D3: stale load, bail
    cachedLogs=logs;
    await ensureBaselines(slug()); if(tok!==_loadToken) return;
    setSyncStatus('synced'); render();
  }
  catch(e){ console.error(e); if(tok===_loadToken){ setSyncStatus('offline','Load failed'); toast('Load failed — check connection'); } }
}
function buildSwitcher(){
  var bt=document.getElementById('brandTitle');
  if(bt) bt.textContent = DUAL ? "Annie & David" : (A().name + " · SDSG '26");
  if(!DUAL) return;
  var host=document.getElementById('athleteSwitch'); if(!host) return;
  host.hidden=false;
  host.innerHTML=Object.keys(ATHLETES).map(function(key){
    var a=ATHLETES[key];
    var cls='athlete-switch-btn'+(key===cur?' active':'')+(key==='david'?' david':'');
    return '<button data-athlete="'+key+'" class="'+(key===cur?'active':'')+(key==='david'?' david':'')+'" onclick="SDSG.switchAthlete(\''+key+'\')">'+a.name+'<span class="div">'+a.division+'</span></button>';
  }).join('');
}
// ===== Font scale (zoom) control =====
var FS_MIN=0.85, FS_MAX=1.6, FS_KEY='sdsg_fs';
// CSS `zoom` is supported in all current browsers (Firefox added it in 2024).
// For older engines that lack it, fall back to transform:scale on <main> (E1).
var _zoomOK = (typeof CSS!=='undefined' && CSS.supports && CSS.supports('zoom','1.5'));
function _readFs(){ var v=parseFloat(localStorage.getItem(FS_KEY)); return (isNaN(v)||!v)?1:v; }
function _applyFs(){
  var fs=_readFs();
  document.documentElement.style.setProperty('--fs', fs);
  if(!_zoomOK){
    var main=document.querySelector('main');
    if(main){
      main.style.transformOrigin='top center';
      main.style.transform = fs===1 ? '' : 'scale('+fs+')';
      main.style.width = fs===1 ? '' : (100/fs)+'%';
      main.style.marginLeft = fs===1 ? '' : 'auto';
      main.style.marginRight = fs===1 ? '' : 'auto';
    }
  }
  var vEl=document.getElementById('fs-val');
  if(vEl) vEl.textContent=Math.round(fs*100)+'%';
  var dec=document.querySelector('.fontctl [data-act="font-dec"]');
  var inc=document.querySelector('.fontctl [data-act="font-inc"]');
  if(dec) dec.disabled=fs<=FS_MIN+0.001;
  if(inc) inc.disabled=fs>=FS_MAX-0.001;
}
function setFontScale(delta){
  var fs=_readFs();
  fs=Math.max(FS_MIN, Math.min(FS_MAX, Math.round((fs+delta)*100)/100));
  localStorage.setItem(FS_KEY, fs);
  _applyFs();
}
function _mountFontCtl(){
  if(document.querySelector('.fontctl')) return;
  var d=document.createElement('div');
  d.className='fontctl'; d.setAttribute('aria-label','Text size');
  d.innerHTML='<button data-act="font-dec" aria-label="Decrease text size">−</button>'+
    '<span class="fs-val" id="fs-val">100%</span>'+
    '<button data-act="font-inc" aria-label="Increase text size">+</button>';
  document.body.appendChild(d);
  d.addEventListener('click', function(e){
    var b=e.target.closest('[data-act]'); if(!b) return;
    if(b.dataset.act==='font-dec') setFontScale(-0.1);
    if(b.dataset.act==='font-inc') setFontScale(+0.1);
  });
  _applyFs();
}

async function init(){
  try{
    buildSwitcher();
    _mountFontCtl();
    setSyncStatus('syncing','Loading');
    var tok=++_loadToken;
    var logs=await loadLogs(slug()); if(tok!==_loadToken) return;
    cachedLogs=logs;
    await ensureBaselines(slug()); if(tok!==_loadToken) return;
    setSyncStatus('synced');
    var ls=document.getElementById('loadingScreen'); if(ls) ls.classList.add('hidden');
    render();
  }catch(e){
    console.error(e);
    var ls=document.getElementById('loadingScreen');
    if(ls) ls.innerHTML='<div style="text-align:center;padding:20px;color:#fff"><div style="font-size:32px;margin-bottom:12px">⚠️</div><div style="font-size:14px;font-weight:700;margin-bottom:6px">Connection failed</div><div style="font-size:12px;opacity:.6;max-width:280px">Check internet and reload the page.</div></div>';
  }
}

// Expose the handful of functions used by inline onclick handlers
window.SDSG = {
  setView:setView, logScore:logScore, resetAthlete:resetAthlete, switchAthlete:switchAthlete,
  startTimer:startTimer, stopTimer:stopTimer, resetTimer:resetTimer, autoColonTime:autoColonTime,
  toggleProg:toggleProg, toggleEventCard:toggleEventCard, setFontScale:setFontScale,
  startProgTimer:startProgTimer, stopProgTimer:stopProgTimer, resetProgTimer:resetProgTimer
};

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
