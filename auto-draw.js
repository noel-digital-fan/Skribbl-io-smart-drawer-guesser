(()=>{const e=globalThis.SG_IMAGE_CONVERTER,t=globalThis.SG_IMAGE_INPUT,s="sgDrawSettings";let a,n=!1,o=!1,r=null;const i=new Promise(e=>{a=e}),d=e=>!!e&&e.getClientRects().length>0&&"hidden"!==getComputedStyle(e).visibility,l=()=>{const e=document.querySelector("#game-word .word");return d(e)&&d(document.querySelector("#game-toolbar"))?e.textContent.trim().toLowerCase():""};let c,u,g,p="",m=!1,h=!1,f=!1,b="",y=!1,w=[],v=null,x=null,E=!1,S=0,A=null;let imageLoadMs=0,imageAdjustmentMs=0,imageEditor=null,preparedImage=null,savedSettings={},smartDots=true;
let imageQueue=[],queueSequence=0,selectedQueuedImage=null,queuePreviewId=null,queueAttempt=null,queueUsedTurn=false,queueFrame=0;const D=e=>c.querySelector(e),k=e=>document.dispatchEvent(new CustomEvent("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request",{detail:JSON.stringify(e)}));function C(e,t){try{chrome.runtime.sendMessage(e,t)}catch{c&&T("Extension was updated or disconnected. Refresh this game page.")}}const T=e=>{D(".ssdg-d-status").textContent=e};function L(e){g.hidden=e,c.hidden=!e,u.querySelectorAll("button").forEach(t=>{const s="draw"===t.dataset.tab===e;t.setAttribute("aria-selected",String(s)),t.tabIndex=s?0:-1})}function M(){return{...savedSettings,schemaVersion:Math.max(1,Number(savedSettings.schemaVersion)||1),style:D(".ssdg-d-style").value,brush:D(".ssdg-d-brush").value,speed:D(".ssdg-d-speed").value,smartDots,autoPaintOnDrop:D(".ssdg-d-auto-paint").checked}}
let clipboardRequest=null;
function cancelClipboardRead(){
  if(!clipboardRequest)return false;
  clearTimeout(clipboardRequest.timer);clipboardRequest=null;I();return true;
}
async function pasteClipboardImage(){
  if(!n||clipboardRequest)return;
  const request={word:l(),sequence:S};clipboardRequest=request;I();T("Reading clipboard image…");
  request.timer=setTimeout(()=>{
    if(clipboardRequest===request){cancelClipboardRead();T("Clipboard access timed out. Press Ctrl+V (or Command+V) to paste an image.")}
  },20000);
  try{
    const input=await t.readClipboard();
    if(clipboardRequest!==request)return;
    cancelClipboardRead();
    if(request.sequence!==S||request.word!==l()){T("Your drawing turn changed. Paste the image again.");return}
    L(true);await _(input,{autoPaint:true});
  }catch(error){
    if(clipboardRequest===request){cancelClipboardRead();T(error.message)}
  }finally{clearTimeout(request.timer)}
}
function updateDropHelp(){
  const automatic=D(".ssdg-d-auto-paint").checked;
  D(".ssdg-d-auto-paint-state").textContent=automatic?"On":"Off";
  D(".ssdg-d-drop-help").textContent=!p?"Drop or paste to queue · click to choose a file":automatic?"Drop or paste to draw · click to edit first":"Drop, paste or click to preview and edit";
  D(".ssdg-d-dropzone").setAttribute("aria-label",!p?"Drop an image or choose a file to queue and edit before your turn":automatic?"Drop an image to draw automatically, or choose a file to edit first":"Drop an image or choose a file to preview and edit");
}function R(e=M()){if(r=e,o)return;const t=()=>{if(!r)return void(o=!1);o=!0;const e=r;r=null;try{chrome.storage.local.set({[s]:e},()=>{chrome.runtime.lastError&&T("Drawing settings could not be saved. Reload the extension and try again."),t()})}catch{o=!1,T("Drawing settings could not be saved. Reload the extension and try again.")}};t()}function I(){
  D(".ssdg-d-auto-paint").disabled=!n;
  D(".ssdg-d-paste").disabled=!n||!!clipboardRequest;
  c.querySelectorAll(".ssdg-d-edit").forEach(control=>control.disabled=h||E||!n);
  D(".ssdg-d-text-draw").disabled=h||E||!n||!p||l()!==p;
  D(".ssdg-d-sketch-help").hidden=D(".ssdg-d-style").value!=="sketch"&&D(".ssdg-d-speed").value!=="instant";
  D(".ssdg-d-pause").disabled=!h;D(".ssdg-d-pause").textContent=f?"Resume":"Pause";
  D(".ssdg-d-stop").disabled=!h&&!E&&!clipboardRequest;
  imageEditor?.setDisabled(h||E||!n);
  imageEditor?.setPrimaryAction({label:selectedQueuedImage&&(!p||l()!==p)?"Save changes":"Draw image"});
  if(imageEditor)imageEditor.element.querySelector(".ssdg-d-image-cancel").textContent=selectedQueuedImage?"Close editor":"Cancel";
  c.querySelectorAll(".ssdg-d-queue-edit").forEach(button=>button.disabled=h||E||!n||!imageQueue.find(item=>String(item.id)===button.dataset.id)?.bitmap);
}
function q(force=false){
  x=null;
  if(imageEditor&&!imageEditor.element.hidden&&!force){D(".ssdg-d-estimate").textContent=selectedQueuedImage&&!p?"Changes are saved with this image while it waits for your turn.":"Choose Draw image to convert and draw your adjustments.";I();return}
  if(v&&w.length){
    try{
      const settings=M(),edited=imageEditor?.getSettings(),palette=edited?.monochrome?w.filter(color=>color.rgb[0]===color.rgb[1]&&color.rgb[1]===color.rgb[2]):w;
      if(!palette.length)throw new Error("Black-and-white colors are unavailable. Reload the game.");
      x=e.convert(preparedImage||v,palette,settings);
      if(settings.speed==="instant"&&x.metrics){
        x.metrics.imageLoadMs=imageLoadMs;x.metrics.imageAdjustmentMs=imageAdjustmentMs;
        x.metrics.preprocessMs+=imageAdjustmentMs;x.planMs=Math.round(x.metrics.preprocessMs);
        x.metrics.totalEstimatedMs=imageLoadMs+x.metrics.preprocessMs+1000*x.seconds;
      }
      D(".ssdg-d-estimate").textContent="Estimated drawing time: "+x.seconds+" sec";
      const clock=document.querySelector("#game-clock .text")?.textContent.trim(),left=/^\d+$/.test(clock||"")?Number(clock):null;
      if(left!==null)D(".ssdg-d-estimate").textContent+=" · "+left+" sec left";
      if(x.seconds>(left===null?55:Math.max(0,left-5)))D(".ssdg-d-estimate").textContent+=" · May not finish in time.";
      if(!(x.ops||x.strokes).length)T("The image contains only its background color.");
    }catch(error){T(error.message)}
  }else if(v)T("Drawing colors are not ready. Try again when the drawing toolbar appears.");
  I();
}
function startDrawing(){
  if(h||E||!p||l()!==p||!x)return;
  queueUsedTurn=true;h=true;f=false;y=false;b=Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
  I();T("Starting drawing…");
  k({action:"draw",id:b,word:p,background:x.background,strokes:x.strokes,...(x.ops?{ops:x.ops}:{}),speed:M().speed,style:M().style,smartDots:M().smartDots,...(M().speed==="instant"?{planMetrics:x.metrics}:{})});
  const drawingId=b;
  setTimeout(()=>{if(h&&drawingId===b&&!y){k({action:"stop",id:drawingId});h=false;I();T("Drawing controls did not respond. Reload the game and try again.")}},5000);
  return true;
}
async function drawEditedImage({automatic=false}={}){
  if(h||E||!v)return;
  cancelClipboardRead();
  if(selectedQueuedImage&&(!p||l()!==p)){
    selectedQueuedImage.settings=imageEditor.getSettings();S++;N();renderQueue();
    T("Changes saved. The image remains in your queue.");return;
  }
  if(!p||l()!==p)return;
  const sequence=S,word=p,original=v,queued=selectedQueuedImage;
  E=true;I();T("Applying image adjustments…");
  let adjusted=null;
  try{
    const began=performance.now(),rendered=imageEditor.prepare();
    if(rendered!==original){
      try{adjusted=await createImageBitmap(rendered)}finally{rendered.width=rendered.height=1}
    }
    if(sequence!==S||word!==l()){
      adjusted?.close();
      if(sequence===S){N();T("Your drawing turn changed. Upload the image again on your next turn.")}
      return;
    }
    if(automatic&&!D(".ssdg-d-auto-paint").checked){
      adjusted?.close();E=false;I();T("Auto-paint is off. Your edited image stays in the queue.");return;
    }
    preparedImage?.close();preparedImage=adjusted;adjusted=null;
    imageAdjustmentMs=performance.now()-began;E=false;
    q(true);if(startDrawing()&&queued)consumeQueuedImage(queued);
  }catch(error){
    adjusted?.close();
    if(sequence===S){E=false;T(error.message);I()}
  }
}

function scheduleQueueRender(){
  if(!queueFrame)queueFrame=requestAnimationFrame(()=>{queueFrame=0;renderQueue()});
}
function renderQueue(){
  if(!c)return;
  D(".ssdg-d-queue").hidden=!imageQueue.length;D(".ssdg-d-queue-count").textContent=String(imageQueue.length);
  D(".ssdg-d-queue-help").textContent=D(".ssdg-d-auto-paint").checked?"One ready image draws each turn, in queue order. Edits stay with each image.":"Edit while you wait, then choose Draw image on your turn.";
  const list=D(".ssdg-d-queue-list"),rows=[];
  for(const item of imageQueue){
    const row=document.createElement("div");row.className="ssdg-d-queue-item";row.dataset.id=String(item.id);
    if(item===selectedQueuedImage){row.classList.add("is-selected");row.setAttribute("aria-current","true")}
    if(item.state==="error")row.classList.add("is-error");
    const thumbnail=document.createElement("canvas");thumbnail.className="ssdg-d-queue-thumb";thumbnail.width=thumbnail.height=42;thumbnail.setAttribute("aria-hidden","true");
    if(item.bitmap){
      const rendered=globalThis.SG_IMAGE_ADJUSTMENTS.render(item.bitmap,item.settings,{maxWidth:42,maxHeight:42});
      thumbnail.getContext("2d").drawImage(rendered,(42-rendered.width)/2,(42-rendered.height)/2);rendered.width=rendered.height=1;
    }
    const copy=document.createElement("div");copy.className="ssdg-d-queue-copy";
    const title=document.createElement("span");title.className="ssdg-d-queue-title";title.textContent=item.input.title||"Queued image";title.title=title.textContent;
    const state=document.createElement("span");state.className="ssdg-d-queue-state";state.textContent=item.state==="loading"?"Loading image...":item.state==="error"?item.error:item===imageQueue.find(entry=>entry.state==="ready")?"Next turn":"Waiting";
    copy.append(title,state);
    const edit=document.createElement("button");edit.type="button";edit.className="ssdg-d-queue-edit";edit.dataset.id=String(item.id);edit.textContent="Edit";edit.setAttribute("aria-label","Edit "+title.textContent);edit.disabled=!item.bitmap||h||E||!n;edit.onclick=()=>{queuePreviewId=item.id;selectQueuedImage(item)};
    const remove=document.createElement("button");remove.type="button";remove.className="ssdg-d-queue-remove";remove.textContent="×";remove.title="Remove image";remove.setAttribute("aria-label","Remove "+title.textContent);remove.onclick=()=>removeQueuedImage(item);
    row.append(thumbnail,copy,edit,remove);rows.push(row);
  }
  list.replaceChildren(...rows);I();
}
function showQueuedCredit(item){
  const title=document.createElement(item.input.source?"a":"span"),note=document.createElement("span");title.textContent=item.input.title||"Queued image";
  if(item.input.source){title.href=item.input.source;title.target="_blank";title.rel="noopener noreferrer"}
  note.textContent="Queued locally · adjustments are saved with this image";D(".ssdg-d-credit").replaceChildren(title,note);
}
function selectQueuedImage(item,announce=true){
  if(h||E||!item.bitmap||!imageQueue.includes(item))return;
  S++;N();selectedQueuedImage=item;v=item.bitmap;imageLoadMs=item.loadMs;
  imageEditor.open(v,item.settings);showQueuedCredit(item);L(true);renderQueue();q();
  if(announce){
    T(p?"Edit this queued image, then choose Draw image.":"Edit now, or save the image for your next turn.");
    requestAnimationFrame(()=>{
      if(selectedQueuedImage!==item||c.hidden)return;
      const body=c.closest(".ssdg-body");
      if(body)body.scrollTop+=imageEditor.element.getBoundingClientRect().top-body.getBoundingClientRect().top-12;
    });
  }
}
async function enqueueImage(input){
  const item={id:++queueSequence,input,bitmap:null,settings:globalThis.SG_IMAGE_ADJUSTMENTS.normalize({}),state:"loading",controller:new AbortController(),loadMs:0,error:""};
  imageQueue.push(item);queuePreviewId=item.id;L(true);renderQueue();T("Image added to the waiting queue.");
  const began=performance.now(),timeout=setTimeout(()=>item.controller.abort(),20000);
  try{
    const bitmap=await t.load(input,item.controller.signal);
    if(item.controller.signal.aborted||!imageQueue.includes(item)){bitmap.close();return}
    item.bitmap=bitmap;item.loadMs=performance.now()-began;item.state="ready";
    if(queuePreviewId===item.id&&!h&&!E&&!clipboardRequest)selectQueuedImage(item);
    else renderQueue();
    maybeStartQueuedImage();
  }catch(error){
    if(!imageQueue.includes(item))return;
    item.state="error";item.error=error.name==="AbortError"?"Image loading timed out. Remove it and try again.":error.message;
    renderQueue();T(item.error);
  }finally{clearTimeout(timeout)}
}
function removeQueuedImage(item){
  if(!imageQueue.includes(item))return;
  if(selectedQueuedImage===item){S++;queueUsedTurn=!!queueAttempt||queueUsedTurn;N()}
  imageQueue=imageQueue.filter(entry=>entry!==item);item.controller.abort();item.bitmap?.close();
  if(queuePreviewId===item.id)queuePreviewId=null;
  renderQueue();T("Image removed from the queue.");
}
function clearImageQueue(){
  cancelClipboardRead();
  if(selectedQueuedImage){S++;queueUsedTurn=!!queueAttempt||queueUsedTurn;N()}
  const removed=imageQueue;imageQueue=[];queuePreviewId=null;
  for(const item of removed){item.controller.abort();item.bitmap?.close()}
  if(queueFrame)cancelAnimationFrame(queueFrame);queueFrame=0;renderQueue();
}
function consumeQueuedImage(item){
  imageQueue=imageQueue.filter(entry=>entry!==item);selectedQueuedImage=null;
  if(queuePreviewId===item.id)queuePreviewId=null;
  // The active drawing now owns v; N() will close it once it is replaced.
  renderQueue();
}
async function maybeStartQueuedImage(){
  if(!n||!p||l()!==p||h||E||clipboardRequest||queueAttempt||queueUsedTurn||v&&!selectedQueuedImage)return;
  const item=imageQueue.find(entry=>entry.state==="ready");
  if(!item)return;
  if(!D(".ssdg-d-auto-paint").checked){if(!selectedQueuedImage)selectQueuedImage(item);return}
  selectQueuedImage(item,false);
  const attempt={sequence:S,word:p,controller:new AbortController()};queueAttempt=attempt;A=attempt.controller;E=true;I();
  T("Preparing the next queued image...");
  try{
    await waitForDrawingColors(attempt.controller.signal,true);
    if(attempt.sequence!==S||attempt.word!==l()||attempt.controller.signal.aborted)return;
    E=false;I();
    if(D(".ssdg-d-auto-paint").checked)await drawEditedImage({automatic:true});
    else T("Auto-paint is off. Your edited image stays in the queue.");
    if(!h&&selectedQueuedImage===item&&D(".ssdg-d-auto-paint").checked)queueUsedTurn=true;
  }catch(error){
    if(attempt.sequence===S){E=false;queueUsedTurn=true;T(error.name==="AbortError"?"Queued drawing cancelled. The image stays in the queue.":error.message);I()}
  }finally{if(queueAttempt===attempt)queueAttempt=null}
}
function N(){
  cancelClipboardRead();
  imageEditor?.close();preparedImage?.close();preparedImage=null;imageAdjustmentMs=0;
  A?.abort();A=null;
  if(v&&!imageQueue.some(item=>item.bitmap===v))v.close?.();
  selectedQueuedImage=null;E=false;v=null;x=null;
  D(".ssdg-d-estimate").textContent="";D(".ssdg-d-credit").replaceChildren();I();
}let G=null;async function _(e,{autoPaint=false}={}){cancelClipboardRead();const s=l();await i;if(!s&&!e.text)return enqueueImage(e);if(s!==l())return void T("Your drawing turn changed. Drop the image again on your next turn.");if(!p||l()!==p)return void T("Your drawing turn changed. Drop the image again to add it to the queue.");const a=++S,n=p;N(),E=!0;const o=new AbortController;A=o,I();let r=!1;const d=setTimeout(()=>{r=!0,o.abort()},2e4);T(e.text?"Loading text image…":autoPaint&&D(".ssdg-d-auto-paint").checked?"Loading image to draw…":"Loading image preview…");try{if(await function(){if(G)return G;if(!h)return Promise.resolve();const e=b;return G=new Promise((t,s)=>{const a=e=>{clearTimeout(o),document.removeEventListener("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status",n),e?s(e):t()},n=t=>{let s;try{s=JSON.parse(t.detail)}catch{return}s.id===e&&["done","error"].includes(s.state)&&a()},o=setTimeout(()=>a(new Error("Could not stop the previous drawing. Reload the game and try again.")),5e3);document.addEventListener("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status",n),k({action:"stop",id:e})}).finally(()=>{G=null}),G}(),a!==S||n!==l())return;h=!1,f=!1,b="";const loadStarted=performance.now(),s=await t.load(e,o.signal);imageLoadMs=loadStarted?performance.now()-loadStarted:0;if(a!==S||n!==l())return s.close(),void(a===S&&(N(),T("Your drawing turn changed. Drop the image again on your next turn.")));v=s,E=!1;const r=document.createElement(e.source?"a":"span");e.source&&(r.href=e.source,r.target="_blank",r.rel="noopener noreferrer"),r.textContent=e.title||"Dropped image";const i=document.createElement("span");i.textContent=e.text?"Typed text · rendered locally on your device":e.file?"Local file · stays on your device":"Website image · processed on your device",D(".ssdg-d-credit").replaceChildren(r,i);if(e.text||autoPaint&&D(".ssdg-d-auto-paint").checked){
  E=true;I();
  await waitForDrawingColors(o.signal,!e.text);
  if(a!==S||n!==l()||o.signal.aborted)return;
  E=false;
  if(!e.text&&!D(".ssdg-d-auto-paint").checked){imageEditor.open(v);T("Adjust the image, then choose Draw image.");I()}
  else{q(true);startDrawing()}
}else{imageEditor.open(v);T("Adjust the image, then choose Draw image.");I()}}catch(e){a===S&&(E=!1,T(r?"Image loading timed out. Try again or use a local file.":"AbortError"===e.name?"Image loading cancelled.":e.message),v&&imageEditor.open(v),I())}finally{clearTimeout(d)}}function waitForDrawingColors(signal,allowPreview=false){
  if(signal.aborted)return Promise.reject(new DOMException("Cancelled","AbortError"));
  if(w.length||allowPreview&&!D(".ssdg-d-auto-paint").checked)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const finish=error=>{clearTimeout(timer);document.removeEventListener("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status",check);signal.removeEventListener("abort",cancel);D(".ssdg-d-auto-paint").removeEventListener("change",preview);error?reject(error):resolve()};
    const check=()=>{if(w.length)finish()},cancel=()=>finish(new DOMException("Cancelled","AbortError")),preview=()=>{if(allowPreview&&!D(".ssdg-d-auto-paint").checked)finish()};
    const timer=setTimeout(()=>finish(new Error("Drawing colors are not ready. Choose Draw image when the toolbar appears.")),5000);
    document.addEventListener("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status",check);signal.addEventListener("abort",cancel,{once:true});D(".ssdg-d-auto-paint").addEventListener("change",preview);
    k({action:"palette",id:"ssdg-d-palette"});
  });
}
function P(word){
  const selected=selectedQueuedImage;
  S++;if(h)k({action:"stop",id:b});h=false;f=false;b="";N();
  p=word;queueUsedTurn=false;queueAttempt=null;
  D(".ssdg-d-word").textContent=word?"Your word: "+word:"Drop or paste images to prepare for your next turn.";
  const search=D(".ssdg-d-google");
  if(word){search.href="https://www.google.com/search?tbm=isch&q="+encodeURIComponent(word+" cartoon drawing");search.removeAttribute("aria-disabled");search.tabIndex=0}
  else{search.removeAttribute("href");search.setAttribute("aria-disabled","true");search.tabIndex=-1}
  if(selected&&imageQueue.includes(selected)&&selected.bitmap)selectQueuedImage(selected,false);
  else T(word?"Drop or paste an image to draw, or choose a file to edit first.":"Dropped or pasted images wait in the queue and can be edited.");
  updateDropHelp();renderQueue();
  queueMicrotask(()=>maybeStartQueuedImage());
}setInterval(()=>{if(function(){if(c)return;const e=document.querySelector("#skribbl-smart-drawer-guesser-panel .ssdg-body");if(!e)return;for(g=document.createElement("div"),g.id="ssdg-d-guess-pane",g.setAttribute("role","tabpanel"),g.setAttribute("aria-labelledby","ssdg-d-guess-tab");e.firstChild;)g.append(e.firstChild);u=document.createElement("div"),u.className="ssdg-d-tabs",u.setAttribute("role","tablist"),u.setAttribute("aria-label","Guesser mode"),u.innerHTML='<button id="ssdg-d-guess-tab" type="button" role="tab" data-tab="guess" aria-controls="ssdg-d-guess-pane"><span class="ssdg-tab-icon" aria-hidden="true">?</span> Guess</button><button id="ssdg-d-draw-tab" type="button" role="tab" data-tab="draw" aria-controls="ssdg-d-draw-pane"><span class="ssdg-tab-icon" aria-hidden="true">&#9998;</span> Draw</button>',u.querySelectorAll("button").forEach(e=>{e.onclick=()=>L("draw"===e.dataset.tab),e.onkeydown=t=>{if(["ArrowLeft","ArrowRight","Home","End"].includes(t.key)){t.preventDefault();const s="End"===t.key||"Home"!==t.key&&"draw"!==e.dataset.tab;L(s),u.querySelector('[data-tab="'+(s?"draw":"guess")+'"]').focus()}}}),c=document.createElement("section"),c.className="ssdg-d",c.id="ssdg-d-draw-pane",c.setAttribute("role","tabpanel"),c.setAttribute("aria-labelledby","ssdg-d-draw-tab"),c.innerHTML='<div class="ssdg-d-heading">Make your mark <small>Auto Draw</small></div><p class="ssdg-d-word"></p><button type="button" class="ssdg-d-dropzone"><span class="ssdg-d-drop-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 4 4 3-3 6 6"/></svg></span><strong>Drop or paste an image</strong><small class="ssdg-d-drop-help">Drop to draw automatically · click to edit first</small></button><input class="ssdg-d-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden><p class="ssdg-d-disclosure">PNG, JPEG, WebP or GIF (first frame), up to 10 MB. Local files stay on your device.</p><div class="ssdg-d-tools"><button type="button" class="ssdg-d-paste" title="Paste an image from your clipboard" aria-describedby="ssdg-d-paste-help">Paste image</button><a class="ssdg-d-google" target="_blank" rel="noopener noreferrer" title="Opens Google Images in a small window and sends your drawing word to Google">Google Images</a></div><p id="ssdg-d-paste-help" class="ssdg-d-disclosure">Copy an image, then focus this Draw panel and press Ctrl+V (or Command+V).</p><form class="ssdg-d-text-form"><label for="ssdg-d-text-input">Draw typed text</label><div><span class="ssdg-d-input-wrap"><textarea id="ssdg-d-text-input" class="ssdg-d-text-input" name="draw-text" rows="1" maxlength="120" required autocomplete="off" placeholder="Type something to draw…" aria-describedby="ssdg-d-text-help"></textarea><button class="ssdg-d-text-clear" type="button" aria-label="Clear typed text" title="Clear typed text" hidden>×</button></span><button class="ssdg-d-text-draw" type="submit">Draw</button></div><small id="ssdg-d-text-help">Enter adds a line. Your text is centered and rendered locally.</small></form><section class="ssdg-d-queue" hidden aria-label="Waiting image queue"><div class="ssdg-d-queue-heading"><div>Image queue <span class="ssdg-d-queue-count">0</span></div><button type="button" class="ssdg-d-queue-clear">Clear</button></div><p class="ssdg-d-queue-help"></p><div class="ssdg-d-queue-list"></div></section><div id="ssdg-d-settings" class="ssdg-d-settings"><div class="ssdg-d-settings-heading">Drawing preferences</div><div class="ssdg-d-options"><label>Draw style<select class="ssdg-d-style ssdg-d-edit"><option value="lines">Lines</option><option value="dots">Dots</option><option value="sketch" selected>Sketch</option></select></label><label>Brush size<select class="ssdg-d-brush ssdg-d-edit"><option value="4">1 — 4 px</option><option value="5" selected>2 — 5 px</option><option value="6">3 — 6 px</option></select></label><label>Speed<select class="ssdg-d-speed ssdg-d-edit"><option value="slow">Slow</option><option value="normal">Normal</option><option value="fast">Fastest</option><option value="instant" selected>Ultra Fast</option></select></label></div><label class="ssdg-d-setting-toggle"><span class="ssdg-d-toggle-copy"><span id="ssdg-d-auto-paint-label">Auto-paint images on drop or paste</span><small id="ssdg-d-auto-paint-help">Turn off to preview and adjust before drawing.</small></span><span class="ssdg-d-switch-control"><input type="checkbox" class="ssdg-d-auto-paint" role="switch" checked aria-labelledby="ssdg-d-auto-paint-label" aria-describedby="ssdg-d-auto-paint-help"><span class="ssdg-d-auto-paint-state" aria-hidden="true">On</span></span></label><p class="ssdg-d-disclosure ssdg-d-sketch-help" hidden>Sketch follows outlines and fills enclosed areas. Ultra Fast keeps full detail; complex images may take longer than the time left in your turn.</p></div><div class="ssdg-d-estimate"></div><div class="ssdg-d-credit"></div><p class="ssdg-d-status" role="status" aria-live="polite"></p><div class="ssdg-d-actions"><button class="ssdg-d-pause" type="button" disabled>Pause</button><button class="ssdg-d-stop" type="button" disabled>Stop</button></div>',e.append(u,g,c);imageEditor=globalThis.SG_IMAGE_EDITOR.create(c,{onDraw:drawEditedImage,onCancel:()=>{const queued=!!selectedQueuedImage;S++;N();renderQueue();T(queued?"Editor closed. Your image is still queued.":"Image cancelled.")},onError:T,onChange:settings=>{if(selectedQueuedImage){selectedQueuedImage.settings=settings;scheduleQueueRender()}}});D(".ssdg-d-queue-clear").onclick=()=>{clearImageQueue();T("Image queue cleared.")};L(!1),P(""),function(){const e=e=>e.target instanceof Element?(!c.hidden&&!c.closest("[hidden], .collapsed")&&c.contains(e.target)?c:null):null,s=()=>{c.classList.remove("ssdg-d-drag-over"),document.querySelectorAll("canvas.ssdg-d-drag-over").forEach(e=>e.classList.remove("ssdg-d-drag-over"))};document.addEventListener("dragover",a=>{const n=e(a);n&&t.supports(a.dataTransfer)&&(a.preventDefault(),s(),n.classList.add("ssdg-d-drag-over"),a.dataTransfer.dropEffect="copy")}),document.addEventListener("dragleave",t=>{t.relatedTarget&&e({target:t.relatedTarget})||s()}),document.addEventListener("dragend",s),document.addEventListener("drop",a=>{const n=e(a);if(s(),n&&t.supports(a.dataTransfer)){a.preventDefault(),a.stopPropagation(),L(!0);try{_(t.fromDrop(a.dataTransfer),{autoPaint:true})}catch(e){T(e.message)}}},!0),window.addEventListener("pagehide",s);
  document.addEventListener("paste",event=>{
    // Accept images only inside our visible panel; canvas/chat belong to the game.
    if(event.defaultPrevented||!e(event))return;
    try{
      const input=t.fromClipboard(event.clipboardData);if(!input)return;
      event.preventDefault();event.stopPropagation();L(true);_(input,{autoPaint:true});
    }catch(error){T(error.message)}
  },true);
  D(".ssdg-d-paste").onclick=pasteClipboardImage;
  D(".ssdg-d-dropzone").onclick=()=>{cancelClipboardRead();D(".ssdg-d-file").click()},D(".ssdg-d-file").onchange=e=>{const t=e.target.files[0];e.target.value="",t&&_({file:t,title:t.name})}}(),D(".ssdg-d-google").onclick=e=>{e.preventDefault(),p&&C({type:"OPEN_DRAW_IMAGE_SEARCH",query:p,width:Math.max(320,Math.min(900,Math.floor(.7*screen.availWidth))),height:Math.max(300,Math.min(650,Math.floor(.8*screen.availHeight)))},e=>{!chrome.runtime.lastError&&e?.ok||T("Could not open the image window. Reload the extension and try again.")})},D(".ssdg-d-text-form").onsubmit=async e=>{if(e.preventDefault(),e.isComposing)return;cancelClipboardRead();const t=D(".ssdg-d-text-input"),s=t.value.trim();if(s)try{const e=await function(e){const t=document.createElement("canvas");t.width=600,t.height=400;const s=t.getContext("2d",{alpha:!1});s.fillStyle="#fff",s.fillRect(0,0,600,400),s.fillStyle="#101010",s.font="700 64px Arial, sans-serif",s.textAlign="center",s.textBaseline="middle";const a=[],n=e=>{let t="";for(const n of e)t&&s.measureText(t+n).width>516?(a.push(t),t=n):t+=n;t&&a.push(t)};for(const t of e.replace(/\r/g,"").split("\n")){if(!t.trim()){a.push("");continue}let e="";for(const o of t.trim().split(/\s+/)){const t=e?e+" "+o:o;s.measureText(t).width<=516?e=t:(e&&a.push(e),s.measureText(o).width<=516?e=o:(n(o),e=""))}e&&a.push(e)}const o=Math.max(28,Math.min(64,Math.floor(316/Math.max(1,a.length)/1.25)));s.font="700 "+o+"px Arial, sans-serif";const r=Math.round(1.25*o),i=200-(a.length-1)*r/2;return a.forEach((e,t)=>s.fillText(e,300,i+t*r)),new Promise((e,s)=>t.toBlob(t=>t?e(t):s(new Error("Could not create the text image.")),"image/png"))}(s);await _({file:e,title:"Typed text: "+s.replace(/\s+/g," "),text:!0})}catch(e){T(e.message)}else t.focus()};const r=D(".ssdg-d-text-input"),i=D(".ssdg-d-text-clear"),d=()=>{i.hidden=!r.value},m=e=>{e.stopImmediatePropagation()};["keydown","keypress","keyup"].forEach(e=>r.addEventListener(e,m,!0)),r.oninput=e=>{e.currentTarget.style.height="auto",e.currentTarget.style.height=Math.min(e.currentTarget.scrollHeight,92)+"px",d()},i.onclick=()=>{r.value="",r.style.height="auto",d(),r.focus()},c.querySelectorAll(".ssdg-d-options select").forEach(e=>e.onchange=()=>{R(),I(),q()}),D(".ssdg-d-auto-paint").onchange=()=>{updateDropHelp();renderQueue();if(n){R();maybeStartQueuedImage()}},function(){const e=(stored,error)=>{
  if(error)T("Saved drawing settings could not be loaded. Reload the extension and try again.");
  else{
    const candidates=[stored?.[s],stored?.sgDrawSettings202,stored?.sgDrawSettings201].filter(value=>value&&typeof value==="object"&&!Array.isArray(value));
    savedSettings=candidates[0]||{};
    // A legacy partial record keeps the previous fallback speed. New records use Ultra Fast.
    if(candidates.length)D(".ssdg-d-speed").value="fast";
    for(const key of["style","brush","speed"]){
      const field=D(".ssdg-d-"+key);
      for(const candidate of candidates){
        let value=candidate[key];
        if(key==="brush"&&[10,20,32,40].includes(Number(value)))value="6";
        if(key==="speed"&&value==="max")value="instant";
        if([...field.options].some(option=>option.value===String(value))){field.value=String(value);break}
      }
    }
    const dots=candidates.find(value=>typeof value.smartDots==="boolean"),automatic=candidates.find(value=>typeof value.autoPaintOnDrop==="boolean");
    if(dots)smartDots=dots.smartDots;
    D(".ssdg-d-auto-paint").checked=automatic?automatic.autoPaintOnDrop:true;
    const settings=M();
    if(!stored?.[s]||Object.entries(settings).some(([key,value])=>stored[s][key]!==value))R(settings);
  }
  updateDropHelp();n=true;I();a();
};try{chrome.storage.local.get([s,"sgDrawSettings202","sgDrawSettings201"],t=>e(t,chrome.runtime.lastError))}catch{e(null,!0)}}(),D(".ssdg-d-pause").onclick=()=>k({action:f?"resume":"pause",id:b}),D(".ssdg-d-stop").onclick=()=>{if(cancelClipboardRead()&&!h&&!E)return void T("Clipboard image paste cancelled.");if(E)return queueUsedTurn=!!queueAttempt||queueUsedTurn,S++,N(),renderQueue(),void T("Image loading cancelled.");k({action:"stop",id:b}),T("Stopping…")},document.addEventListener("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status",e=>{let t;try{t=JSON.parse(e.detail)}catch{return}"palette"!==t.state||"ssdg-d-palette"!==t.id?t.id===b&&(y=!0,T(t.message),f="paused"===t.state,h=["drawing","paused"].includes(t.state),I()):Array.isArray(t.palette)&&t.palette.length&&t.palette.every(e=>Number.isInteger(e.index)&&Array.isArray(e.rgb)&&3===e.rgb.length&&e.rgb.every(e=>Number.isInteger(e)&&e>=0&&e<=255))&&(w=t.palette,v&&!h&&!E&&q())}),window.addEventListener("pagehide",()=>{C({type:"CLOSE_DRAW_IMAGE_SEARCH"},()=>{chrome.runtime.lastError}),k({action:"stop"}),clearImageQueue(),P("")}),window.addEventListener("pageshow",e=>{e.persisted&&P("")})}(),!c)return;const e=l(),o=document.querySelector("#game-canvas .overlay-content .words"),r=!!e||d(o)&&o.children.length>0;D(".ssdg-d-google").classList.toggle("ssdg-d-own-turn",r),(m&&!r||p&&!e)&&C({type:"CLOSE_DRAW_IMAGE_SEARCH"},()=>{chrome.runtime.lastError}),r!==m&&(m=r,L(r)),e!==p&&P(e),w.length||k({action:"palette",id:"ssdg-d-palette"}),maybeStartQueuedImage()},300)})();
