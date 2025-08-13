const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  wave: document.getElementById("wave"),
  gold: document.getElementById("gold"),
  hp: document.getElementById("hp"),
  phase: document.getElementById("phase"),
  timer: document.getElementById("timer"),
  toast: document.getElementById("toast"),
  shopBtns: [...document.querySelectorAll(".pill-btn")],
  repair: document.getElementById("btn-repair"),
};

const assets = { tower:new Image(), enemy:new Image() };
assets.tower.src = "tower.png";
assets.enemy.src = "enemy.png";

let enemyReady=false, towerReady=false;
assets.enemy.onload = ()=> enemyReady=true;
assets.tower.onload = ()=> towerReady=true;
assets.enemy2 = new Image();
assets.enemy2.src = "enemy2.png"; 
let enemy2Ready = false;
assets.enemy2.onload = () => enemy2Ready = true;

const game = {
  gold: 180,
  wave: 1,
  towerHP: 100,
  towerHPMax: 100,
  phase: "build",
  buildTime: 30,
  buildTimer: 30,
  placing: "turret", 
  grid: { cols: 18, rows: 11, cell: 48, ox:0, oy:0 }, 
  barriers: new Set(), 
  turrets: [], 
  bullets: [],
  enemies: [],
  pathDirty: true,
  lastTime: performance.now(),
  paused: false,
  holdCancel: false,
  spawningEnemies: 0,
  towerCell: { x: 9, y: 5 }, 
};

function toast(msg){
  ui.toast.textContent = msg;
  ui.toast.style.opacity = "1";
  ui.toast.style.transform = "translateX(-50%) translateY(0)";
  setTimeout(()=>{ ui.toast.style.opacity = "0"; ui.toast.style.transform="translateX(-50%) translateY(-6px)"; }, 900);
}

function resize(){
  const pad = 8;
  const w = canvas.parentElement.clientWidth - pad*2;
  const h = Math.max(320, canvas.parentElement.clientHeight - pad*2);
  canvas.width = w; canvas.height = h;

  
  const aspect = w / h;
  const targetCell = 48;

  
  let cols = Math.max(12, Math.round(w / targetCell));
  let rows = Math.max(8, Math.round(h / targetCell));

  
  if (cols % 2 === 0) cols += 1;
  if (rows % 2 === 0) rows += 1;
  cols = Math.min(cols, 36);
  rows = Math.min(rows, 24);

  game.grid.cols = cols;
  game.grid.rows = rows;
  game.grid.cell = Math.floor(Math.min(w/cols, h/rows));
  const gridW = game.grid.cell * cols;
  const gridH = game.grid.cell * rows;
  game.grid.ox = Math.floor((w - gridW)/2);
  game.grid.oy = Math.floor((h - gridH)/2);

  game.towerCell = { x: Math.floor(cols/2), y: Math.floor(rows/2) };
  game.pathDirty = true;
}
window.addEventListener("resize", resize, { passive:true });

function inBounds(x,y){ return x>=0 && y>=0 && x<game.grid.cols && y<game.grid.rows; }
function key(x,y){ return `${x},${y}`; }

function cellToPx(gx,gy){
  const s = game.grid.cell;
  return { x: game.grid.ox + gx*s + s/2, y: game.grid.oy + gy*s + s/2 };
}
function pxToCell(px,py){
  const s = game.grid.cell;
  const gx = Math.floor((px - game.grid.ox) / s);
  const gy = Math.floor((py - game.grid.oy) / s);
  return { gx, gy };
}

function updateHUD(){
  ui.gold.textContent = game.gold;
  ui.hp.textContent = Math.max(0, game.towerHP);
  ui.wave.textContent = game.wave;
  ui.phase.textContent = game.phase.toUpperCase();
  ui.timer.textContent = game.phase === "build" ? (":" + Math.ceil(game.buildTimer).toString().padStart(2,"0")) : "—";
}

function canPlaceBarrier(gx,gy){
  if (!inBounds(gx,gy)) return false;
  if (gx===game.towerCell.x && gy===game.towerCell.y) return false;
  for (const t of game.turrets) if (t.gx===gx && t.gy===gy) return false;
  if (game.barriers.has(key(gx,gy))) return false;
  return true;
}
function canPlaceTurret(gx,gy){
  if (!inBounds(gx,gy)) return false;
  if (gx===game.towerCell.x && gy===game.towerCell.y) return false;
  if (game.barriers.has(key(gx,gy))) return false;
  for (const t of game.turrets) if (t.gx===gx && t.gy===gy) return false;
  return true;
}

