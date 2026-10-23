(async () => {
  'use strict';
  const BPM = 186, BEAT = 60 / BPM, APPROACH = 1.85;
  let ROUND = 220.2, noteSpeed = 1.50, selectedDifficulty = 'ADVANCED', audioReady = false, audioFailed = false, audioObjectUrl = null;
  const DIFFICULTY_INFO = { ADVANCED:{level:7,count:417}, EXPERT:{level:11,count:706}, MASTER:{level:13,count:1174} };
  const CHART_DATA = await fetch('./charts/rokuchounen.json').then(response => { if (!response.ok) throw new Error('譜面JSONを読み込めません'); return response.json(); });
  const HIT_WINDOWS = { cp: 0.025, perfect: 0.055, great: 0.095, good: 0.16, miss: 0.19 };
  const LANE_KEYS = ['f','g','h','j'];
  const LANE_COLORS = ['#52e3ec','#a7a4ff','#ff9acb','#ffc16f'];
  const NOTE_COLORS = { TAP:'#4ce5ef', HOLD:'#b68cff', FLICK:'#ffb45f' };
  const JUDGE_COLORS = { 'CRITICAL PERFECT':'#ff8bd5', 'PERFECT':'#ffe28a', 'GREAT':'#82f0d2', 'GOOD':'#82c5ff', 'MISS':'#ff777d' };
  const POINTS = { 'CRITICAL PERFECT':1000, 'PERFECT':980, 'GREAT':800, 'GOOD':500, 'MISS':0 };
  const $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const wrap = $('canvasWrap');
  let width=900, height=480, dpr=1, hitY=390, laneW=190, laneGap=7, laneLeft=45, pxPerSec=190;
  let notes=[], songTime=0, playing=false, paused=false, started=false, ended=false, muted=false;
  let wallStart=0, pausedTime=0, nextBeat=0, raf=0, audioCtx=null;
  let score=0, combo=0, maxCombo=0, judgedCount=0, earnedPoints=0;
  let counts={ 'CRITICAL PERFECT':0,'PERFECT':0,'GREAT':0,'GOOD':0,'MISS':0 };
  let lanePressed=[false,false,false,false], arrowPressed={left:false,right:false}, activeHolds=[null,null,null,null];
  let popups=[null,null,null,null], particles=[], toastTimer=null;
  let pointer=null, lastFrame=0;
  let stats=[];

  function fitCanvas(){
    const r=wrap.getBoundingClientRect();
    width=Math.max(320,r.width); height=Math.max(300,r.height); dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.floor(width*dpr); canvas.height=Math.floor(height*dpr); ctx.setTransform(dpr,0,0,dpr,0,0);
    laneGap=Math.max(5,width*0.008); laneLeft=Math.max(12,width*0.045); laneW=(width-2*laneLeft-3*laneGap)/4;
    hitY=height-70; pxPerSec=(hitY-28)/APPROACH;
    draw();
  }
  window.addEventListener('resize',fitCanvas);

  function rand(seed){ let x=Math.sin(seed*127.1+311.7)*43758.5453; return x-Math.floor(x); }
  function makeChart(difficulty=selectedDifficulty){
    const data=CHART_DATA[difficulty]||CHART_DATA.ADVANCED;
    return data.map((d,id)=>({id,time:d[0],lane:d[1],type:d[2]==='T'?'TAP':d[2]==='H'?'HOLD':'FLICK',dir:d[3]<0?'left':d[3]>0?'right':null,duration:d[4],endTime:d[0]+d[4],status:'pending',judgeAtStart:null,delta:0}));
  }
  function resetGame(showOverlay=true){
    cancelAnimationFrame(raf); notes=makeChart(selectedDifficulty); songTime=0; playing=false; paused=false; started=false; ended=false; wallStart=0; pausedTime=0; nextBeat=0;
    try{ $('songAudio').pause(); $('songAudio').currentTime=0; }catch(e){}
    score=0; combo=0; maxCombo=0; judgedCount=0; earnedPoints=0;
    counts={ 'CRITICAL PERFECT':0,'PERFECT':0,'GREAT':0,'GOOD':0,'MISS':0 };
    lanePressed=[false,false,false,false]; arrowPressed={left:false,right:false}; activeHolds=[null,null,null,null]; popups=[null,null,null,null]; particles=[]; pointer=null; stats=[];
    $('score').textContent='0000000'; $('combo').innerHTML='0<span class="metric-sub">MAX <span id="maxCombo">0</span></span>'; $('accuracy').innerHTML='100.00<span class="metric-sub">%</span>';
    updateCounts(); $('progressFill').style.width='0%'; $('timeLabel').textContent=`00:00 / ${fmtTime(ROUND)}`; $('statusText').textContent='READY TO PLAY'; $('pauseBtn').disabled=true; $('pauseBtn').textContent='Ⅱ 一時停止';
    $('overlay').classList.toggle('hidden',!showOverlay);
    $('overlayCard').innerHTML=`<div class="eyebrow">READY · SET · RHYTHM</div><h2>HIT THE<br><span style="color:#63e4ec">BEAT.</span></h2><p>「六兆年と一夜物語」の音源に合わせてプレイ。<br>難易度とノーツ速度は上部から変更できるよ。</p><div class="keychips"><div class="keycap">F</div><div class="keycap">G</div><div class="keycap">H</div><div class="keycap">J</div></div><button class="primary-btn overlay-btn" id="startBtn">▶　ゲームスタート</button><p class="overlay-note">キーボード：FGHJ / G・HのFLICKは←・→で方向指定<br>タッチ・マウス：左右スワイプでTAP・FLICKも取得</p>`;
    $('startBtn').addEventListener('click',startGame,{once:true}); draw();
  }
  function ensureAudio(){
    if(!audioCtx){ const AC=window.AudioContext||window.webkitAudioContext; if(AC) audioCtx=new AC(); }
    if(audioCtx&&audioCtx.state==='suspended') audioCtx.resume().catch(()=>{});
  }
  function tone(freq=800,duration=0.045,volume=0.05,wave='sine'){
    if(muted||!audioCtx) return;
    try{ const o=audioCtx.createOscillator(),g=audioCtx.createGain(); const now=audioCtx.currentTime;
      o.type=wave;o.frequency.setValueAtTime(freq,now);g.gain.setValueAtTime(volume,now);g.gain.exponentialRampToValueAtTime(0.0001,now+duration);o.connect(g);g.connect(audioCtx.destination);o.start(now);o.stop(now+duration+.01);
    }catch(e){}
  }
  async function startGame(){
    ensureAudio();
    const audio=$('songAudio');
    if(!audioReady){ showToast(audioFailed?'音源ファイルを選んでね':'音源を読み込み中…'); if(audioFailed)$('audioFile').click(); return; }
    try{ audio.currentTime=0; await audio.play(); }
    catch(e){ showToast('再生できない場合は音源を選び直してね'); return; }
    songTime=audio.currentTime||0; wallStart=performance.now(); playing=true; paused=false; started=true; ended=false;
    $('overlay').classList.add('hidden'); $('pauseBtn').disabled=false; $('statusText').textContent='PLAYING';
    canvas.focus(); cancelAnimationFrame(raf); raf=requestAnimationFrame(loop);
  }
  function togglePause(){
    if(!started||ended) return;
    if(!paused){
      songTime=$('songAudio').currentTime||songTime; pausedTime=songTime; paused=true; playing=false; $('songAudio').pause();
      $('pauseBtn').textContent='▶ 再開'; $('statusText').textContent='PAUSED';
      $('overlayCard').innerHTML=`<div class="eyebrow">PAUSED</div><h2>TAKE A<br><span style="color:#63e4ec">BREATH.</span></h2><p>音源も一時停止中。速度や難易度を変えるならリセットして選び直してね。</p><button class="primary-btn overlay-btn" id="resumeBtn">▶　再開する</button>`;
      $('overlay').classList.remove('hidden'); $('resumeBtn').addEventListener('click',resumeGame,{once:true});
    }else resumeGame();
  }
  async function resumeGame(){
    if(ended)return;
    try{ await $('songAudio').play(); }catch(e){ showToast('音源を再生できません'); return; }
    paused=false; playing=true; wallStart=performance.now()-(($('songAudio').currentTime||0)*1000); pausedTime=$('songAudio').currentTime||0;
    $('overlay').classList.add('hidden'); $('pauseBtn').textContent='Ⅱ 一時停止'; $('statusText').textContent='PLAYING'; raf=requestAnimationFrame(loop);
  }
  function judgeForDelta(delta,note=null){
    // TAP/FLICK are intentionally a little more forgiving; HOLD timing stays unchanged.
    const factor=note&&(note.type==='TAP'||note.type==='FLICK')?1.25:1;
    const a=Math.abs(delta); if(a<=HIT_WINDOWS.cp*factor)return 'CRITICAL PERFECT'; if(a<=HIT_WINDOWS.perfect*factor)return 'PERFECT'; if(a<=HIT_WINDOWS.great*factor)return 'GREAT'; if(a<=HIT_WINDOWS.good*factor)return 'GOOD'; return 'MISS';
  }
  function nearestNote(lane,source){
    let best=null, bestAbs=Infinity;
    for(const n of notes){
      if(n.lane!==lane||n.status!=='pending')continue;
      if(source==='rub'&&n.type==='HOLD')continue;
      const d=n.time-songTime, ad=Math.abs(d);
      const missWindow=HIT_WINDOWS.miss*((n.type==='TAP'||n.type==='FLICK')?1.25:1);
      if(d < -missWindow)continue;
      if(ad<bestAbs){best=n;bestAbs=ad;}
    }
    return best && bestAbs<=HIT_WINDOWS.good*((best.type==='TAP'||best.type==='FLICK')?1.25:1) ? best : null;
  }
  function laneInput(lane,source='key',dir=null){
    if(!playing||paused||ended)return;
    const note=nearestNote(lane,source); if(!note)return;
    const delta=songTime-note.time; const rank=judgeForDelta(delta,note);
    if(rank==='MISS')return;
    if(note.type==='FLICK'){
      if(!dir){showToast('G / H のFLICKは ← / → を指定');return;}
      if(dir!==note.dir){showToast(`方向ちがい！　このノーツは ${note.dir==='left'?'← 左':'右 →'}`);return;}
    }
    if(source==='rub' && note.type==='HOLD')return;
    if(note.type==='HOLD'){
      note.status='holding'; note.judgeAtStart=rank; note.delta=delta; activeHolds[lane]=note;
      popups[lane]={text:'HOLD',color:NOTE_COLORS.HOLD,until:songTime+.36};
      tone(560,.05,.035,'triangle');
    }else{
      note.status='done'; note.judgement=rank; applyJudgement(rank,lane,note); tone(note.type==='FLICK'?1040:760,.045,.045,'sine');
    }
  }
  function releaseLane(lane){
    lanePressed[lane]=false;
    const n=activeHolds[lane]; if(!n||n.status!=='holding')return;
    const remaining=n.endTime-songTime;
    if(remaining>0.11){ failHold(n,lane); }
    else completeHold(n,lane);
  }
  function completeHold(n,lane){
    if(!n||n.status!=='holding')return;
    n.status='done'; n.judgement=n.judgeAtStart||'PERFECT'; activeHolds[lane]=null;
    applyJudgement(n.judgement,lane,n); tone(900,.07,.04,'triangle');
  }
  function failHold(n,lane){
    if(!n||n.status!=='holding')return;
    n.status='done'; n.judgement='MISS'; activeHolds[lane]=null; applyJudgement('MISS',lane,n); showToast('HOLD BREAK · MISS');
  }
  function applyJudgement(rank,lane,note){
    counts[rank]++; judgedCount++; earnedPoints+=POINTS[rank]; score+=POINTS[rank];
    if(rank==='MISS')combo=0;else{combo++;maxCombo=Math.max(maxCombo,combo);}
    popups[lane]={text:rank,color:JUDGE_COLORS[rank],until:songTime+.62};
    const noteX=laneLeft+lane*(laneW+laneGap)+laneW/2;
    for(let i=0;i<(rank==='MISS'?3:9);i++) particles.push({x:noteX+(Math.random()-.5)*laneW*.6,y:hitY-4,vx:(Math.random()-.5)*85,vy:-Math.random()*100-22,life:.35+Math.random()*.38,max:.73,color:rank==='MISS'?'#ff777d':(NOTE_COLORS[note?.type]||JUDGE_COLORS[rank]),r:1.5+Math.random()*2.5});
    updateHUD(); updateCounts();
  }
  function updateHUD(){
    $('score').textContent=String(score).padStart(7,'0');
    $('combo').innerHTML=`${combo}<span class="metric-sub">MAX <span id="maxCombo">${maxCombo}</span></span>`;
    const acc=judgedCount?earnedPoints/(judgedCount*1000)*100:100;
    $('accuracy').innerHTML=`${acc.toFixed(2)}<span class="metric-sub">%</span>`;
  }
  function updateCounts(){ $('countCP').textContent=counts['CRITICAL PERFECT'];$('countP').textContent=counts['PERFECT'];$('countGr').textContent=counts['GREAT'];$('countGd').textContent=counts['GOOD'];$('countM').textContent=counts['MISS']; }
  function showToast(s){const t=$('toast');t.textContent=s;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),850);}

  function getFlickDir(lane){
    if(arrowPressed.left&&arrowPressed.right)return null;
    if(arrowPressed.left)return 'left'; if(arrowPressed.right)return 'right';
    if(lane===0)return 'right'; if(lane===3)return 'left'; return null;
  }
  document.addEventListener('keydown',e=>{
    const k=e.key.toLowerCase();
    if(['arrowleft','arrowright',' ','arrowup','arrowdown'].includes(k))e.preventDefault();
    if(k==='arrowleft'||k==='arrowright'){
      if(e.repeat)return; arrowPressed[k==='arrowleft'?'left':'right']=true;
      lanePressed.forEach((down,i)=>{if(down&&activeHolds[i]===null){const n=nearestNote(i,'key');if(n&&n.type==='FLICK')laneInput(i,'key',getFlickDir(i));}}); return;
    }
    if(k===' '){if(!e.repeat&&started)togglePause();return;}
    const lane=LANE_KEYS.indexOf(k); if(lane<0||e.repeat)return;
    lanePressed[lane]=true; laneInput(lane,'key',getFlickDir(lane));
  });
  document.addEventListener('keyup',e=>{
    const k=e.key.toLowerCase();
    if(k==='arrowleft'||k==='arrowright'){arrowPressed[k==='arrowleft'?'left':'right']=false;return;}
    const lane=LANE_KEYS.indexOf(k);if(lane>=0)releaseLane(lane);
  });
  window.addEventListener('blur',()=>{
    lanePressed.forEach((v,i)=>{if(v)releaseLane(i)}); arrowPressed={left:false,right:false};
  });

  function laneAt(x){return Math.max(0,Math.min(3,Math.floor((x-laneLeft)/(laneW+laneGap))));}
  function localPoint(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
  canvas.addEventListener('pointerdown',e=>{
    if(!playing||paused)return; e.preventDefault(); canvas.setPointerCapture?.(e.pointerId);
    const p=localPoint(e), lane=laneAt(p.x);pointer={id:e.pointerId,startX:p.x,startY:p.y,lastX:p.x,lastY:p.y,startLane:lane,lastLane:lane,didSwipe:false,visited:new Set(),startTime:performance.now()};
    lanePressed[lane]=true; laneInput(lane,'pointer',null);
  });
  canvas.addEventListener('pointermove',e=>{
    if(!pointer||pointer.id!==e.pointerId||!playing||paused)return; e.preventDefault();
    const p=localPoint(e), dx=p.x-pointer.lastX, total=p.x-pointer.startX;
    const nearLine=Math.abs(p.y-hitY)<122 && Math.abs(p.y-pointer.lastY)<100;
    if(Math.abs(total)>=17 && nearLine && Math.abs(dx)>0.1){
      pointer.didSwipe=true; const dir=total<0?'left':'right';
      if(pointer.visited.size===0)rubLane(pointer.startLane,dir,pointer.visited);
      const prev=laneAt(pointer.lastX), now=laneAt(p.x);
      if(now!==prev){
        const step=now>prev?1:-1;
        for(let l=prev+step;;l+=step){rubLane(l,dir,pointer.visited);if(l===now)break;}
      }else if(!pointer.visited.has(now)){
        // A quick sideways motion within a lane counts as a flick/rub too.
        rubLane(now,dir,pointer.visited);
      }
    }
    pointer.lastX=p.x;pointer.lastY=p.y;
  });
  function rubLane(lane,dir,visited){
    // A new gesture may pass each lane once; this supports CHUNITHM-like rubbing.
    if(visited.has(lane))return;visited.add(lane);laneInput(lane,'rub',dir);
  }
  function finishPointer(e){
    if(!pointer||pointer.id!==e.pointerId)return;
    const p=localPoint(e), travel=Math.abs(p.x-pointer.startX), dy=Math.abs(p.y-pointer.startY);
    // A stationary pointer has already triggered its lane on pointerdown; release HOLD here.
    if(pointer.startLane>=0)releaseLane(pointer.startLane);
    pointer=null;
  }
  canvas.addEventListener('pointerup',finishPointer);canvas.addEventListener('pointercancel',e=>{if(pointer?.id===e.pointerId){releaseLane(pointer.startLane);pointer=null;}});

  function loop(now){
    if(!playing||paused)return;
    songTime=Math.max(0,$('songAudio').currentTime||0);
    for(const n of notes){
      if(n.status==='pending'&&songTime>n.time+HIT_WINDOWS.miss*((n.type==='TAP'||n.type==='FLICK')?1.25:1)){n.status='done';n.judgement='MISS';applyJudgement('MISS',n.lane,n);}
      if(n.status==='holding'){
        if(!lanePressed[n.lane]&&songTime<n.endTime-.11)failHold(n,n.lane);
        else if(songTime>=n.endTime)completeHold(n,n.lane);
      }
    }
    $('progressFill').style.width=`${Math.min(100,songTime/ROUND*100)}%`;
    $('timeLabel').textContent=`${fmtTime(songTime)} / ${fmtTime(ROUND)}`;
    if(songTime>=ROUND-0.025){songTime=ROUND;endGame();return;}
    draw();raf=requestAnimationFrame(loop);
  }
  function fmtTime(s){s=Math.max(0,Math.floor(s));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
  function endGame(){
    playing=false;ended=true;$('songAudio').pause();$('pauseBtn').disabled=true;$('statusText').textContent='SESSION COMPLETE';$('progressFill').style.width='100%';$('timeLabel').textContent=`${fmtTime(ROUND)} / ${fmtTime(ROUND)}`;
    draw(); const acc=judgedCount?earnedPoints/(judgedCount*1000)*100:0;
    const rank=acc>=98?'S':acc>=93?'A':acc>=85?'B':acc>=70?'C':'D';
    $('overlayCard').innerHTML=`<div class="eyebrow">SESSION COMPLETE</div><h2 style="font-size:23px;margin-bottom:4px">NICE <span style="color:#63e4ec">PLAY.</span></h2><div style="font-size:64px;font-weight:950;line-height:1.08;color:#ffe28a;text-shadow:0 0 30px rgba(255,226,138,.18)">${rank}</div><p>最後までプレイお疲れさま。リザルトを確認して、もう一度挑戦しよう。</p><div class="result-grid"><div class="result-cell"><b>${score.toLocaleString('en-US')}</b><span>SCORE</span></div><div class="result-cell"><b>${acc.toFixed(2)}%</b><span>ACCURACY</span></div><div class="result-cell"><b>${maxCombo}</b><span>MAX COMBO</span></div></div><button class="primary-btn overlay-btn" id="againBtn">↻　もう一度プレイ</button>`;
    $('overlay').classList.remove('hidden');$('againBtn').addEventListener('click',()=>resetGame(false)||startGame(),{once:true});
  }

  function roundRect(c,x,y,w,h,r,fill,stroke=null,lineWidth=1){
    if(w<=0||h<=0)return; r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=lineWidth;c.stroke();}
  }
  function draw(){
    if(!ctx)return;ctx.clearRect(0,0,width,height);
    const bg=ctx.createLinearGradient(0,0,0,height);bg.addColorStop(0,'#0b1323');bg.addColorStop(.7,'#0b1220');bg.addColorStop(1,'#111a2b');ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);
    // Subtle diagonal / horizontal rhythm grid.
    ctx.save();ctx.strokeStyle='rgba(133,159,215,.055)';ctx.lineWidth=1;
    for(let y=22;y<height;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
    for(let x=0;x<width;x+=36){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}ctx.restore();
    // Lane panels.
    for(let l=0;l<4;l++){
      const x=laneLeft+l*(laneW+laneGap);
      const grad=ctx.createLinearGradient(0,18,0,height);grad.addColorStop(0,'rgba(27,42,68,.38)');grad.addColorStop(.75,'rgba(13,23,40,.62)');grad.addColorStop(1,'rgba(22,34,55,.8)');
      roundRect(ctx,x,12,laneW,height-24,10,grad,'rgba(136,165,224,.09)');
      ctx.fillStyle=LANE_COLORS[l];ctx.globalAlpha=.65;ctx.font='800 11px system-ui';ctx.textAlign='center';ctx.fillText(LANE_KEYS[l].toUpperCase(),x+laneW/2,32);ctx.globalAlpha=1;
      ctx.fillStyle='rgba(160,181,229,.06)';ctx.fillRect(x+laneW/2-1,40,2,hitY-46);
    }
    // Flow accents behind the notes.
    const pulse=(Math.sin(songTime*Math.PI*2*2)+1)/2;
    for(let l=0;l<4;l++){
      const x=laneLeft+l*(laneW+laneGap);const gg=ctx.createLinearGradient(0,hitY-55,0,hitY+25);gg.addColorStop(0,'rgba(76,229,239,0)');gg.addColorStop(1,`rgba(${l===0?'76,229,239':l===1?'167,164,255':l===2?'255,154,203':'255,193,111'},${.035+pulse*.025})`);ctx.fillStyle=gg;ctx.fillRect(x,hitY-55,laneW,80);
    }
    // Hold notes first, so heads and taps render on top.
    for(const n of notes){
      if(n.status==='done'||n.type!=='HOLD')continue;
      const x=laneLeft+n.lane*(laneW+laneGap), cx=x+laneW/2;
      let yHead=hitY-(n.time-songTime)*pxPerSec*noteSpeed, yTail=hitY-(n.endTime-songTime)*pxPerSec*noteSpeed;
      if(yHead<-20||yTail>height+20)continue;
      const col=NOTE_COLORS.HOLD;const bodyTop=Math.max(8,yTail),bodyBottom=Math.min(height-4,yHead);
      if(bodyBottom>bodyTop){ctx.save();ctx.shadowColor=col;ctx.shadowBlur=n.status==='holding'?17:8;roundRect(ctx,cx-laneW*.15,bodyTop,laneW*.30,bodyBottom-bodyTop,7,n.status==='holding'?'rgba(182,140,255,.75)':'rgba(182,140,255,.43)',col,1.2);ctx.restore();}
      if(yTail>=2&&yTail<height)roundRect(ctx,cx-laneW*.20,yTail-3,laneW*.40,6,3,col);
      if(yHead>-18&&yHead<height+10){ctx.save();ctx.shadowColor=col;ctx.shadowBlur=13;roundRect(ctx,cx-laneW*.37,yHead-8,laneW*.74,16,6,col,'rgba(255,255,255,.8)',1);ctx.restore();}
      if(n.status==='holding'){
        ctx.save();ctx.globalAlpha=.9;ctx.fillStyle='#f5eaff';ctx.font='800 9px system-ui';ctx.textAlign='center';ctx.fillText('HOLD',cx,Math.max(50,hitY-22));ctx.restore();
      }
    }
    for(const n of notes){
      if(n.status==='done'||n.type==='HOLD')continue;
      const x=laneLeft+n.lane*(laneW+laneGap), y=hitY-(n.time-songTime)*pxPerSec*noteSpeed, cx=x+laneW/2;
      if(y<-24||y>height+25)continue;
      if(n.type==='TAP'){
        ctx.save();ctx.shadowColor=NOTE_COLORS.TAP;ctx.shadowBlur=14;roundRect(ctx,cx-laneW*.35,y-7,laneW*.70,14,7,NOTE_COLORS.TAP,'rgba(232,255,255,.9)',1);ctx.restore();
        ctx.fillStyle='rgba(255,255,255,.83)';roundRect(ctx,cx-laneW*.20,y-2,laneW*.40,3,2,'rgba(255,255,255,.75)');
      }else if(n.type==='FLICK'){
        ctx.save();ctx.translate(cx,y);ctx.shadowColor=NOTE_COLORS.FLICK;ctx.shadowBlur=16;
        roundRect(ctx,-laneW*.34,-10,laneW*.68,20,7,NOTE_COLORS.FLICK,'rgba(255,244,221,.95)',1);ctx.shadowBlur=0;
        ctx.fillStyle='#3a230e';ctx.font=`900 ${Math.max(14,Math.min(21,laneW*.16))}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(n.dir==='left'?'←':'→',0,0);ctx.restore();
      }
    }
    // Judgement line and lane activation pads.
    ctx.save();ctx.shadowColor='#60e5ef';ctx.shadowBlur=16;ctx.strokeStyle='rgba(99,230,239,.86)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(12,hitY);ctx.lineTo(width-12,hitY);ctx.stroke();ctx.restore();
    for(let l=0;l<4;l++){
      const x=laneLeft+l*(laneW+laneGap), active=lanePressed[l]||!!activeHolds[l];
      roundRect(ctx,x+2,hitY+12,laneW-4,27,8,active?LANE_COLORS[l]:'rgba(25,38,62,.95)',active?'rgba(255,255,255,.8)':'rgba(139,165,222,.15)',1);
      ctx.fillStyle=active?'#10162a':'#b4c2df';ctx.font='850 12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(LANE_KEYS[l].toUpperCase(),x+laneW/2,hitY+25.5);
      const p=popups[l];if(p&&p.until>=songTime){ctx.save();ctx.globalAlpha=Math.min(1,(p.until-songTime)/.14);ctx.shadowColor=p.color;ctx.shadowBlur=14;ctx.fillStyle=p.color;ctx.font=`900 ${p.text.length>10?11:14}px system-ui`;ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(p.text,x+laneW/2,hitY-18);ctx.restore();}
    }
    // Particle feedback.
    for(let i=particles.length-1;i>=0;i--){const p=particles[i];if(playing){p.x+=p.vx*.016;p.y+=p.vy*.016;p.vy+=80*.016;p.life-=.016;}if(p.life<=0){particles.splice(i,1);continue;}ctx.save();ctx.globalAlpha=Math.max(0,p.life/p.max);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();ctx.restore();}
    if(!started&&!ended){ctx.save();ctx.fillStyle='rgba(125,151,211,.22)';ctx.font='700 10px system-ui';ctx.textAlign='center';ctx.fillText('PRESS START TO BEGIN',width/2,height*.46);ctx.restore();}
  }

  $('pauseBtn').addEventListener('click',togglePause);
  $('restartBtn').addEventListener('click',()=>resetGame(true));
  $('soundBtn').addEventListener('click',()=>{muted=!muted;$('songAudio').muted=muted;$('soundBtn').textContent=muted?'♫ 音 OFF':'♫ 音 ON';$('soundBtn').style.opacity=muted?'.65':'1';if(!muted)ensureAudio();});
  function updateDifficultyUI(){
    const info=DIFFICULTY_INFO[selectedDifficulty]||DIFFICULTY_INFO.ADVANCED;
    $('levelLabel').textContent=`${selectedDifficulty} ${info.level}`;
    $('chartCount').textContent=`${CHART_DATA[selectedDifficulty].length.toLocaleString('en-US')} NOTES`;
    $('stageMeta').textContent=`4 LANES · ${selectedDifficulty} · ${CHART_DATA[selectedDifficulty].length.toLocaleString('en-US')} NOTES`;
    $('bpmMain').textContent='186';
  }
  function updateAudioStatus(ready, name='rokuchounen.mp3'){
    audioReady=ready;
    const el=$('audioStatus');
    el.textContent=ready?`音源OK · ${fmtTime(ROUND)}`:`音源未読込 · 「音源を選択」から追加`;
    el.classList.toggle('ready',ready);
    if(ready){ $('timeLabel').textContent=`00:00 / ${fmtTime(ROUND)}`; }
  }
  $('difficultySelect').addEventListener('change',e=>{
    selectedDifficulty=e.target.value; updateDifficultyUI(); resetGame(true);
  });
  $('speedSlider').addEventListener('input',e=>{
    noteSpeed=Number(e.target.value)||1; $('speedValue').textContent=`${noteSpeed.toFixed(2)}×`; draw();
  });
  $('audioLoadBtn').addEventListener('click',()=>$('audioFile').click());
  $('audioFile').addEventListener('change',e=>{
    const file=e.target.files&&e.target.files[0]; if(!file)return;
    try{ $('songAudio').pause(); }catch(err){}
    if(audioObjectUrl)URL.revokeObjectURL(audioObjectUrl);
    audioFailed=false; audioObjectUrl=URL.createObjectURL(file); $('songAudio').src=audioObjectUrl;
    updateAudioStatus(false); $('audioStatus').textContent=`読込中 · ${file.name}`; $('songAudio').load();
  });
  $('songAudio').addEventListener('loadedmetadata',()=>{
    if(Number.isFinite($('songAudio').duration)&&$('songAudio').duration>30){ ROUND=$('songAudio').duration; $('timeLabel').textContent=`00:00 / ${fmtTime(ROUND)}`; }
  });
  $('songAudio').addEventListener('canplay',()=>updateAudioStatus(true));
  $('songAudio').addEventListener('error',()=>{
    audioReady=false; audioFailed=true; $('audioStatus').textContent='音源未読込 · ZIP内の音源かMP3を選択'; $('audioStatus').classList.remove('ready');
  });
  updateDifficultyUI();

  fitCanvas(); resetGame(true);
  // Keep the play surface rendered even when the user is at the initial overlay.
  raf=requestAnimationFrame(function idle(){draw();if(!playing)raf=requestAnimationFrame(idle);});
})();
