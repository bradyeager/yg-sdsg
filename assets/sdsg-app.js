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
  if(cachedLogs.length>0) return;
  setSyncStatus('syncing','Seeding');
  var rows = (A().baselines||[]).map(function(b){ return {athlete_slug:athleteSlug, event:b.event, value:String(b.value), log_date:b.date, note:b.note||null}; });
  if(rows.length){ await sbFetch('/sdsg_logs', {method:'POST', body:JSON.stringify(rows)}); }
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
var EVENT_ORDER = (function(){
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
var currentView = 'log';
var _timerState = {};
var _programCache = null;

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
  if(v==null||v==='') return '—';
  var cfg=EVENTS[ev];
  if(cfg.unit==='time'){ if(typeof v==='string'&&v.includes(':')) return v; return formatTime(parseTime(v)); }
  return String(v);
}
function bestScore(ev){
  var logs=cachedLogs.filter(function(l){ return l.event===ev&&l.value!=null&&l.value!==''; });
  if(!logs.length) return null;
  var cfg=EVENTS[ev];
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
    inputCtl='<input id="in_'+ev+'" type="number" inputmode="decimal" placeholder="inches" step="0.5">';
  } else {
    inputCtl='<span class="input-wrap"><input id="in_'+ev+'" type="text" inputmode="numeric" pattern="^\\d{1,2}:[0-5]\\d$" placeholder="M:SS  (e.g. 2:00)" oninput="SDSG.autoColonTime(this)"></span>';
  }
  return '<div class="event-card">'+
    '<div class="event-head"><div><div class="name">'+cfg.name+'</div><div class="meta">Comp Load · '+load+'</div></div>'+deltaBadge(ev)+'</div>'+
    '<div class="card-body">'+
      '<div class="scores">'+
        '<div class="score-box"><div class="lbl">Your Best</div><div class="val">'+(best?fmtVal(ev,best.value):'—')+(best?medalIcon(medalFor(ev)):'')+'</div><div class="sub">'+(best?best.date:'No log yet')+'</div></div>'+
        '<div class="score-box gold"><div class="lbl">2025 Gold</div><div class="val">'+((podium[0]&&podium[0][2])||'—')+'</div><div class="sub">'+((podium[0]&&podium[0][1])||'—')+'</div></div>'+
      '</div>'+
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
  // Status dashboard
  var dash=EVENT_ORDER.map(function(ev){
    var cfg=EVENTS[ev], best=bestScore(ev), athlete=A();
    var pod=athlete.podium&&athlete.podium[ev];
    var gold=(pod&&pod[0]&&pod[0][2])||'—';
    return '<div class="dash-row"><div class="info"><div class="nm">'+cfg.name+'</div><div class="sb">'+((athlete.loads&&athlete.loads[ev])||'')+'</div></div>'+
      '<div class="vals"><div class="you">'+(best?fmtVal(ev,best.value):'—')+(best?medalIcon(medalFor(ev)):'')+'</div><div class="gold">Gold: '+gold+'</div></div>'+deltaBadge(ev)+'</div>';
  }).join('');
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
        var delBtn = l.id ? '<button class="hist-del" data-id="'+l.id+'" title="Delete">🗑</button>' : '';
        return '<div class="hist-row"><span class="ev">'+EVENTS[l.event].name+(isPR?'<span class="pr">PR</span>':'')+'</span><span class="actions"><span class="sc">'+fmtVal(l.event,l.value)+'</span>'+delBtn+'</span></div>';
      }).join('');
      var compTag = (date==='2025-09-21') ? ' <span class="comp-day">🏆 2025 Senior Games</span>' : '';
      return '<div class="hist-day"><div class="date">'+date+compTag+'</div>'+rows+'</div>';
    }).join('');
  }
  document.getElementById('progressView').innerHTML=
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
      var youSub=athlete.division+(youLoad?' · '+youLoad:'');
      var youCard='<div class="scout-you">'+
        '<div class="sy-lbl">Your Best</div>'+
        '<div class="sy-val">'+(best?fmtVal(ev,best.value):'—')+(best?medalIcon(medalFor(ev)):'')+'</div>'+
        '<div class="sy-sub">'+youSub+(best?' · '+best.date:'')+'</div>'+
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