function neighbors(x,y){
  const ns = [[1,0],[-1,0],[0,1],[0,-1]];
  const out=[];
  for (const [dx,dy] of ns){
    const nx=x+dx, ny=y+dy;
    if (!inBounds(nx,ny)) continue;
    if (game.barriers.has(key(nx,ny))) continue;
    out.push({x:nx,y:ny});
  }
  return out;
}
function h(a,b){ return Math.abs(a.x-b.x)+Math.abs(a.y-b.y); } 

function aStar(start, goal){
  if (game.barriers.has(key(goal.x,goal.y))) return null;
  const open = new Set([key(start.x,start.y)]);
  const came = new Map();
  const g = new Map(); g.set(key(start.x,start.y), 0);
  const f = new Map(); f.set(key(start.x,start.y), h(start,goal));

  function bestOpen(){
    let bestK=null, bestF=Infinity;
    for (const k of open){
      const v = f.get(k) ?? Infinity;
      if (v < bestF){ bestF=v; bestK=k; }
    }
    return bestK;
  }

  while (open.size){
    const ck = bestOpen();
    const [cx,cy] = ck.split(",").map(Number);
    if (cx===goal.x && cy===goal.y){
      const path=[{x:cx,y:cy}];
      let cur=ck;
      while (came.has(cur)){
        cur=came.get(cur);
        const [px,py]=cur.split(",").map(Number);
        path.push({x:px,y:py});
      }
      path.reverse();
      return path;
    }
    open.delete(ck);
    for (const n of neighbors(cx,cy)){
      const nk = key(n.x,n.y);
      const tentative = (g.get(ck) ?? Infinity) + 1;
      if (tentative < (g.get(nk) ?? Infinity)){
        came.set(nk, ck);
        g.set(nk, tentative);
        f.set(nk, tentative + h(n,goal));
        if (!open.has(nk)) open.add(nk);
      }
    }
  }
  return null;
}


function aStarIgnoreBarriers(start, goal){
  const open = new Set([key(start.x, start.y)]);
  const came = new Map();
  const g = new Map(); g.set(key(start.x, start.y), 0);
  const f = new Map(); f.set(key(start.x, start.y), h(start, goal));

  function bestOpen(){
    let bestK = null, bestF = Infinity;
    for (const k of open){
      const v = f.get(k) ?? Infinity;
      if (v < bestF){ bestF = v; bestK = k; }
    }
    return bestK;
  }

  while(open.size){
    const ck = bestOpen();
    const [cx, cy] = ck.split(",").map(Number);

    if(cx === goal.x && cy === goal.y){
      const path = [];
      let cur = ck;
      while(cur){
        const [px, py] = cur.split(",").map(Number);
        path.push({x:px, y:py});
        cur = came.get(cur);
      }
      path.reverse();
      return path;
    }

    open.delete(ck);

    const neighbors = [[1,0],[-1,0],[0,1],[0,-1]];
    for(const [dx, dy] of neighbors){
      const nx = cx + dx, ny = cy + dy;
      if(!inBounds(nx, ny)) continue;
      const nk = key(nx, ny);

      const tentative = (g.get(ck) ?? Infinity) + 1;
      if(tentative < (g.get(nk) ?? Infinity)){
        came.set(nk, ck);
        g.set(nk, tentative);
        f.set(nk, tentative + h({x:nx, y:ny}, goal));
        open.add(nk);
      }
    }
  }

  return null;
}

function anySpawnPathExists(){
  const rows = game.grid.rows, cols = game.grid.cols;
  const starts = [];
  for (let x=0;x<cols;x++){ starts.push({x, y:0}); starts.push({x, y:rows-1}); }
  for (let y=0;y<rows;y++){ starts.push({x:0, y}); starts.push({x:cols-1, y}); }
  for (let i=0;i<starts.length;i+=Math.ceil(starts.length/12)){ 
    const s = starts[i];
    if (game.barriers.has(key(s.x,s.y))) continue;
    const p = aStar(s, game.towerCell);
    if (p && p.length>1) return true;
  }
  return false;
}

