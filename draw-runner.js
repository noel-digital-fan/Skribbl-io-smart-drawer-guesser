(()=>{const e=[[255,255,255],[0,0,0],[193,193,193],[80,80,80],[239,19,11],[116,11,7],[255,113,0],[194,56,0],[255,228,0],[232,162,0],[0,204,0],[0,70,25],[0,255,145],[0,120,93],[0,178,255],[0,86,158],[35,31,211],[14,8,101],[163,0,186],[85,0,105],[223,105,167],[135,53,84],[255,172,142],[204,119,77],[160,82,45],[99,48,13]];let t=null;const o=e=>!!e&&e.getClientRects().length>0&&"hidden"!==getComputedStyle(e).visibility,r=()=>{const e=document.querySelector("#game-word .word");return o(e)&&o(document.querySelector("#game-toolbar"))?e.textContent.trim().toLowerCase():""},n=()=>Array.from(document.querySelectorAll("#game-toolbar .colors .color")).filter(t=>Number.isInteger(t.colorIndex)&&e[t.colorIndex]),a=()=>n().map(t=>({index:t.colorIndex,rgb:e[t.colorIndex]})).filter((e,t,o)=>o.findIndex(t=>t.index===e.index)===t),i=(e,t,o,r={})=>document.dispatchEvent(new CustomEvent("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status",{detail:JSON.stringify({id:e,state:t,message:o,...r})})),s=e=>new Promise(t=>setTimeout(t,e));function l(e,t,o){const r=t.find(e=>e.size?.size===(5===o||6===o?4:o));if(!r)throw new Error("Brush size is unavailable. Reload the game.");if(r.click(),5===o||6===o){const t=document.querySelector("#game-toolbar .size-preview .icon"),n=()=>parseFloat(t?.style.backgroundSize);if(Math.abs(n()-20)>.01||!Number.isFinite(n()))throw new Error("Cannot verify the "+o+" px brush. Choose 4 px or reload the game.");if(5===o){const e=r.size,t=e.size;try{e.size=5,r.click()}finally{e.size=t}}else e.dispatchEvent(new WheelEvent("wheel",{bubbles:!0,cancelable:!0,deltaY:-1,deltaMode:0}));if(Math.abs(n()-(20+(o-4)/36*80))>.01)throw new Error("The game did not accept the "+o+" px brush. Choose 4 px.")}}function c(t,o){try{if(800!==t.width||600!==t.height)return!1;const r=t.getContext("2d").getImageData(0,0,800,600).data,n=new Uint8Array(48e4),a=new Uint8Array(48e4);for(const[e,t,r,a]of o.region)for(let o=t;o<a;o++)n.fill(1,800*o+e,800*o+r);const[i,s]=o.points[0],l=800*Math.floor(s)+Math.floor(i),c=4*l,d=[r[c],r[c+1],r[c+2]],u=e[o.color];if(d.every((e,t)=>e===u[t]))return!1;const p=new Int32Array(48e4);let f=0,g=1;for(p[0]=l,a[l]=1;f<g;){const e=p[f++],t=4*e;if([0,1,2].some(e=>Math.abs(r[t+e]-d[e])>=3)||u.every((e,o)=>e===r[t+o]))continue;if(!n[e])return!1;const o=e%800;for(const t of[o>0?e-1:-1,o<799?e+1:-1,e>=800?e-800:-1,e<479200?e+800:-1])t>=0&&!a[t]&&(a[t]=1,p[g++]=t)}return!0}catch{return!1}}function d(t,o){if(!t||2!==o.points.length)return!1;const r=e[o.color],n=Math.floor(o.brush/2),a=(e,o)=>{for(let a=1-n;a<n;a++)for(let i=1-n;i<n;i++){if(i*i+a*a>=n*n||e+i<0||e+i>=800||o+a<0||o+a>=600)continue;const s=4*(800*(o+a)+e+i);if(t[s]!==r[0]||t[s+1]!==r[1]||t[s+2]!==r[2])return!1}return!0};let[i,s]=o.points[0].map(Math.floor);const[l,c]=o.points[1].map(Math.floor),d=Math.abs(l-i),u=Math.abs(c-s),p=i<l?1:-1,f=s<c?1:-1;let g=d-u;for(;;){if(!a(i,s))return!1;if(i===l&&s===c)return!0;const e=2*g;e>-u&&(g-=u,i+=p),e<d&&(g+=d,s+=f)}}function u(e,t,o,r,ultra){if(ultra)return ultra.send(t,o,r);const n=e.getBoundingClientRect(),a=["setPointerCapture","releasePointerCapture"].map(t=>[t,Object.getOwnPropertyDescriptor(e,t)]);try{for(const[t]of a)Object.defineProperty(e,t,{configurable:!0,value:()=>{}});e.dispatchEvent(new PointerEvent(t,{bubbles:!0,cancelable:!0,pointerId:1937041,pointerType:"mouse",isPrimary:!0,button:0,buttons:r?1:0,clientX:n.left+(Math.floor(o[0])+.25)/800*n.width,clientY:n.top+(Math.floor(o[1])+.25)/600*n.height,pressure:r?.5:0}))}finally{for(const[t,o]of a)o?Object.defineProperty(e,t,o):delete e[t]}}
// INSTANT plans (instant-planner.js) arrive as ops: polylines with a planned start, dots, and
// bucket fills that are re-checked against the live canvas before they are sent.
const instantPoint=q=>Array.isArray(q)&&2===q.length&&Number.isInteger(q[0])&&Number.isInteger(q[1])&&q[0]>=0&&q[0]<800&&q[1]>=0&&q[1]<600;
const instantBrushSize=size=>Number.isInteger(size)&&size>=4&&size<=40&&(size===5||size%2===0);
// Ultra Fast caches extension-owned layout reads. The game still receives normal pointer events and
// performs its own input checks; capture methods are restored after every synchronous dispatch.
function ultraPointerStream(canvas,metrics){
  let rect=null;
  const fields={pointerdown:"pointerDowns",pointermove:"pointerMoves",pointerup:"pointerUps"};
  const capture=["setPointerCapture","releasePointerCapture"].map(key=>[key,Object.getOwnPropertyDescriptor(canvas,key)]),noop=()=>{},invalidate=()=>{rect=null};
  window.addEventListener("resize",invalidate);
  window.addEventListener("scroll",invalidate,!0);
  const observer=typeof ResizeObserver==="function"?new ResizeObserver(invalidate):null;
  observer?.observe(canvas);
  return{
    invalidate,
    send(type,point,down){
      if(!rect)rect=canvas.getBoundingClientRect(),metrics.domRectReads++;
      try{
        for(const[key]of capture)Object.defineProperty(canvas,key,{configurable:!0,value:noop});
        const field=fields[type];
        if(field)metrics[field]++;
        const event=new PointerEvent(type,{bubbles:!0,cancelable:!0,pointerId:1937041,pointerType:"mouse",isPrimary:!0,button:0,buttons:down?1:0,clientX:rect.left+(Math.floor(point[0])+.25)/800*rect.width,clientY:rect.top+(Math.floor(point[1])+.25)/600*rect.height,pressure:down?.5:0});
        canvas.dispatchEvent(event);
      }finally{
        for(const[key,descriptor]of capture)descriptor?Object.defineProperty(canvas,key,descriptor):delete canvas[key];
      }
    },
    close(){window.removeEventListener("resize",invalidate);window.removeEventListener("scroll",invalidate,!0);observer?.disconnect()}
  };
}
// Resolve native presets and the brush preview once. Verify every requested size before Clear,
// including native large brushes, and remember the brush left active by
// preflight, so the first operation does not repeat its clicks or wheel event.
function ultraBrushSetter(canvas,sizes,metrics){
  const presets=new Map(sizes.filter(el=>el.size).map(el=>[el.size.size,el])),preview=document.querySelector("#game-toolbar .size-preview .icon");
  let current=-1;
  const read=()=>parseFloat(preview?.style.backgroundSize),click=el=>{el.click();metrics.sizeChanges++};
  const verify=size=>{const actual=read(),expected=20+(size-4)/36*80;if(!Number.isFinite(actual)||Math.abs(actual-expected)>.01)throw new Error("Cannot verify the "+size+" px brush. Reload the game.")};
  return{
    get current(){return current},
    set(size){
      if(size===current)return;
      if(!instantBrushSize(size))throw new Error("Brush size is unavailable. Reload the game.");
      const available=[...presets.keys()].filter(value=>[4,10,20,32,40].includes(value));
      available.sort((a,b)=>Math.abs(a-size)-Math.abs(b-size)||a-b);
      const base=size===5?4:available[0],preset=presets.get(base);
      if(!preset?.isConnected)throw new Error("Brush size is unavailable. Reload the game.");
      // Cached even sizes can use fewer public wheel events than re-selecting a
      // preset. An odd 5 px brush always returns to a verified native preset first.
      let active=base;
      if(size!==5&&current>=4&&current%2===0&&Math.abs(size-current)/2<1+Math.abs(size-base)/2){
        active=current;verify(active);
      }else{click(preset);verify(base)}
      if(size===5){
        const data=preset.size,original=data.size;
        try{data.size=5;click(preset)}finally{data.size=original}
      }else{
        const direction=Math.sign(size-active);
        for(;active!==size;active+=2*direction){
          canvas.dispatchEvent(new WheelEvent("wheel",{bubbles:!0,cancelable:!0,deltaY:-direction,deltaMode:0}));metrics.sizeChanges++;
          verify(active+2*direction);
        }
      }
      verify(size);
      current=size;
    }
  };
}
function instantOpsValid(ops,palette){
  if(!Array.isArray(ops)||ops.length>6e4)return!1;
  let segments=0;
  for(const op of ops){
    if(!op||!palette.some(c=>c.index===op.color)||!instantBrushSize(op.size))return!1;
    if("line"===op.kind){
      if(!Array.isArray(op.points)||op.points.length<2||op.points.length>4096||!op.points.every(instantPoint)||!["continue","free","travel","dot"].includes(op.start))return!1;
      segments+=op.points.length-1;
    }else if("dot"===op.kind){if(!instantPoint(op.point))return!1}
    else if("fill"===op.kind){
      const b=op.box;
      if(void 0!==op.exact&&op.exact!==true||op.exact===true&&(!Array.isArray(op.rows)||op.rows.length!==0))return!1;
      if(!instantPoint(op.point)||!Array.isArray(b)||4!==b.length||!b.every(Number.isInteger)||b[0]<0||b[1]<0||b[2]>799||b[3]>599||b[0]>op.point[0]||b[2]<op.point[0]||b[1]>op.point[1]||b[3]<op.point[1]||!Number.isInteger(op.count)||op.count<1||!Array.isArray(op.rows)||op.rows.length>600||!op.rows.every(r=>Array.isArray(r)&&3===r.length&&r.every(Number.isInteger)&&r[0]>=0&&r[0]<600&&r[1]>=0&&r[2]<800&&r[1]<=r[2]))return!1;
      segments+=op.rows.length;
    }else return!1;
  }
  return segments<=6e4;
}
function instantPixelIs(canvas,x,y,color){
  try{const d=canvas.getContext("2d").getImageData(x,y,1,1).data;return e[color].every((v,k)=>v===d[k])}catch{return!1}
}
// Mirrors the game's bucket (same seed tolerance) on the live canvas within the planned box plus
// one pixel. Standard fills cannot leave the box or exceed the planned area. Exact raster fills
// additionally require the complete planned count and bounding box; an already-colored seed is
// an unexpected canvas change for those fills. Standard fills still return "done" for that seed.
function instantFillCheck(canvas,op,workspace){
  const[x0,y0,x1,y1]=op.box,bx=Math.max(0,x0-1),by=Math.max(0,y0-1),bw=Math.min(799,x1+1)-bx+1,bh=Math.min(599,y1+1)-by+1;
  let d;
  try{d=(workspace?.context||canvas.getContext("2d")).getImageData(bx,by,bw,bh).data}catch{return"unsafe"}
  const rgb=e[op.color],first=(op.point[1]-by)*bw+op.point[0]-bx,seed=[d[4*first],d[4*first+1],d[4*first+2]],exact=op.exact===true;
  if(seed.every((v,k)=>v===rgb[k]))return exact?"unsafe":"done";
  let areaX0=800,areaY0=600,areaX1=-1,areaY1=-1;
  const fillable=k=>{const o=4*k;return!(d[o]===rgb[0]&&d[o+1]===rgb[1]&&d[o+2]===rgb[2])&&Math.abs(d[o]-seed[0])<3&&Math.abs(d[o+1]-seed[1])<3&&Math.abs(d[o+2]-seed[2])<3};
  if(workspace){
    // Identical neighbor order and acceptance to the original check, with no arrays per pixel.
    const visited=workspace.visited,stack=workspace.stack;
    visited.fill(0,0,bw*bh);visited[first]=1;stack[0]=first;
    let length=1,count=0;
    while(length){
      const k=stack[--length],x=k%bw+bx,y=(k/bw|0)+by;
      if(x<x0||x>x1||y<y0||y>y1||++count>op.count)return"unsafe";
      if(exact){if(x<areaX0)areaX0=x;if(y<areaY0)areaY0=y;if(x>areaX1)areaX1=x;if(y>areaY1)areaY1=y}
      let n;
      if(x>bx){n=k-1;if(!visited[n]&&fillable(n))visited[n]=1,stack[length++]=n}
      if(x<bx+bw-1){n=k+1;if(!visited[n]&&fillable(n))visited[n]=1,stack[length++]=n}
      if(y>by){n=k-bw;if(!visited[n]&&fillable(n))visited[n]=1,stack[length++]=n}
      if(y<by+bh-1){n=k+bw;if(!visited[n]&&fillable(n))visited[n]=1,stack[length++]=n}
    }
    return !exact||count===op.count&&areaX0===x0&&areaY0===y0&&areaX1===x1&&areaY1===y1?"safe":"unsafe";
  }
  const
    visited=new Uint8Array(bw*bh),stack=[first];
  visited[first]=1;
  let count=0;
  for(;stack.length;){
    const k=stack.pop(),x=k%bw+bx,y=(k/bw|0)+by;
    if(x<x0||x>x1||y<y0||y>y1||++count>op.count)return"unsafe";
    if(exact){if(x<areaX0)areaX0=x;if(y<areaY0)areaY0=y;if(x>areaX1)areaX1=x;if(y>areaY1)areaY1=y}
    for(const n of[x>bx?k-1:-1,x<bx+bw-1?k+1:-1,y>by?k-bw:-1,y<by+bh-1?k+bw:-1])n>=0&&!visited[n]&&fillable(n)&&(visited[n]=1,stack.push(n));
  }
  return !exact||count===op.count&&areaX0===x0&&areaY0===y0&&areaX1===x1&&areaY1===y1?"safe":"unsafe";
}
document.addEventListener("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request",async e=>{let p;try{if("string"!=typeof e.detail||e.detail.length>7e6)return;p=JSON.parse(e.detail)}catch{return}if("max"===p.speed)p.speed="instant";if("palette"===p.action)return void i(p.id,"palette","",{palette:a()});if(["stop","pause","resume"].includes(p.action))return void(!t||p.id&&p.id!==t.id||("stop"===p.action?t.cancelled=!0:(t.paused="pause"===p.action,i(t.id,t.paused?"paused":"drawing",t.paused?"Paused. Resume when ready.":"Resuming drawing…"))));if("draw"!==p.action)return;if(t)return i(p.id,"error","A drawing is already running.");const f=document.querySelector("#game-canvas canvas"),g=p.strokes,w=p.background;if(!o(f)||!r()||r()!==p.word)return i(p.id,"error","Drawing is only available during your turn.");const m=a(),h=Array.from(document.querySelectorAll("#game-toolbar .sizes .size")),b=new Map(n().map(e=>[e.colorIndex,e]));if(!Number.isInteger(w)||!m.some(e=>e.index===w)||!Array.isArray(g)||g.length>6e4||g.some(e=>!e||!m.some(t=>t.index===e.color)||![4,5,6,10,20,32,40].includes(e.brush)||!Array.isArray(e.points)||e.points.length<2||e.points.length>4096||e.points.some(e=>!Array.isArray(e)||2!==e.length||e.some((e,t)=>!Number.isFinite(e)||e<0||e>(t?599:799)))||void 0!==e.tool&&"fill"!==e.tool||"fill"===e.tool&&(("sketch"!==p.style&&"instant"!==p.speed)||!Number.isInteger(e.group)||!Array.isArray(e.region)||e.region.length>6e4||e.region.some(e=>!Array.isArray(e)||4!==e.length||e.some((e,t)=>!Number.isInteger(e)||e<0||e>(t%2?600:800))||e[0]>=e[2]||e[1]>=e[3]))||void 0!==e.fallbackFor&&!Number.isInteger(e.fallbackFor))||g.reduce((e,t)=>e+t.points.length-1,0)>6e4)return i(p.id,"error","Invalid drawing data. Convert the image again.");if(void 0!==p.ops&&("instant"!==p.speed||g.length!==0||!instantOpsValid(p.ops,m)))return i(p.id,"error","Invalid drawing data. Convert the image again.");const y={id:p.id,cancelled:!1,paused:!1,startedAt:performance.now()};t=y;const v={slow:80,normal:35,fast:12,instant:12}[p.speed]??35,x={slow:10,normal:5,fast:0,instant:0}[p.speed]??5,M=!1!==p.smartDots,A="slow"===p.speed?1:"normal"===p.speed?M?3:1:7,E="slow"===p.speed?90:"normal"===p.speed?M?50:40:50;const ultraMetrics="instant"===p.speed&&void 0!==p.ops?{...(p.planMetrics&&typeof p.planMetrics==="object"&&!Array.isArray(p.planMetrics)?p.planMetrics:{}),executionMs:0,preparationMs:0,fillCheckMs:0,moveGateWaitMs:0,gateTaskYields:0,queueWaitMs:0,pointerDowns:0,pointerMoves:0,pointerUps:0,colorChanges:0,toolChanges:0,sizeChanges:0,brushCommands:0,fillCommands:0,domRectReads:0}:null;let ultraPointer=null,ultraSizes=null,ultraFill=null;let I=[0,0],C=!1,k=performance.now();try{const e=Array.from(document.querySelectorAll("#game-toolbar .tool")),t=e.find(e=>"Brush"===e.dataset.tooltip||0===e.toolIndex),n=e.find(e=>"Fill"===e.dataset.tooltip||1===e.toolIndex),a=e.find(e=>"Clear"===e.dataset.tooltip);if(!t||!n||!a)throw new Error("Drawing controls were not found. Reload the game.");if(ultraMetrics){ultraPointer=ultraPointerStream(f,ultraMetrics);ultraSizes=ultraBrushSetter(f,h,ultraMetrics);ultraFill={context:f.getContext("2d"),visited:new Uint8Array(800*600),stack:new Int32Array(800*600)}}for(const e of new Set([...g.map(e=>e.brush),...(p.ops||[]).map(e=>e.size)]))ultraSizes?ultraSizes.set(e):l(f,h,e);const m=()=>{if(y.cancelled||r()!==p.word||!o(f))throw new Error("Drawing stopped.")},M=async()=>{for(m();y.paused;)await s(80),m()};i(p.id,"drawing","Preparing canvas…"),await M(),a.click();
// Ultra Fast operation plans use synchronous game controls; legacy strokes keep their delays.
if(ultraMetrics){
  await M(),b.get(w).dispatchEvent(new PointerEvent("pointerdown",{bubbles:!0,button:0,pointerId:1937042,pointerType:"mouse"})),ultraMetrics.colorChanges++,n.click(),ultraMetrics.toolChanges++,I=[400,300],u(f,"pointerdown",I,!0,ultraPointer),C=!0,m(),u(f,"pointerup",I,!1,ultraPointer),C=!1,w!==0&&ultraMetrics.fillCommands++,await M(),t.click(),ultraMetrics.toolChanges++;
}else{
  await s(Math.max(50,v+x)),await M(),b.get(w).dispatchEvent(new PointerEvent("pointerdown",{bubbles:!0,button:0,pointerId:1937042,pointerType:"mouse"})),n.click(),I=[400,300],u(f,"pointerdown",I,!0,ultraPointer),C=!0,await s(v),m(),u(f,"pointerup",I,!1,ultraPointer),C=!1,await s(Math.max(50,v+x)),await M(),t.click();
}
ultraMetrics&&(ultraMetrics.preparationMs=performance.now()-y.startedAt);
i(p.id,"drawing","Drawing 0%");
if(p.ops){
  // INSTANT: the game drops a pointermove that comes less than 1000/90 ms after the previous one,
  // so only moves are paced. Dots, buckets and tool/color/size changes go out immediately.
  const ops=p.ops,GATE=1e3/90+.25,channel=new MessageChannel,wakers=[],queueStart=performance.now();
  channel.port1.onmessage=()=>wakers.shift()?.();
  const tick=()=>new Promise(r=>{wakers.push(r),channel.port2.postMessage(0)});
  try{
  // The game retains its move timestamp across Clear. Honor the first input gate when an
  // optimized Ultra Fast operation plan starts immediately after manual input.
  let tool="brush",color=ultraMetrics?w:-1,size=ultraSizes?ultraSizes.current:-1,last=ultraMetrics?y.startedAt:-1/0,checked=0,shown=-1/0,rejected=0,yielded=0;const produced=[],count=(kind="brush")=>{produced.push(performance.now());if(ultraMetrics)ultraMetrics[kind==="fill"?"fillCommands":"brushCommands"]++};
  const setColor=c=>{if(c===color)return;const el=b.get(c);if(!el?.isConnected)throw new Error("The game palette changed. Convert the image again.");el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:!0,button:0,pointerId:1937042,pointerType:"mouse"})),color=c,ultraMetrics&&ultraMetrics.colorChanges++},
    setTool=k=>{k!==tool&&(("fill"===k?n:t).click(),tool=k,ultraMetrics&&ultraMetrics.toolChanges++)},
    setSize=k=>{k!==size&&(ultraSizes?ultraSizes.set(k):l(f,h,k),size=k)},
    release=()=>{C&&(u(f,"pointerup",I,!1,ultraPointer),C=!1)},
    press=q=>{release(),I=q,u(f,"pointerdown",I,!0,ultraPointer),C=!0},
    // A task yield keeps Stop/Pause and the game send timer responsive without a fixed delay.
    pace=async()=>{ultraMetrics&&++yielded%16===0&&await tick();if(y.cancelled)throw new Error("Drawing stopped.");const now=performance.now();(y.paused||now-checked>100)&&(checked=now,ultraPointer?.invalidate(),await M())},
    move=async q=>{
      const waiting=ultraMetrics?performance.now():0;
      if(ultraMetrics){
        // Message tasks keep the input deadline precise without coarse timer overshoot. The
        // unchanged gate still protects the game; yields also let its UI and send timer run.
        const deadline=last+GATE;
        while(performance.now()<deadline){ultraMetrics.gateTaskYields++;await tick()}
      }else for(let w;(w=GATE-(performance.now()-last))>0;)w>3?await s(w-2):await tick();
      ultraMetrics&&(ultraMetrics.moveGateWaitMs+=performance.now()-waiting);
      // Start after synchronous dispatch: listener scheduling can delay the game's own timestamp
      // beyond dispatch start. This preserves every move even when that listener delay varies.
      await pace(),I=q,u(f,"pointermove",I,!0,ultraPointer),last=performance.now();
    },
    status=(k,text)=>{const now=performance.now();if(now-shown<100&&k<ops.length-1)return;shown=now;const c=document.querySelector("#game-clock .text")?.textContent.trim(),left=/^\d+$/.test(c||"")?Number(c):null;i(p.id,y.paused?"paused":"drawing",y.paused?"Paused. Resume when ready.":text+(null===left?"":" · "+left+" sec left"))};
  for(let k=0;k<ops.length;k++){
    const op=ops[k];
    await pace(),status(k,"Drawing "+Math.round((k+1)/ops.length*100)+"%"),setColor(op.color),setSize(op.size);
    if("fill"===op.kind){
      const checkStarted=ultraMetrics?performance.now():0,check=instantFillCheck(f,op,ultraFill);
      ultraMetrics&&(ultraMetrics.fillCheckMs+=performance.now()-checkStarted);
      if("safe"===check){release(),setTool("fill"),press(op.point),count("fill");continue}
      if("done"===check)continue;
      // Exact raster fills have no approximate brush fallback. A changed live canvas must stop
      // the plan before this fill can paint outside the modeled region or silently omit it.
      if(op.exact===true)throw new Error("Canvas differs from exact plan. Convert again.");
      // The live canvas differs from the plan here: draw the region's sample rows instead.
      rejected++;
      for(const[ry,a1,a2]of op.rows){
        if(ultraMetrics)await pace();
        setTool("brush"),press([a1,ry]),count(),a2>a1&&(await move([a2,ry]),count());
      }
      continue;
    }
    if("dot"===op.kind){setTool("brush"),press(op.point),count();continue}
    const[sx,sy]=op.points[0];
    if("continue"===op.start&&C&&I[0]===sx&&I[1]===sy)setTool("brush");
    // A bucket press on a pixel that already has the color, or outside the canvas, makes no command.
    else if("free"===op.start&&instantPixelIs(f,sx,sy,op.color))setTool("fill"),press([sx,sy]),setTool("brush");
    else if("travel"===op.start)setTool("fill"),C||press([-20,-20]),await move([sx,sy]),setTool("brush");
    else setTool("brush"),press([sx,sy]),count();
    for(let j=1;j<op.points.length;j++)await move(op.points[j]),count();
  }
  release();
  // The game forwards 8 queued commands every 50 ms; finish when other players have everything.
  let drained=queueStart;for(let k=0;k<produced.length;){drained+=50;for(let c=0;c<8&&k<produced.length&&produced[k]<=drained;c++)k++}
  const queueWaiting=ultraMetrics?performance.now():0;
  // The tick phase of the game timer is unknown, so allow one extra tick.
  for(const done=drained+50;performance.now()<done;)await pace(),status(ops.length-1,"Sending to other players… "+Math.min(99,Math.round(100*(1-(done-performance.now())/(done-queueStart))))+"%"),await s(Math.min(100,Math.max(1,done-performance.now())));
  ultraMetrics&&(ultraMetrics.queueWaitMs+=performance.now()-queueWaiting);
  y.rejectedFills=rejected;
  }finally{channel.port1.onmessage=null;channel.port1.close();channel.port2.close()}
}
let P=-1,S=-1,z=0,D=null,N=null,q=-1/0;const F=e=>{const t=performance.now();if(e!==g.length-1&&t-q<100)return;q=t;const o=document.querySelector("#game-clock .text")?.textContent.trim(),r=/^\d+$/.test(o||"")?Number(o):null;i(p.id,y.paused?"paused":"drawing",y.paused?"Paused. Resume when ready.":"Drawing "+Math.round((e+1)/g.length*100)+"%"+(null===r?"":" · "+r+" sec left"))};for(let e=0;e<g.length;e++){for(m();y.paused;)await s(80),m();const o=g[e];if(o.fallbackFor===D&&d(N,o))continue;if(o.color!==P){const e=b.get(o.color);if(!e?.isConnected)throw new Error("The game palette changed. Convert the image again.");e.dispatchEvent(new PointerEvent("pointerdown",{bubbles:!0,button:0,pointerId:1937042,pointerType:"mouse"})),P=o.color}if(o.brush!==S&&(l(f,h,o.brush),S=o.brush),"fill"===o.tool){await s(60),await M(),z=0,c(f,o)?(n.click(),I=o.points[0],u(f,"pointerdown",I,!0,ultraPointer),C=!0,u(f,"pointerup",I,!1,ultraPointer),C=!1,await s(60),await M(),t.click(),i(p.id,"drawing","Filled enclosed shape")):i(p.id,"drawing","Using strokes for an open or delicate area"),D=o.group;try{N=f.getContext("2d").getImageData(0,0,800,600).data}catch{N=null}continue}const r=2===o.points.length&&o.points[0][0]===o.points[1][0]&&o.points[0][1]===o.points[1][1];if(!r&&z&&(await s(Math.ceil(E*z/A)),await M(),z=0),I=o.points[0],u(f,"pointerdown",I,!0,ultraPointer),C=!0,r)u(f,"pointerup",I,!1,ultraPointer),C=!1,z++,(z>=A||e===g.length-1)&&(await s(Math.ceil(E*z/A)),m(),z=0),F(e);else{for(let e=1;e<o.points.length;e++){if("fast"===p.speed||"instant"===p.speed){await M();let e=v-(performance.now()-k);for(;e>0;)await s(Math.ceil(e)),await M(),e=v-(performance.now()-k)}else await s(v),await M();I=o.points[e],u(f,"pointermove",I,!0,ultraPointer),k=performance.now()}u(f,"pointerup",I,!1,ultraPointer),C=!1,x&&await s(x),m(),F(e)}}z&&(await s(Math.ceil(E*z/A)),m());if(ultraMetrics){ultraMetrics.executionMs=performance.now()-y.startedAt;ultraMetrics.totalMs=(Number.isFinite(ultraMetrics.imageLoadMs)?Math.max(0,ultraMetrics.imageLoadMs):0)+(Number.isFinite(ultraMetrics.preprocessMs)?Math.max(0,ultraMetrics.preprocessMs):0)+ultraMetrics.executionMs;ultraMetrics.targetMet=ultraMetrics.totalMs<=5000;ultraMetrics.totalActions=ultraMetrics.pointerDowns+ultraMetrics.pointerMoves+ultraMetrics.pointerUps+ultraMetrics.colorChanges+ultraMetrics.toolChanges+ultraMetrics.sizeChanges+1;i(p.id,"done","Ultra Fast finished in "+(ultraMetrics.totalMs/1e3).toFixed(1)+" sec.",{metrics:ultraMetrics})}else i(p.id,"done",p.ops?"Done in "+((performance.now()-y.startedAt)/1e3).toFixed(1)+" sec, including delivery to other players."+(y.rejectedFills?" "+y.rejectedFills+" fill(s) used strokes for safety.":""):"Drawing sent to game after "+((performance.now()-y.startedAt)/1e3).toFixed(1)+" sec. Other players may still be receiving it.")}catch(e){i(p.id,"error",e.message)}finally{C&&u(f,"pointerup",I,!1,ultraPointer),ultraPointer?.close(),t=null}}),document.addEventListener("pointerdown",e=>{e.isTrusted&&e.target.closest("#game-canvas canvas, #game-toolbar")&&t&&(t.cancelled=!0)},!0),document.addEventListener("click",e=>{e.isTrusted&&e.target.closest("#game-toolbar")&&t&&(t.cancelled=!0)},!0),window.addEventListener("pagehide",()=>{t&&(t.cancelled=!0)})})();
