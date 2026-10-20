(() => {
"use strict";
const $ = id => document.getElementById(id);
const KEY_LANES = {f:0,g:1,h:2,j:3};
const KEY_NAMES = ["F","G","H","J"];
const ALLOWED = {0:[1],1:[0,2],2:[1,3],3:[2]};
const PERFECT = 45, GREAT = 90, MISS = 150;
const defaultChart = {
  title:"Scratch Steps", bpm:120, duration:30,
  notes:[
    {type:"tap",lane:0,time:1.5},{type:"tap",lane:1,time:1.75},{type:"tap",lane:2,time:2.0},{type:"tap",lane:3,time:2.25},
    {type:"tap",lane:3,time:3.0},{type:"tap",lane:2,time:3.25},{type:"tap",lane:1,time:3.5},{type:"tap",lane:0,time:3.75},
    {type:"hold",lane:0,time:5.0,end:6.2},{type:"tap",lane:1,time:5.3},{type:"tap",lane:2,time:5.6},{type:"tap",lane:3,time:5.9},
    {type:"flick",lane:0,to:1,time:7.0},{type:"flick",lane:2,to:3,time:7.75},{type:"flick",lane:3,to:2,time:8.5},
    {type:"tap",lane:0,time:10.0},{type:"tap",lane:1,time:10.125},{type:"tap",lane:2,time:10.25},{type:"tap",lane:3,time:10.375},
    {type:"tap",lane:3,time:11.0},{type:"tap",lane:2,time:11.125},{type:"tap",lane:1,time:11.25},{type:"tap",lane:0,time:11.375},
    {type:"hold",lane:1,time:13.0,end:14.6},{type:"tap",lane:0,time:13.25},{type:"tap",lane:2,time:13.75},{type:"tap",lane:3,time:14.25},
    {type:"flick",lane:1,to:2,time:16.0},{type:"flick",lane:2,to:1,time:16.75},{type:"flick",lane:0,to:1,time:17.5},{type:"flick",lane:3,to:2,time:18.25},
    {type:"tap",lane:0,time:20.0},{type:"tap",lane:1,time:20.2},{type:"tap",lane:2,time:20.4},{type:"tap",lane:3,time:20.6},
    {type:"hold",lane:2,time:22.0,end:24.0},{type:"tap",lane:0,time:22.25},{type:"tap",lane:1,time:22.75},{type:"tap",lane:3,time:23.25},
    {type:"tap",lane:3,time:25.0},{type:"tap",lane:2,time:25.15},{type:"tap",lane:1,time:25.3},{type:"tap",lane:0,time:25.45}
  ]
};
let chart = structuredClone(defaultChart), runtime = [], running = false, paused = false, ended = false;
let startAt = 0, pauseAt = 0, raf = 0, score = 0, combo = 0, maxCombo = 0, totalWeight = 0, earnedWeight = 0, judged = 0;
let keyDown = [false,false,false,false], lastPress = [0,0,0,0], holdState = [null,null,null,null];
let audioCtx = null, audioStarted = false;
const game = $("game"), notesEl = $("notes");
const laneEls = [...document.querySelectorAll(".lane")];

function validateChart(obj) {
  if (!obj || !Array.isArray(obj.notes)) throw new Error("notes配列が必要です");
  const duration = Number(obj.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("durationは正の数にしてください");
  const notes = obj.notes.map((n,i) => {
    const type = String(n.type || "").toLowerCase(), lane = Number(n.lane), time = Number(n.time);
    if (!["tap","hold","flick"].includes(type)) throw new Error(`${i+1}番目: typeはtap/hold/flick`);
    if (!Number.isInteger(lane) || lane<0 || lane>3 || !Number.isFinite(time) || time<0) throw new Error(`${i+1}番目: lane/timeが不正です`);
    const out = {type,lane,time};
    if(type==="hold"){out.end=Number(n.end);if(!Number.isFinite(out.end)||out.end<=time)throw new Error(`${i+1}番目: HOLDのendはtimeより後にしてください`);}
    if(type==="flick"){out.to=Number(n.to);if(!Number.isInteger(out.to)||!ALLOWED[lane].includes(out.to))throw new Error(`${i+1}番目: FLICKの移動先が不正です`);}
    return out;
  }).sort((a,b)=>a.time-b.time);
  return {title:String(obj.title||"Untitled Chart"),bpm:Number(obj.bpm)||120,duration,notes};
}
function setChart(obj) {
  chart = validateChart(obj);
  $("songTitle").textContent=chart.title;
  $("songInfo").textContent=`${chart.bpm} BPM · 4 KEYS · ${chart.notes.length} NOTES`;
  $("timeLabel").textContent=`0:00 / ${fmt(chart.duration)}`;
  $("chartText").value=JSON.stringify(chart,null,2);
  resetGame();
}
function fmt(sec){sec=Math.max(0,Math.floor(sec));return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`;}
function resetGame(){
  cancelAnimationFrame(raf);running=false;paused=false;ended=false;score=combo=maxCombo=totalWeight=earnedWeight=judged=0;
  keyDown=[false,false,false,false];lastPress=[0,0,0,0];holdState=[null,null,null,null];
  notesEl.innerHTML="";runtime=chart.notes.map((n,i)=>({...n,id:i,status:"pending",el:null,holdHit:false}));
  updateHud();$("progress").style.width="0%";$("countdown").classList.remove("hidden");$("pauseOverlay").classList.add("hidden");
  $("overlayTitle").textContent="準備できた？";$("overlayText").textContent="TAPも隣のキーへ擦ってOK！ HOLDとFLICKもあるよ。";$("startButton").textContent="START";$("pauseButton").disabled=true;
  runtime.forEach(n=>{const el=document.createElement("div");el.className=`note ${n.type}`;el.style.setProperty("--lane",n.lane);if(n.type==="tap")el.textContent="TAP";if(n.type==="hold"){el.textContent="HOLD";const body=document.createElement("div");body.className="hold-body";el.append(body);}if(n.type==="flick"){el.textContent="FLICK";el.dataset.arrow=n.to>n.lane?"↗":"↖";}notesEl.append(el);n.el=el;});
}
function startGame(){
  if(running)return;
  if(ended)resetGame();
  $("countdown").classList.add("hidden");$("pauseOverlay").classList.add("hidden");
  running=true;paused=false;ended=false;startAt=performance.now();$("pauseButton").disabled=false;
  initAudio();raf=requestAnimationFrame(tick);game.focus();
}
function initAudio(){try{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();audioCtx.resume();audioStarted=true;}catch(e){}}
function beep(freq=600,duration=.045,wave="sine"){if(!audioStarted||!audioCtx)return;try{const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=wave;o.frequency.value=freq;g.gain.setValueAtTime(.055,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+duration);o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+duration);}catch(e){}}
function nowSec(){return ((paused?pauseAt:performance.now())-startAt)/1000;}
function tick(){
  if(!running||paused)return;
  const t=nowSec(),speed=Number($("speed").value),offset=Number($("offset").value)/1000;
  const hitY=game.clientHeight-56;
  runtime.forEach(n=>{
    if(n.status==="hit"||n.status==="miss")return;
    const travel=(n.time+offset-t)*speed;
    const y=hitY-travel;
    n.el.style.top=`${y}px`;
    if(n.type==="hold"){
      const tailY=hitY-((n.end+offset-t)*speed);
      const body=n.el.querySelector(".hold-body");
      body.style.height=`${Math.max(0,n.end-n.time)*speed}px`;
      n.el.style.top=`${y}px`;
      if(t>n.end+offset+MISS/1000 && n.status==="pending")missNote(n);
    }else if(t>n.time+offset+MISS/1000 && n.status==="pending")missNote(n);
  });
  $("progress").style.width=`${Math.min(100,t/chart.duration*100)}%`;
  $("timeLabel").textContent=`${fmt(t)} / ${fmt(chart.duration)}`;
  checkHoldEnds(t,offset);
  if(t>chart.duration+1.5){finishGame();return;}
  raf=requestAnimationFrame(tick);
}
function judge(delta){
  const a=Math.abs(delta)*1000;
  if(a<=PERFECT)return {name:"PERFECT",points:1000,weight:1};
  if(a<=GREAT)return {name:"GREAT",points:700,weight:.7};
  if(a<=MISS)return {name:"GOOD",points:400,weight:.4};
  return null;
}
function updateHud(){
  $("score").textContent=String(score).padStart(7,"0");$("combo").textContent=combo;$("maxCombo").textContent=maxCombo;
  $("accuracy").textContent=`${(judged?earnedWeight/judged*100:100).toFixed(2)}%`;
}
function showJudge(name){const el=$("judgement");el.textContent=name;el.classList.remove("pop");void el.offsetWidth;el.classList.add("pop");}
function register(n,delta){
  if(n.status!=="pending")return;
  const j=judge(delta);if(!j){missNote(n);return;}
  n.status="hit";n.el.classList.add("hit");score+=j.points;combo++;maxCombo=Math.max(combo,maxCombo);earnedWeight+=j.weight;judged++;updateHud();showJudge(j.name);beep(j.name==="PERFECT"?880:j.name==="GREAT"?660:440,j.name==="PERFECT"?.055:.04);
}
function missNote(n){
  if(n.status!=="pending")return;n.status="miss";n.el.classList.add("hit");combo=0;judged++;earnedWeight+=0;updateHud();showJudge("MISS");
}
function candidates(lane,t,types=["tap","hold","flick"]){
  const offset=Number($("offset").value)/1000;
  return runtime.filter(n=>n.status==="pending"&&types.includes(n.type)&&n.lane===lane&&Math.abs((t-(n.time+offset)))<=MISS/1000)
    .sort((a,b)=>Math.abs(t-a.time-offset)-Math.abs(t-b.time-offset));
}
function pressLane(lane){
  const t=nowSec(),offset=Number($("offset").value)/1000;lastPress[lane]=t;keyDown[lane]=true;laneEls[lane].classList.add("active");flashLane(lane);beep(330+lane*95,.025,"triangle");
  if(!running||paused)return;
  // 1) A fresh press can hit a TAP or start a HOLD on that lane.
  const normal=candidates(lane,t,["tap","hold"]);
  if(normal.length){const n=normal[0];if(n.type==="tap")register(n,t-(n.time+offset));else startHold(n,t,offset);}
  // 2) FLICK: either the source is newly pressed and destination is already held,
  //    or the source is held and this newly pressed lane is a valid destination (scratch).
  const flickAsDestination=runtime.filter(n=>n.status==="pending"&&n.type==="flick"&&n.to===lane&&keyDown[n.lane]&&Math.abs(t-(n.time+offset))<=MISS/1000).sort((a,b)=>Math.abs(t-a.time-offset)-Math.abs(t-b.time-offset))[0];
  if(flickAsDestination)register(flickAsDestination,t-(flickAsDestination.time+offset));
  const flickAsSource=runtime.filter(n=>n.status==="pending"&&n.type==="flick"&&n.lane===lane&&keyDown[n.to]&&Math.abs(t-(n.time+offset))<=MISS/1000).sort((a,b)=>Math.abs(t-a.time-offset)-Math.abs(t-b.time-offset))[0];
  if(flickAsSource)register(flickAsSource,t-(flickAsSource.time+offset));
  // 3) TAP scratch: pressing a neighboring lane while the previous lane remains held
  //    can hit a TAP in the destination lane. Do not repeat-hit a lane while key is held.
  const neighbors=[lane-1,lane+1].filter(x=>x>=0&&x<4);
  for(const from of neighbors){
    if(keyDown[from]){
      const scratch=candidates(lane,t,["tap"])[0];
      if(scratch){register(scratch,t-(scratch.time+offset));break;}
    }
  }
}
function startHold(n,t,offset){
  const delta=t-(n.time+offset),j=judge(delta);if(!j){missNote(n);return;}
  n.status="holding";n.holdHit=true;holdState[n.lane]=n;n.el.classList.add("hit");score+=j.points;combo++;maxCombo=Math.max(combo,maxCombo);earnedWeight+=j.weight;judged++;updateHud();showJudge(j.name);beep(520,.05);
}
function checkHoldEnds(t,offset){
  for(let lane=0;lane<4;lane++){
    const n=holdState[lane];if(!n)continue;
    if(t>=n.end+offset){
      if(keyDown[lane]){n.status="hit";holdState[lane]=null;combo++;maxCombo=Math.max(combo,maxCombo);score+=500;judged++;earnedWeight+=1;updateHud();showJudge("HOLD OK");beep(740,.06);}
      else{n.status="miss";holdState[lane]=null;combo=0;judged++;updateHud();showJudge("HOLD MISS");}
    }else if(!keyDown[lane]){n.status="miss";holdState[lane]=null;combo=0;judged++;updateHud();showJudge("HOLD MISS");}
  }
}
function releaseLane(lane){keyDown[lane]=false;laneEls[lane].classList.remove("active");}
function flashLane(lane){const f=document.createElement("div");f.className="flash";f.style.left=`calc(9% + ${lane}*20.5%)`; $("laneFlash").append(f);setTimeout(()=>f.remove(),220);}
function finishGame(){running=false;ended=true;$("pauseButton").disabled=true;$("countdown").classList.remove("hidden");$("overlayTitle").textContent="RESULT";$("overlayText").textContent=`SCORE ${String(score).padStart(7,"0")}　MAX COMBO ${maxCombo}　ACCURACY ${(judged?earnedWeight/judged*100:100).toFixed(2)}%`;$("startButton").textContent="もう一度プレイ";$("progress").style.width="100%";}
function togglePause(){if(!running&&!paused)return;if(!paused){paused=true;pauseAt=performance.now();$("pauseOverlay").classList.remove("hidden");}else{const delta=performance.now()-pauseAt;startAt+=delta;paused=false;$("pauseOverlay").classList.add("hidden");raf=requestAnimationFrame(tick);}}
window.addEventListener("keydown",e=>{
  const key=e.key.toLowerCase();
  if(key===" "){e.preventDefault();if(!e.repeat)togglePause();return;}
  if(key==="escape"){if(running||paused)togglePause();return;}
  if(!(key in KEY_LANES)||e.repeat)return;
  e.preventDefault();pressLane(KEY_LANES[key]);
});
window.addEventListener("keyup",e=>{const key=e.key.toLowerCase();if(key in KEY_LANES)releaseLane(KEY_LANES[key]);});
window.addEventListener("blur",()=>{keyDown=[false,false,false,false];laneEls.forEach(l=>l.classList.remove("active"));if(running&&!paused)togglePause();});
$("startButton").addEventListener("click",()=>{if(ended)resetGame();startGame();});
$("resumeButton").addEventListener("click",togglePause);$("pauseButton").addEventListener("click",togglePause);$("retryButton").addEventListener("click",()=>{resetGame();game.focus();});
$("speed").addEventListener("input",()=>{$("speedValue").textContent=$("speed").value;});
$("offset").addEventListener("input",()=>{$("offsetValue").textContent=`${$("offset").value} ms`;});
$("editorToggle").addEventListener("click",()=>{$("chartPanel").classList.toggle("hidden");$("editorToggle").textContent=$("chartPanel").classList.contains("hidden")?"譜面を編集":"譜面を閉じる";});
$("applyChart").addEventListener("click",()=>{try{const obj=JSON.parse($("chartText").value);setChart(obj);$("chartMessage").textContent="譜面を適用しました";$("chartMessage").style.color="var(--hold)";}catch(e){$("chartMessage").textContent=`エラー: ${e.message}`;$("chartMessage").style.color="#ff8b9b";}});
$("downloadChart").addEventListener("click",()=>{const blob=new Blob([JSON.stringify(chart,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="chart.json";a.click();URL.revokeObjectURL(url);});
$("chartFile").addEventListener("change",async e=>{const f=e.target.files[0];if(!f)return;try{setChart(JSON.parse(await f.text()));$("chartMessage").textContent=`${f.name} を読み込みました`;$("chartPanel").classList.remove("hidden");}catch(err){alert(`譜面を読み込めません: ${err.message}`);}e.target.value="";});
setChart(defaultChart);
})();