function tryPlace(gx,gy){
  const sel = currentSelection();
  if (game.phase!=="build") return;
  if (sel==="sell"){
    
    for (let i=0;i<game.turrets.length;i++){
      const t = game.turrets[i];
      if (t.gx===gx && t.gy===gy){
        const refund = Math.max(10, Math.floor(t.spent*0.5));
        game.gold += refund;
        game.turrets.splice(i,1);
        game.pathDirty = true;
        updateHUD();
        toast(`+${refund}g (매각)`);
        return;
      }
    }
    if (game.barriers.has(key(gx,gy))){
      game.barriers.delete(key(gx,gy));
      game.pathDirty = true;
      toast("벽돌 제거함");
      return;
    }
    return;
  }
  if (sel==="barrier"){
    if (!canPlaceBarrier(gx,gy)) return;
    game.barriers.add(key(gx,gy));
    if (!anySpawnPathExists()){
      game.barriers.delete(key(gx,gy));
      toast("준호로 가는 경로가 없을 수는 없습니다.");
      return;
    }
    const cost = 20;
    if (game.gold < cost){ game.barriers.delete(key(gx,gy)); toast("Not enough gold"); return; }
    game.gold -= cost;
    game.pathDirty = true;
    updateHUD();
    return;
  }
  if (sel==="turret"){
    if (!canPlaceTurret(gx,gy)) return;
    const cost = 50;
    if (game.gold < cost){ toast("골드 부족!"); return; }
    game.gold -= cost;
    game.turrets.push({gx,gy,lv:1,dmg:6,rate:0.9,range:4.5,cd:0,spent:50});
    updateHUD();
    return;
  }
}

function currentSelection(){
  const active = ui.shopBtns.find(b=>b.classList.contains("active"));
  return active ? active.dataset.item : "turret";
}
ui.shopBtns.forEach(btn=>{
  btn.addEventListener("click", ()=>{
    ui.shopBtns.forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
  }, { passive:true });
});
ui.shopBtns[1].classList.add("active"); 

ui.repair.addEventListener("click", ()=>{
  if (game.phase!=="build") { toast("건설 단계에서 실행"); return; }
  if (game.gold < 30){ toast("골드 부족!"); return; }
  if (game.towerHP >= game.towerHPMax){ toast("준호 hp 최대"); return; }
  game.gold -= 30;
  game.towerHP = Math.min(game.towerHPMax, game.towerHP+10);
  updateHUD();
});

let pointer = { x:0, y:0, down:false, startT:0, startX:0, startY:0, long:false };
function setPointerFromEvent(e){
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (canvas.width / rect.width);
  const py = (e.clientY - rect.top) * (canvas.height / rect.height);
  pointer.x = px; pointer.y = py;
}
canvas.addEventListener("pointerdown", e=>{
  canvas.setPointerCapture(e.pointerId);
  setPointerFromEvent(e);
  pointer.down = true; pointer.startT = performance.now(); pointer.startX = pointer.x; pointer.startY = pointer.y; pointer.long=false;
});
canvas.addEventListener("pointermove", e=>{
  setPointerFromEvent(e);
});
canvas.addEventListener("pointerup", e=>{
  setPointerFromEvent(e);
  pointer.down=false;
  const dt = performance.now()-pointer.startT;
  const moved = Math.hypot(pointer.x-pointer.startX, pointer.y-pointer.startY);
  if (dt<350 && moved<10){
    const {gx,gy} = pxToCell(pointer.x, pointer.y);
    tryPlace(gx,gy);
  }
});
canvas.addEventListener("pointercancel", ()=>{ pointer.down=false; });

setInterval(()=>{
  if (!pointer.down || pointer.long) return;
  const dt = performance.now()-pointer.startT;
  if (dt>550){
    pointer.long=true;
    
    ui.shopBtns.forEach(b=>b.classList.remove("active"));
    toast("취소");
  }
}, 60);


document.getElementById("skipBuildBtn").addEventListener("click", ()=>{
    if (game.phase === "build"){
        game.buildTimer = 0;
        toast("건설 시간 건너뜀");
    }
});


function spawnWave(){
  const count = 5 + Math.floor(game.wave*2.7);
  const rows = game.grid.rows, cols = game.grid.cols;
  const sides = ["top","bottom","left","right"];

  game.spawningEnemies = count; 

  for (let i=0;i<count;i++){
    setTimeout(()=>{
      for (let tries=0;tries<10;tries++){
        const side = sides[Math.floor(Math.random()*4)];
        let sx=0, sy=0;
        if (side==="top"){ sx=Math.floor(Math.random()*cols); sy=0; }
        if (side==="bottom"){ sx=Math.floor(Math.random()*cols); sy=rows-1; }
        if (side==="left"){ sx=0; sy=Math.floor(Math.random()*rows); }
        if (side==="right"){ sx=cols-1; sy=Math.floor(Math.random()*rows); }
        if (game.barriers.has(key(sx,sy))) continue;

        
        let isBreaker = false;
        if (game.wave > 3){ 
          isBreaker = Math.random() < 0.1; 
        }

        
        const path = isBreaker 
            ? aStarIgnoreBarriers({x:sx,y:sy}, game.towerCell)
            : aStar({x:sx,y:sy}, game.towerCell);
        if (!path) continue;

        const pos = cellToPx(sx,sy);
        const hp = isBreaker ? 40 + Math.floor(game.wave*5) : 18 + Math.floor(game.wave*3);
        const spd = isBreaker ? 0.5 + game.wave*0.03 : 1.0 + game.wave*0.15;

        game.enemies.push({ 
          gx: sx, gy: sy, x: pos.x, y: pos.y, path, idx:0, 
          speed: spd, r:0.35, 
          hp, hpMax: hp, 
          alive:true, ang:0, 
          breaksBarriers: isBreaker,
          asset: isBreaker ? "enemy2" : "enemy"
        });
        game.spawningEnemies--; 
        return;
      }
      game.spawningEnemies--; 
    }, i*350);
  }
}
function startBuild(){
  game.phase="build";
  game.buildTimer = Math.max(10, Math.floor(30 + game.wave*0.2));
  updateHUD();
}
function startCombat(){
  game.phase="combat";
  updateHUD();
  spawnWave();
}