// ===== Program tab (fetch /program/, render this week) =====
async function renderProgram(){
  var host=document.getElementById('programView');
  if(_programCache){ host.innerHTML=_programCache; return; }
  host.innerHTML='<div class="empty"><div class="spinner"></div><div class="msg" style="margin-top:14px">Loading this week’s program…</div></div>';
  try{
    var res=await fetch('/program/');
    if(!res.ok) throw new Error('HTTP '+res.status);
    var txt=await res.text();
    var em=txt.match(/const EVENTS = (\[[\s\S]*?\]);/);
    if(!em) throw new Error('program data not found');
    var events=JSON.parse(em[1]);
    var wt=txt.match(/<h2>(Week of [^<]+)<\/h2>/);
    var ws=txt.match(/week-sub">([^<]+)</);
    var wd=txt.match(/week-dates">([^<]+)</);
    var TYPE={sprint:'⚡ Sprint',marathon:'🔋 Marathon'};
    var html='<div class="prog-banner"><h2>'+(wt?wt[1]:'This Week')+'</h2>'+
      (ws?'<div class="sub">'+ws[1]+'</div>':'')+
      (wd?'<div class="dates">'+wd[1]+'</div>':'')+
      '<a class="open" href="/program/">Open Full Program →</a></div>';
    var aLoads=A().loads||{};
    var keyByName={'KB Box Squat':'kbsquat','Dynamax OH Throw':'dynamax','Bench Press':'bench','Overhead Arm Hang':'hang','Med Ball Slams':'slams','Jump Rope · 60s':'jumprope','Standing Broad Jump':'broadjump','Concept Row · 500m':'row','300 Yd Shuttle Run':'shuttle','Prowler Push':'prowler'};
    html+=events.map(function(e,idx){
      var k=keyByName[e.event];
      var load=k&&aLoads[k]?aLoads[k]:'';
      var pats=(e.patterns||[]).map(function(p){
        var cues=(p.cues||[]).map(function(c){ return '<li>'+c+'</li>'; }).join('');
        return '<div class="prog-pat"><div class="pp-name">'+p.name+'</div><div class="pp-rx">'+(p.rx||'')+'</div>'+(p.load?'<div class="pp-rx" style="color:var(--text-dim);font-weight:500">'+p.load+'</div>':'')+(cues?'<ul class="pp-cues">'+cues+'</ul>':'')+'</div>';
      }).join('');
      return '<div class="prog-event collapsed" id="pe_'+idx+'">'+
        '<div class="prog-event-head" onclick="SDSG.toggleProg('+idx+')">'+
          '<div><span class="pe-name">'+e.event+'</span> <span class="pe-tag">'+(TYPE[e.type]||'')+(e.tag?' · '+e.tag:'')+'</span></div>'+
          (load?'<span class="pe-load">'+load+'</span>':'')+
        '</div>'+
        '<div class="prog-body">'+pats+'</div>'+
      '</div>';
    }).join('');
    _programCache=html;
    host.innerHTML=html;
  }catch(e){
    console.error(e);
    host.innerHTML='<div class="empty"><div class="ico">⚠️</div><div class="msg">Couldn’t load the program.<br>Open <a href="/program/" style="color:var(--teal)">/program/</a> directly.</div></div>';
  }
}
function toggleProg(idx){
  var el=document.getElementById('pe_'+idx); if(!el) return;
  el.classList.toggle('collapsed');
}

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
function renderStats(){
  var logged=new Set(cachedLogs.map(function(l){return l.event;})).size;
  var sl=document.getElementById('statLogged'); if(sl) sl.textContent=logged+'/10';
  var golds=0; EVENT_ORDER.forEach(function(ev){ var d=goldDelta(ev); if(d&&d.pct>=0) golds++; });
  var grouped={}; cachedLogs.forEach(function(l){ (grouped[l.event]=grouped[l.event]||[]).push(l); });
  var prs=0; Object.keys(grouped).forEach(function(ev){ if(grouped[ev].length>1) prs+=Math.max(0,grouped[ev].length-1); });
  var sg=document.getElementById('statGold'); if(sg) sg.textContent=golds;
  var sp=document.getElementById('statPRs'); if(sp) sp.textContent=prs;
}
function render(){
  try{ document.title = A().name + " · SDSG '26 · Yeager's Gym"; }catch(e){}
  renderHeader(); renderStats(); renderProfileInto('profileCard');
  if(currentView==='log') renderLog();
  else if(currentView==='progress') renderProgress();
  else if(currentView==='scouting') renderScouting();
  else if(currentView==='program') renderProgram();
}
function setView(v){
  currentView=v;
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.toggle('active',t.dataset.view===v); });
  ['log','program','progress','scouting'].forEach(function(name){
    var el=document.getElementById(name+'View'); if(el) el.hidden=(name!==v);
    var wrap=document.getElementById(name+'Wrap'); if(wrap) wrap.hidden=(name!==v);
  });
  render();
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
  if(EVENTS[ev].unit==='time' && !/^\d{1,2}:[0-5]\d$/.test(raw)){ toast('Use M:SS format (e.g. 2:00)'); return; }
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
    if(isPR&&prevBest) toast('🔥 NEW PR — '+EVENTS[ev].name,true,undo);
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
  _timerState={};
  document.querySelectorAll('.athlete-switch button').forEach(function(b){ b.classList.toggle('active',b.dataset.athlete===key); });
  setSyncStatus('syncing','Loading');
  try{ cachedLogs=await loadLogs(slug()); await ensureBaselines(slug()); setSyncStatus('synced'); render(); }
  catch(e){ console.error(e); setSyncStatus('offline','Load failed'); toast('Load failed — check connection'); }
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
function _readFs(){ var v=parseFloat(localStorage.getItem(FS_KEY)); return (isNaN(v)||!v)?1:v; }
function _applyFs(){
  var fs=_readFs();
  document.documentElement.style.setProperty('--fs', fs);
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
    cachedLogs=await loadLogs(slug());
    await ensureBaselines(slug());
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
  toggleProg:toggleProg, setFontScale:setFontScale
};

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