function nextWave(){
  game.wave++;
  game.gold += 25 + Math.floor(game.wave*6);
  startBuild();
}




// --- UPGRADY SYSTMS ----
// store upgrade tier
game.upgrades = {
  bulletSpeed: 1,
  bulletDamage: 1,
  reloadSpeed: 1
};


function upgradeCost(base, tier){ return base * tier; }


function upgrade(type){
  const tier = game.upgrades[type];
  let cost = 0;
  switch(type){
    case "bulletSpeed": cost = upgradeCost(20, tier); break;
    case "bulletDamage": cost = upgradeCost(25, tier); break;
    case "reloadSpeed": cost = upgradeCost(30, tier); break;
  }
  if (game.gold < cost){ toast("골드 부족!"); return; }
  game.gold -= cost;
  game.upgrades[type]++;
  toast(`${type} (을)를 티어${game.upgrades[type]}으로 업그레이드`);
  updateHUD();
}


function stepTurretShooting(t, dt){  
  t.cd -= dt;  
  if (game.phase!=="combat") return;  
  const tp = cellToPx(t.gx, t.gy);  
  let best=null, bestD=1e9;  

  
  const upgrades = t.upgrades || { damage:1, speed:1, range:1 };  
  const detectionRange = t.range * (1 + 0.1*(upgrades.range-1));   

  for (const e of game.enemies){  
    if (!e.alive) continue;  
    const d = Math.hypot(tp.x - e.x, tp.y - e.y) / game.grid.cell;  
    if (d <= detectionRange && d < bestD){ best = e; bestD = d; }  
  }  

  if (best){  
    
    const targetAng = Math.atan2(best.y - tp.y, best.x - tp.x);
    if (t.ang === undefined) t.ang = targetAng;
    const diff = ((targetAng - t.ang + Math.PI) % (2*Math.PI)) - Math.PI;
    t.ang += diff * Math.min(1, dt * 5); //5 rotation speeeeeeed

    
    if (t.cd <= 0){
      t.cd = t.rate / (1 + 0.8*(upgrades.speed-1));  
      const speed = 8 * (1 + 0.9*(upgrades.speed-1));  
      const dmg = t.dmg * (1 + 0.9*(upgrades.damage-1));  

      game.bullets.push({  
        x: tp.x,  
        y: tp.y,  
        vx: Math.cos(t.ang) * speed * game.grid.cell / 48,  
        vy: Math.sin(t.ang) * speed * game.grid.cell / 48,  
        dmg,  
        life: 1.6  
      });  
    }
  }  
}


const upgradeBtns = document.querySelectorAll(".upgrade-btn");
upgradeBtns.forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const type = btn.dataset.upgrade;
    upgrade(type);
  }, { passive:true });
});




function step(dt){            
  if (game.phase==="build"){            
    game.buildTimer -= dt;            
    if (game.buildTimer<=0){            
      startCombat();            
    }            
    updateHUD();            
  }            

  // --- turret shooting (upgradd) ---
  for (const t of game.turrets){
    stepTurretShooting(t, dt);
  }

             
  for (const b of game.bullets){            
    b.life -= dt;            
    b.x += b.vx;            
    b.y += b.vy;            
  }            
  game.bullets = game.bullets.filter(b=>b.life>0);            

             
  if (game.pathDirty && game.phase!=="combat"){ game.pathDirty=false; }            

  for (const e of game.enemies){            
    if (!e.alive) continue;            
    const speedPx = (e.speed * game.grid.cell) * dt;            
    let target = e.path[Math.min(e.idx+1, e.path.length-1)];            
    if (!target){ e.alive=false; continue; }          

                
    if (target && game.barriers.has(key(target.x,target.y)) && e.breaksBarriers){            
      if (!e.breakTimer) e.breakTimer = 0.5;        
      e.breakTimer -= dt;        
      if (e.breakTimer <= 0){        
        game.barriers.delete(key(target.x,target.y));            
        game.pathDirty = true;  

        // recalc paths only for normal enemys  
        for (const other of game.enemies){          
          if (!other.alive || other.breaksBarriers) continue;          

          // clamp current position to nearest nonbarrier grid cell
          let gx = Math.floor((other.x - game.grid.ox) / game.grid.cell);
          let gy = Math.floor((other.y - game.grid.oy) / game.grid.cell);
          if (game.barriers.has(key(gx, gy))) {
            const ns = [[0,0],[1,0],[-1,0],[0,1],[0,-1]];
            for (const [dx,dy] of ns){
              const nx = gx + dx, ny = gy + dy;
              if (!inBounds(nx, ny)) continue;
              if (!game.barriers.has(key(nx, ny))) { gx = nx; gy = ny; break; }
            }
          }

          const start = { x: gx, y: gy };
          const newPath = aStar(start, game.towerCell);
          if (newPath){
            other.path = newPath;
            // reset idx apropreetly
            other.idx = -1;
            const p = cellToPx(other.path[0].x, other.path[0].y);
            const dist = Math.hypot(other.x - p.x, other.y - p.y);
            if (dist < game.grid.cell * 0.05) {
              other.idx = 0;
            }
          }          
        }          
        e.breakTimer = 0;        
      } else {        
        continue;        
      }        
    }            

    const tp = cellToPx(target.x,target.y);
    const dx = tp.x - e.x, dy = tp.y - e.y;
    const absDx = Math.abs(dx), absDy = Math.abs(dy);
    const move = speedPx;

    
    if (absDx > 0.5){
        e.x += Math.sign(dx) * Math.min(move, absDx);
    } else if (absDy > 0.5){
        e.y += Math.sign(dy) * Math.min(move, absDy);
    } else {
        
        if (e.idx < e.path.length-1) e.idx++;
    }

    
    e.ang = Math.atan2(
        cellToPx(game.towerCell.x, game.towerCell.y).y - e.y,
        cellToPx(game.towerCell.x, game.towerCell.y).x - e.x
    );
  
    const tc = cellToPx(game.towerCell.x, game.towerCell.y);            
    if (Math.hypot(e.x-tc.x, e.y-tc.y) <= game.grid.cell*0.6){            
      e.alive=false;            
      game.towerHP -= 6;            
      updateHUD();            
    }            
  }            
  game.enemies = game.enemies.filter(e=>e.alive);            

  // bullet colisions            
  for (const b of game.bullets){            
    for (const e of game.enemies){            
      if (!e.alive) continue;            
      if (Math.hypot(b.x - e.x, b.y - e.y) <= Math.max(8, game.grid.cell*0.18)){            
        e.hp -= b.dmg;            
        b.life = 0;            
        if (e.hp <= 0){            
          e.alive=false;            
          game.gold += 5;            
          updateHUD();            
        }            
        break;            
      }            
    }            
  }            
  game.bullets = game.bullets.filter(b=>b.life>0);            

  if (game.phase==="combat"){            
    const enemiesLeft = game.enemies.length;            
    if (enemiesLeft===0 && (game.spawningEnemies===0 || game.spawningEnemies===undefined)){            
      if (game.towerHP<=0){             
        gameOver();             
        return;             
      }            
      nextWave();            
    }            
  }            

  if (game.towerHP<=0){             
    gameOver();             
  }            
}

function gameOver(){
  game.paused = true;
  toast("게임 오버... 준호 사망. 탭하여 다시 시작");
  canvas.addEventListener("pointerdown", ()=>location.reload(), { once:true });
}

function drawGrid(){
  const s=game.grid.cell, cols=game.grid.cols, rows=game.grid.rows, ox=game.grid.ox, oy=game.grid.oy;
  ctx.save();
  ctx.strokeStyle="rgba(255,255,255,.05)";
  ctx.lineWidth=1;
  for (let x=0;x<=cols;x++){
    ctx.beginPath(); ctx.moveTo(ox + x*s + .5, oy); ctx.lineTo(ox + x*s + .5, oy + rows*s); ctx.stroke();
  }
  for (let y=0;y<=rows;y++){
    ctx.beginPath(); ctx.moveTo(ox, oy + y*s + .5); ctx.lineTo(ox + cols*s, oy + y*s + .5); ctx.stroke();
  }
  ctx.restore();
}

function drawTower(){
  const c = cellToPx(game.towerCell.x, game.towerCell.y);
  const r = game.grid.cell*0.6;
  if (towerReady){
    ctx.save();
    const s = r*1.8;
    ctx.globalAlpha=0.95;
    ctx.drawImage(assets.tower, c.x - s/2, c.y - s/2, s, s);
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle="#21324a";
    ctx.beginPath(); ctx.arc(c.x,c.y,r,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
  const pct = game.towerHP / game.towerHPMax;
  ctx.save();
  ctx.lineWidth=6;
  ctx.strokeStyle = pct>0.5? "#7ee787" : (pct>0.25? "#f5c542" : "#ff5c5c");
  ctx.beginPath(); ctx.arc(c.x,c.y,r+6, -Math.PI/2, -Math.PI/2 + Math.PI*2*pct); ctx.stroke();
  ctx.restore();
}

// --- BARRIER 'TEGRITY FARMS ---
game.barrierHP = new Map(); 

function placeBarrier(gx,gy){
  const cost = 20;
  if (game.gold < cost){ toast("골드 부족!"); return false; }
  game.gold -= cost;
  game.barriers.add(key(gx,gy));
  updateHUD();
  return true;
}


function tryPlace(gx,gy){
  const sel = currentSelection();
  if (game.phase!=="build") return;
  if (sel==="sell"){
    // sell turet remove barier
    for (let i=0;i<game.turrets.length;i++){
      const t = game.turrets[i];
      if (t.gx===gx && t.gy===gy){
        const refund = Math.max(10, Math.floor(t.spent*0.5));
        game.gold += refund;
        game.turrets.splice(i,1);
        game.pathDirty = true;
        updateHUD();
        toast(`+${refund}g (매각)`);
        return;
      }
    }
    if (game.barriers.has(key(gx,gy))){
      game.barriers.delete(key(gx,gy));
      game.barrierHP.delete(key(gx,gy));
      game.pathDirty = true;
      toast("벽돌 제거함");
      return;
    }
    return;
  }
  if (sel==="barrier"){
    if (!canPlaceBarrier(gx,gy)) return;
    // temp add. validate path
    game.barriers.add(key(gx,gy));
    if (!anySpawnPathExists()){
      game.barriers.delete(key(gx,gy));
      toast("준호로 가는 경로가 없을 수는 없습니다.");
      return;
    }
    if (!placeBarrier(gx,gy)) {
      game.barriers.delete(key(gx,gy));
      return;
    }
    game.pathDirty = true;
    return;
  }
  if (sel==="turret"){
    if (!canPlaceTurret(gx,gy)) return;
    const cost = 50;
    if (game.gold < cost){ toast("골드 부족!"); return; }
    game.gold -= cost;
    game.turrets.push({gx,gy,lv:1,dmg:6,rate:0.9,range:4.5,cd:0,spent:50});
    updateHUD();
    return;
  }
}


function stepEnemies(dt){
  for (const e of game.enemies){
    if (!e.alive) continue;
    const speedPx = (e.speed * game.grid.cell) * dt;
    let target = e.path[Math.min(e.idx+1, e.path.length-1)];
    if (!target){ e.alive=false; continue; }

    if (target && game.barriers.has(key(target.x,target.y)) && e.breaksBarriers){
      if (!e.breakTimer) e.breakTimer = 0.5;
      e.breakTimer -= dt;
      if (e.breakTimer <= 0){
        const bkey = key(target.x,target.y);
        let hp = game.barrierHP.get(bkey) ?? 10;
        hp -= 5; // damage per hit
        if (hp <= 0){
          game.barriers.delete(bkey);
          game.barrierHP.delete(bkey);
          game.pathDirty = true;
        } else {
          game.barrierHP.set(bkey, hp);
        }
        e.breakTimer = 0;
      } else { continue; }
    }

    const tp = cellToPx(target.x,target.y);
    const dx = tp.x - e.x, dy = tp.y - e.y;
    const absDx = Math.abs(dx), absDy = Math.abs(dy);
    const move = speedPx;
    if (absDx > 0.5) e.x += Math.sign(dx) * Math.min(move, absDx);
    else if (absDy > 0.5) e.y += Math.sign(dy) * Math.min(move, absDy);
    else if (e.idx < e.path.length-1) e.idx++;
    e.ang = Math.atan2(cellToPx(game.towerCell.x, game.towerCell.y).y - e.y, cellToPx(game.towerCell.x, game.towerCell.y).x - e.x);
    const tc = cellToPx(game.towerCell.x, game.towerCell.y);
    if (Math.hypot(e.x-tc.x, e.y-tc.y) <= game.grid.cell*0.6){ e.alive=false; game.towerHP -= 6; updateHUD(); }
  }
  game.enemies = game.enemies.filter(e=>e.alive);
}

// draw barier HP overlay
function drawBarriers(){
  const s = game.grid.cell;
  ctx.save();
  ctx.fillStyle = "#955947";
  ctx.strokeStyle = "rgba(255,255,255,.09)";
  ctx.lineWidth = 2;
  for (const k of game.barriers){
    const [x,y] = k.split(",").map(Number);
    const p = cellToPx(x,y);
    ctx.fillRect(p.x - s/2 +1, p.y - s/2 +1, s-2, s-2);
    ctx.strokeRect(p.x - s/2 +1, p.y - s/2 +1, s-2, s-2);
  }
  ctx.restore();
}

function drawTurrets(){  
  const s = game.grid.cell;  
  for (const t of game.turrets){  
    const p = cellToPx(t.gx, t.gy);  
    ctx.save();  
    ctx.translate(p.x, p.y);  

    
    const angle = t.ang || 0;
    ctx.rotate(angle); 

     
    const upgrades = t.upgrades || { damage: 1 };  
    const dmgLevel = Math.min(upgrades.damage, 10); // cap for safetee  
    const red = Math.min(255, 200 + dmgLevel*5);  
    const green = Math.max(0, 221 - dmgLevel*20);  
    const blue = Math.max(0, 52 - dmgLevel*5);  
    ctx.fillStyle = `rgb(${red},${green},${blue})`;  

    ctx.strokeStyle="rgba(255,255,255,.12)";  
    ctx.lineWidth=2;  
    ctx.beginPath(); ctx.arc(0,0,s*0.32,0,Math.PI*2); ctx.fill(); ctx.stroke();  

    ctx.fillStyle="#274566";  
    ctx.fillRect(s*0.12,-s*0.06,s*0.24,s*0.12); // baerel  
    ctx.restore();  
  }  
}

function drawEnemies(){
  for (const e of game.enemies){
    ctx.save();
    ctx.translate(e.x,e.y);
    ctx.rotate(e.ang);
    let ready = (e.asset === "enemy2") ? enemy2Ready : enemyReady;
    let img = assets[e.asset] ?? assets.enemy;
    if (ready){
      const s = game.grid.cell*0.7;
      ctx.drawImage(img, -s/2, -s/2, s, s);
    } else {
      ctx.fillStyle="#cfe7ff";
      ctx.beginPath(); ctx.arc(0,0,game.grid.cell*0.35,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();

    // hp bar
    const w = Math.max(24, game.grid.cell*0.5), h=4;
    ctx.save();
    ctx.fillStyle="rgba(0,0,0,.5)";
    ctx.fillRect(e.x - w/2, e.y - game.grid.cell*0.5, w, h);
    ctx.fillStyle="#7ee787";
    ctx.fillRect(e.x - w/2, e.y - game.grid.cell*0.5, w * Math.max(0,e.hp/e.hpMax), h);
    ctx.restore();
  }
}

function drawBullets(){
  ctx.save();
  ctx.fillStyle= "#f5c542";
  for (const b of game.bullets){
    ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(3, game.grid.cell*0.06), 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
}

function drawPlacementPreview(){
  const sel = currentSelection();
  if (sel==="sell") return;

  
  if (game.phase === "combat") return;

  const px = pointer.x, py = pointer.y;
  const {gx,gy} = pxToCell(px,py);
  if (!inBounds(gx,gy)) return;
  const p = cellToPx(gx,gy);
  const s = game.grid.cell;
  let ok = false;
  if (sel==="barrier"){
    ok = canPlaceBarrier(gx,gy);
  } else if (sel==="turret"){
    ok = canPlaceTurret(gx,gy);
  }

  ctx.save();
  ctx.globalAlpha = .6;

  if (sel==="barrier"){
    ctx.fillStyle = ok ? "#23334a" : "#3a1f24";
    ctx.fillRect(p.x - s/2 +1, p.y - s/2 +1, s-2, s-2);
  } else if (sel==="turret"){
    ctx.fillStyle = ok ? "#2b3f57" : "#3a1f24";
    ctx.beginPath();
    ctx.arc(p.x, p.y, s*0.32, 0, Math.PI*2);
    ctx.fill();

    if (ok){
      let tempRange = 4.5; 
      const selTurret = currentSelection();
      if (selTurret && selTurret.upgrades){
        tempRange *= 1 + 0.1*((selTurret.upgrades.range||1)-1);
      }
      ctx.strokeStyle="rgba(125, 231, 135, 0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, tempRange * s, 0, Math.PI*2);
      ctx.stroke();
    }
  }

  ctx.restore();
}


function render(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawGrid();
  drawBarriers();
  drawTurrets();
  drawEnemies();
  drawBullets();
  drawTower();
  drawPlacementPreview();

  ctx.save();
  ctx.globalAlpha=.07; ctx.fillStyle="#e6eef7"; ctx.font=`900 ${Math.max(56, Math.floor(game.grid.cell*1.4))}px system-ui`;
  ctx.textAlign="center"; ctx.fillText(game.phase.toUpperCase(), canvas.width/2, 110);
  ctx.restore();
}

function loop(t){
  const dt = Math.min(0.05, (t - game.lastTime)/1000);
  game.lastTime = t;
  if (!game.paused) step(dt);
  render();
  requestAnimationFrame(loop);
}

function init(){
  console.log("Init called"); // Dbug
  resize();
  updateHUD();
  startBuild();
  requestAnimationFrame(loop);
}

init();


// --- UPGRADE SYSTM ---
game.selectedTurret = null; 
game.upgradesPerTurret = ["damage","range","speed"]; 
const MAX_TURRET_UPGRADE = 9;


canvas.addEventListener("pointerdown", (e)=>{
  if (game.phase !== "build") return;
  const {gx,gy} = pxToCell(pointer.x, pointer.y);
  
  let found = null;
  for (const t of game.turrets){
    if (t.gx === gx && t.gy === gy){ found = t; break; }
  }
  game.selectedTurret = found;
});


upgradeBtns.forEach(btn => {
  btn.addEventListener("click", ()=>{
    if (!game.selectedTurret){
      toast("포탑을 먼저 선택하세요.");
      return;
    }
    const type = btn.dataset.upgrade;
    const cost = parseInt(btn.dataset.cost);
    if (!game.selectedTurret.upgrades) game.selectedTurret.upgrades = { damage:1, range:1, speed:1 };
    const current = game.selectedTurret.upgrades[type] || 1;
    if (current >= MAX_TURRET_UPGRADE){
      toast(`${type}(은)는 이미 최대 티어 입니다!`);
      return;
    }
    if (game.gold < cost){
      toast("골드 부족!");
      return;
    }
    game.gold -= cost;
    game.selectedTurret.upgrades[type] = current + 1;
    toast(`${type} 티어${current+1}(으)로 업그레이드`);
    updateHUD();
  }, {passive:true});
});

function stepTurretShooting(t, dt){  
  t.cd -= dt;  
  if (game.phase!=="combat") return;  
  const tp = cellToPx(t.gx, t.gy);  
  let best=null, bestD=1e9;  

  
  const upgrades = t.upgrades || { damage:1, speed:1, range:1 };  
  const detectionRange = t.range * (1 + 0.1*(upgrades.range-1));  

  for (const e of game.enemies){  
    if (!e.alive) continue;  
    const d = Math.hypot(tp.x - e.x, tp.y - e.y) / game.grid.cell;  
    if (d <= detectionRange && d < bestD){ best = e; bestD = d; }  
  }  

  
  if (best){
    const desiredAng = Math.atan2(best.y - tp.y, best.x - tp.x);
    
    const diff = ((desiredAng - (t.ang||0) + Math.PI) % (2*Math.PI)) - Math.PI;
    t.ang = (t.ang||0) + diff * 0.2; // 0.2 = rotate speed factor

    if (t.cd <= 0){  
      t.cd = t.rate / (1 + 0.8*(upgrades.speed-1));  
      const speed = 8 * (1 + 0.9*(upgrades.speed-1));  
      const dmg = t.dmg * (1 + 0.9*(upgrades.damage-1));  

      game.bullets.push({  
        x: tp.x,  
        y: tp.y,  
        vx: Math.cos(t.ang) * speed * game.grid.cell / 48,  
        vy: Math.sin(t.ang) * speed * game.grid.cell / 48,  
        dmg,  
        life: 1.6  
      });  
    }  
  }  
}


function drawTurretUpgrades(){
  const s = game.grid.cell;
  ctx.save();
  ctx.fillStyle="#fff"; ctx.font="10px system-ui"; ctx.textAlign="center";
  for (const t of game.turrets){
    const p = cellToPx(t.gx,t.gy);
    if (!t.upgrades) continue;
    const txt = `D${t.upgrades.damage||1} R${t.upgrades.range||1} S${t.upgrades.speed||1}`;
    ctx.fillText(txt, p.x, p.y - s*0.45);
  }
  ctx.restore();
}


function drawSelectedTurretRange(){
  if (!game.selectedTurret) return;
  if (game.phase === "combat") return; 

  const t = game.selectedTurret;
  const upgrades = t.upgrades || { range:1 };
  const rangePx = t.range * (1 + 0.1*(upgrades.range-1)) * game.grid.cell;

  const p = cellToPx(t.gx, t.gy);
  ctx.save();
  ctx.strokeStyle = "rgba(255, 200, 50, 0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, rangePx, 0, Math.PI*2);
  ctx.stroke();
  ctx.restore();
}


const oldRender = render;
render = function(){
  oldRender();
  drawTurretUpgrades();      
  drawSelectedTurretRange();
};