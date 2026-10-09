(()=>{"use strict";const e={autoGuessDelayMs:1e3,maxAutoGuesses:15,panelId:"skribbl-smart-drawer-guesser-panel"},n="guesserSettingsV160",t="guesserStatsV160";let o=[],s="",r=[],a=!1,i=!1,l=null,d=0,c=new Set,g=null,u="",p="",b="",f=new Set,m=new Set,x=new Set,h="",w={collapsed:!1,panelPosition:null,minHints:0},y={rounds:0,correct:0,guesses:0,learned:0,wordSuccess:{}},v=!1,k=0,C=0,E=null,S=null;
const wordLibrary = globalThis.SG_WORD_LIBRARY;
const wordCatalog = globalThis.SG_WORD_CATALOG;
// Shared DOM and MAIN-world bridges use this project's namespace.
// chrome.storage and SG_* modules already belong to this extension's isolated world.
let panelWindow = null, resolvePanelReady, refreshTimer;
let lastLocalSettings = {}, settingsSaveQueue = Promise.resolve();
const panelReady = new Promise(resolve => { resolvePanelReady = resolve; });
chrome.runtime.onMessage?.addListener((message, sender, respond) => {
  if (message?.type !== "SG_PANEL_VISIBILITY" || sender.id !== chrome.runtime.id) return false;
  if (!["restore", "hide", "toggle", "status"].includes(message.action)) {
    respond({ok:false, error:"Unsupported panel action."});
    return false;
  }
  const apply = () => {
    if (message.action === "restore") panelWindow.setHidden(false);
    else if (message.action === "hide") panelWindow.setHidden(true);
    else if (message.action === "toggle") panelWindow.toggleHidden();
    respond({ok:true, hidden:g.hidden, collapsed:Boolean(w.collapsed)});
  };
  if (panelWindow) { apply(); return false; }
  let pending = true;
  const timeout = setTimeout(() => {
    pending = false;
    respond({ok:false, error:"Menu is still loading."});
  }, 3000);
  panelReady.then(() => {
    if (!pending) return;
    pending = false;
    clearTimeout(timeout);
    apply();
  });
  return true;
});
const languageMeta = language => wordCatalog.find(entry => entry.code === language);
const languageLibraries = new Map();
const pendingLibraries = new Map();
let activeLanguage = "en", languageLoading = false, languageGeneration = 0, languageLoadMessage = "";
const statsKey = language => language === "en" ? t : t + ":" + language;
const extrasKey = language => language === "en" ? "extraWords" : "extraWords:" + language;
const emptyStats = () => ({rounds:0,correct:0,guesses:0,learned:0,wordSuccess:{}});
// The native room settings expose zero through five hints.
const maxHintThreshold = 5;
const normalizeHintThreshold = value => Math.min(maxHintThreshold, Math.max(0, Math.floor(Number(value) || 0)));

function currentGameHint() {
  const element = document.querySelector("#game-word .hints .container") || document.querySelector("#game-word .hints") || document.getElementById("game-word") ||
    document.querySelector(".word-container") || document.querySelector("#boxWord");
  // The client retains old hint nodes while choosing a word and after leaving.
  // Only hints from the currently visible game word may unlock automatic guesses.
  if (!element || !element.getClientRects().length || ["hidden", "collapse"].includes(getComputedStyle(element).visibility)) return "";
  return wordLibrary.parseHint(element, activeLanguage);
}

async function fetchLanguageLibrary(language) {
  if (languageLibraries.has(language)) return languageLibraries.get(language);
  if (pendingLibraries.has(language)) return pendingLibraries.get(language);
  const pending = (async () => {
    const filename = languageMeta(language).file;
    const response = await fetch(chrome.runtime.getURL(filename));
    if (!response.ok) throw new Error(filename + " could not be loaded (" + response.status + ")");
    const words = [...new Set((await response.text()).split(/\r?\n/).map(word=>wordLibrary.normalizeWord(word,language)).filter(Boolean))];
    if (!words.length) throw new Error(filename + " is empty");
    const stored = await chrome.storage.local.get([extrasKey(language), statsKey(language)]);
    const extra = new Set((Array.isArray(stored[extrasKey(language)]) ? stored[extrasKey(language)] : [])
      .map(word=>wordLibrary.normalizeWord(word,language)).filter(word=>wordLibrary.isLearnableWord(word,language)));
    const wordSet = new Set(words);
    for (const word of extra) if (!wordSet.has(word)) { words.push(word); wordSet.add(word); }
    const saved = stored[statsKey(language)];
    const stats = {...emptyStats(), ...saved, wordSuccess:{...saved?.wordSuccess}, learned:extra.size};
    const library = {words, wordSet, extra, stats};
    languageLibraries.set(language, library);
    return library;
  })();
  pendingLibraries.set(language, pending);
  try { return await pending; } finally { pendingLibraries.delete(language); }
}

function updateLanguageControls() {
  const select = document.getElementById("ssdg-language");
  if (select) {
    if (!select.options.length) for (const entry of wordCatalog) {
      const option=document.createElement("option"); option.value=entry.code; option.textContent=entry.label; select.appendChild(option);
    }
    select.value = activeLanguage; select.setAttribute("aria-busy", String(languageLoading));
  }
  const sync = document.getElementById("ssdg-sync-btn");
  if (sync) sync.textContent = "Sync words";
  const source = document.getElementById("ssdg-word-source");
  if (source) {
    const meta=languageMeta(activeLanguage);
    source.hidden = !meta.sourceUrl;
    source.href=meta.sourceUrl||"#";
    source.textContent = meta.label + ": community collection · full list unverified";
    source.title = meta.count + " entries from " + meta.sourceName + "; no public official complete dictionary was found.";
  }
}

async function selectLanguage(language) {
  if (!languageMeta(language)) language = "en";
  const generation = ++languageGeneration;
  activeLanguage = language; w.language = language; languageLoading = true;
  languageLoadMessage = "Loading " + languageMeta(language).label + " words…";
  ne(); o=[]; m=new Set(); x=new Set(); f=new Set(); y=emptyStats();
  s=""; r=[]; u=""; p=""; b=""; d=0; c.clear(); U.clear(); v=false; k=0; C=0;
  h=""; _=0; Y();
  const search = document.getElementById("ssdg-search");
  if (search) search.value="";
  const clear = document.getElementById("ssdg-search-clear");
  if (clear) clear.hidden=true;
  updateLanguageControls(); W(); P();
  if (g) K("—", [], languageLoadMessage);
  await L();
  try {
    const library = await fetchLanguageLibrary(language);
    if (generation !== languageGeneration) return;
    o=library.words; m=library.extra; y=library.stats; f=new Set(m); M();
    if (E!==null) y.rounds=E;
    languageLoading=false; languageLoadMessage="";
    updateLanguageControls(); W(); P(); Y();
    if (g) { ne(); te(); if (a) l=setInterval(Q,e.autoGuessDelayMs); }
  } catch (error) {
    if (generation !== languageGeneration) return;
    languageLoading=false;
    languageLoadMessage="Could not load " + languageMeta(language).label + " words. Switch language to retry.";
    console.warn("[Skribbl] Word library could not be loaded:", error);
    updateLanguageControls(); P();
    if (g) K("—", [], languageLoadMessage);
  }
}

async function importLearnedWords(file, language = activeLanguage) {
  if (!file) return;
  const words=(await file.text()).split(/\r?\n|,/).map(word=>wordLibrary.normalizeWord(word,language)).filter(Boolean);
  let imported=0;
  for (const word of words) if (await T(word, language)) imported++;
  if (activeLanguage === language && !languageLoading) K(s||"—",r,`Imported ${imported} new word(s)`);
}

async function L() {
  w.delay=e.autoGuessDelayMs; w.maxGuesses=e.maxAutoGuesses;
  const current=structuredClone(w);
  // Merge only this tab's changes; an older tab must not resave stale window preferences.
  settingsSaveQueue=settingsSaveQueue.then(async()=>{
    const changes=Object.fromEntries(Object.entries(current).filter(([key,value])=>
      JSON.stringify(value)!==JSON.stringify(lastLocalSettings[key])));
    if (!Object.keys(changes).length) return;
    const stored=await chrome.storage.local.get(n), latest=stored[n];
    const saved=latest&&typeof latest==="object"&&!Array.isArray(latest)?latest:{};
    await chrome.storage.local.set({[n]:{...saved,...changes}});
    lastLocalSettings=current;
  }).catch(error=>{
    console.warn("[Skribbl] Settings could not be saved; refresh the page after updating the extension.",error);
  });
  await settingsSaveQueue;
}async function A(language=activeLanguage, stats=y) {
  if (languageLoading && stats===y) return;
  try { await chrome.storage.local.set({[statsKey(language)]:{...stats,wordSuccess:{...stats.wordSuccess}}}); }
  catch(error) { console.warn("[Skribbl] Statistics could not be saved; refresh the page after updating the extension.",error); }
  if (activeLanguage===language) W();
}function I(){y.rounds=0,y.correct=0,y.guesses=0}function z(){const e=(document.body?.innerText||"").match(/\bRound\s+(\d+)\s+of\s+(\d+)\b/i);if(!e)return;const n=Number(e[1]),t=Number(e[2]);if(!Number.isFinite(n)||!Number.isFinite(t))return;if(null===E)return E=n,S=t,I(),y.rounds=n,void A();const o=1===n&&1!==E;o&&I(),(o||n!==E)&&(y.rounds=n,A()),E=n,S=t}function B(){E=null,S=null,v=!1,u="",I(),A();const e=document.getElementById("ssdg-status");e&&(e.textContent="",e.style.display="none",e.className="ssdg-status")}function M(){x=new Set(o.map(e=>e.toLowerCase())),m.forEach(e=>x.add(e.toLowerCase()))}async function G(language=activeLanguage, extra=m) {
  try { await chrome.storage.local.set({[extrasKey(language)]:Array.from(extra).sort()}); }
  catch(error) { console.warn("[Skribbl] Could not save learned words:",error); }
}
async function T(value, language=activeLanguage) {
  const word=wordLibrary.normalizeWord(value,language), library=languageLibraries.get(language);
  if (!library || !wordLibrary.isLearnableWord(word,language) || library.wordSet.has(word)) return false;
  library.extra.add(word); library.words.push(word); library.wordSet.add(word);
  library.stats.learned=library.extra.size;
  if (activeLanguage===language && !languageLoading) { x.add(word); f.add(word); P(); }
  await Promise.all([A(language,library.stats),G(language,library.extra)]);
  return true;
}function D(){const e=Array.from(m).sort();if(0===e.length)return void K(s||"—",r,"No learned words yet");const n=new Blob([e.join("\n")+"\n"],{type:"text/plain;charset=utf-8"}),t=URL.createObjectURL(n),o=document.createElement("a");o.href=t,o.download="skribbl-learned-words-"+activeLanguage+".txt",o.style.display="none",document.body.appendChild(o),o.click(),setTimeout(()=>{URL.revokeObjectURL(t),o.remove()},1e3),K(s||"—",r,`Exported ${e.length} learned word(s)`)}async function q() {
  if (languageLoading || !m.size || !window.confirm("Remove all locally learned words for this language? This cannot be undone.")) return;
  const language=activeLanguage, library=languageLibraries.get(language), removed=new Set(m);
  library.words=library.words.filter(word=>!removed.has(word));
  library.extra.clear(); library.wordSet=new Set(library.words); library.stats.learned=0;
  o=library.words; removed.forEach(word=>f.delete(word)); M();
  await Promise.all([G(language,library.extra),A(language,library.stats)]);
  if (activeLanguage===language && !languageLoading) { r=R(s); P(); K(s||"—",r,"Learned words reset"); }
}function R(hint) {
  return !languageLoading && hint ? o.filter(word=>!c.has(word)&&wordLibrary.matchHint(word,hint,activeLanguage)) : [];
}function F(e){return[...e].sort((e,n)=>{const t=(y.wordSuccess[n.toLowerCase()]||0)-(y.wordSuccess[e.toLowerCase()]||0);if(t)return t;const o=f.has(e.toLowerCase());return o!==f.has(n.toLowerCase())?o?-1:1:e.length!==n.length?e.length-n.length:e.localeCompare(n,activeLanguage)})}function $(){return document.querySelector(".chat-content")||document.querySelector("#game-chat .chat-content")||document.querySelector("#boxMessages")||document.querySelector('[class*="chat"] [class*="content"]')}function O(e){if(languageLoading||languageLoadMessage)return!1;const n=function(){const e=document.querySelector("#game-chat .chat-form")||document.querySelector("#game-chat form")||document.querySelector("#formChat")||document.querySelector(".chat-form");if(e){const n=e.querySelector('input[type="text"]')||e.querySelector("input");if(n)return n}return document.querySelector("#inputChat")||document.querySelector('input[placeholder*="guess" i]')||document.querySelector('input[placeholder*="Type" i]')}();if(!n||n.disabled||document.hidden||!navigator.onLine)return k++,k>=3&&(C=Date.now()+15e3),!1;n.focus();const t=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value")?.set;t?t.call(n,e):n.value=e,n.dispatchEvent(new Event("input",{bubbles:!0})),n.dispatchEvent(new Event("change",{bubbles:!0}));const o=n.closest("form")||document.querySelector("#game-chat .chat-form")||document.querySelector("#formChat");if(o){const e=o.querySelector('button[type="submit"]')||o.querySelector("button");e?e.click():o.dispatchEvent(new Event("submit",{bubbles:!0,cancelable:!0}))}return n.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:!0,cancelable:!0})),n.dispatchEvent(new KeyboardEvent("keyup",{key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:!0,cancelable:!0})),c.add(e.toLowerCase()),b=e,k=0,y.guesses++,A(),!0}let _=0;const j=new WeakSet,U=new Set;function Y(){const chat=$();if(!chat)return;Array.from(chat.children||[]).forEach(node=>j.add(node));if(!chat.children.length)_=(chat.innerText||chat.textContent||" ").length;}function V(){if(document.getElementById(e.panelId))return;panelWindow?.destroy();g=document.createElement("div"),g.id=e.panelId,g.setAttribute("role","region"),g.setAttribute("aria-label","Skribbl Smart Drawer/Guesser tools"),g.setAttribute("data-darkreader-ignore",""),g.setAttribute("data-darkreader-skip",""),g.innerHTML=`\n      <div class="ssdg-header">\n        <span class="ssdg-title"><span class="ssdg-brand-mark" aria-hidden="true"><img class="ssdg-quill-icon" src="${chrome.runtime.getURL("icon48.png")}" width="39" height="39" alt=""></span><span><span class="ssdg-title-text"><span aria-hidden="true" class="ssdg-wordmark"><b>S</b><b>k</b><b>r</b><b>i</b><b>b</b><b>b</b><b>l</b></span><span class="ssdg-sr-only">Skribbl Smart Drawer/Guesser</span></span><span class="ssdg-wordmark-subtitle" aria-hidden="true">Smart Drawer/Guesser</span></span></span>\n        <div class="ssdg-controls">\n          <button id="ssdg-hide-btn" type="button" title="Hide menu; restore with Show menu in the extension popup" aria-label="Hide menu"></button>\n          <button id="ssdg-collapse-btn" title="Collapse" aria-label="Collapse panel">−</button>\n        </div>\n      </div>\n      <div class="ssdg-body">\n        <div class="ssdg-status" id="ssdg-status" role="status" aria-live="polite"></div>\n        <div class="ssdg-language-row">\n          <label for="ssdg-language">Word language</label>\n          <select id="ssdg-language" aria-label="Word language"></select>\n        </div>\n        <a id="ssdg-word-source" class="ssdg-word-source" href="https://github.com/wlauyeung/Skribblio-Word-Bank/blob/37285660a4cebd98b5924571dcf6172e1c1fa0cf/words_es_v1.0.0_raw.json" target="_blank" rel="noopener noreferrer" hidden></a>\n        <div class="ssdg-toolbar">\n          <div class="ssdg-stat-pill">Remaining: <strong id="ssdg-match-count">0</strong></div>\n          <button id="ssdg-auto-btn" class="ssdg-glass-btn" title="Toggle Auto Guess"><span class="ssdg-auto-label">Auto: OFF</span></button>\n          <button id="ssdg-export-btn" class="ssdg-glass-btn" title="Download learned words as .txt">Export</button>\n        </div>\n        <div class="ssdg-hint-card">\n          <div class="ssdg-hint">THE WORD IS <span id="ssdg-hint-text">—</span></div>\n          <div class="ssdg-count">Pick a suggestion below to guess</div>\n        </div>\n        <div class="ssdg-input-wrap">\n          <input id="ssdg-search" class="ssdg-search" type="search" aria-label="Filter word suggestions" placeholder="Filter suggestions… (Alt+F)" autocomplete="off">\n          <button id="ssdg-search-clear" class="ssdg-input-clear" type="button" aria-label="Clear filter" title="Clear filter" hidden>×</button>\n        </div>\n        <div class="ssdg-list-wrap">\n          <div id="ssdg-list" class="ssdg-list" aria-label="Word suggestions"></div><div class="ssdg-empty"><span class="ssdg-empty-doodle" aria-hidden="true">?</span><strong>A little mystery awaits...</strong><span>Suggestions appear when a word hint is available.<br>Nothing here? Try clearing your filter.</span></div>\n          <button id="ssdg-scroll-top" class="ssdg-scroll-top" type="button" title="Back to first word" aria-label="Scroll to first word">↑</button>\n        </div>\n        <div class="ssdg-footer">\n          <div class="ssdg-section-heading">Guessing preferences</div>\n          <div class="ssdg-footer-row">\n            <label for="ssdg-min-hints">Minimum hints:</label>\n            <select id="ssdg-min-hints" title="Auto and Force wait for this many revealed letters or digits; manual guesses remain available">${Array.from({length:maxHintThreshold+1},(_,count)=>`<option value="${count}"${count===w.minHints?" selected":""}>${count} ${count===1?"hint":"hints"}</option>`).join("")}</select>\n          </div>\n          <div class="ssdg-footer-row">\n            <label for="ssdg-delay">Delay (ms):</label>\n            <input type="number" id="ssdg-delay" value="${e.autoGuessDelayMs}" min="400" max="5000" step="100">\n          </div>\n          <div class="ssdg-footer-row">\n            <label for="ssdg-max-guesses">Max guesses/round:</label>\n            <input type="number" id="ssdg-max-guesses" value="${e.maxAutoGuesses}" min="1" max="50" step="1">\n          </div>\n          <div class="ssdg-footer-row">\n            <span>Force smart shuffle:</span>\n            <button id="ssdg-force-btn" class="ssdg-force-btn" type="button" title="Guess randomly before letters appear, then smart-shuffle revealed hints, with no limit">Force: OFF</button>\n          </div>\n          <div class="ssdg-stats-row">\n            <span>Rounds: <strong id="ssdg-rounds">0</strong></span>\n            <span>Correct: <strong id="ssdg-correct">0</strong></span>\n            <span>Guesses: <strong id="ssdg-guesses">0</strong></span>\n          </div>\n          <div class="ssdg-section-heading">Word library</div>\n          <div class="ssdg-data-row">\n            <button id="ssdg-import-btn" class="ssdg-data-btn" type="button">Import words</button>\n            <button id="ssdg-reset-btn" class="ssdg-data-btn" type="button">Reset learned</button>\n            <input id="ssdg-import-file" type="file" accept=".txt,text/plain" hidden>\n          </div>\n          <div class="ssdg-footer-row">\n            <label for="ssdg-restore-position">Restore hotspot:</label>\n            <select id="ssdg-restore-position" title="Optional 18 px corner button, invisible until hovered or focused">\n              <option value="off">Off (use toolbar)</option>\n              <option value="top-right">Top right corner</option>\n              <option value="top-left">Top left corner</option>\n              <option value="bottom-right">Bottom right corner</option>\n              <option value="bottom-left">Bottom left corner</option>\n            </select>\n          </div>\n          <div class="ssdg-shortcuts"><kbd>Alt A</kbd> auto <kbd>Alt 1</kbd> first guess <kbd>Alt F</kbd> search</div>\n          <div class="ssdg-footer-row">\n            <span id="ssdg-learned-count">Learned: 0</span>\n            <button id="ssdg-sync-btn" class="ssdg-sync-btn" type="button" title="Send learned words to the shared cloud list">Sync words</button>\n          </div>\n          <a class="ssdg-privacy-link" href="https://skribbl-word-sync.lakshithadil30.workers.dev/privacy" target="_blank" rel="noopener noreferrer">What cloud sync sends · Privacy</a>\n\n        </div>\n      </div>\n    `,document.body.appendChild(g),g.classList.toggle("collapsed",Boolean(w.collapsed));const n=()=>{const e=document.getElementById("ssdg-collapse-btn");e.textContent="",e.setAttribute("aria-expanded",String(!w.collapsed)),e.setAttribute("aria-label",w.collapsed?"Expand panel":"Minimize panel"),e.title=w.collapsed?"Expand":"Minimize"};n();const t=g.querySelector(".ssdg-body"),o=window.matchMedia("(prefers-reduced-motion: reduce)");let i=null;const l=()=>{i&&(i.cancel(),i=null),g.classList.toggle("collapsed",Boolean(w.collapsed)),t.inert=Boolean(w.collapsed)};t.inert=Boolean(w.collapsed),o.addEventListener("change",()=>{o.matches&&l()}),panelWindow=globalThis.SG_PANEL_WINDOW.create(g,{settings:w,save:L}),resolvePanelReady(),document.getElementById("ssdg-language").addEventListener("change",event=>selectLanguage(event.target.value)),updateLanguageControls(),document.getElementById("ssdg-auto-btn").addEventListener("click",Z),document.getElementById("ssdg-force-btn").addEventListener("click",J),document.getElementById("ssdg-collapse-btn").addEventListener("click",()=>{const e=t.getBoundingClientRect().height,s=g.classList.contains("collapsed")?0:Number(getComputedStyle(t).opacity);if(i&&(i.cancel(),i=null),w.collapsed=!w.collapsed,L(),n(),t.inert=Boolean(w.collapsed),o.matches||!t.animate)return void l();g.classList.remove("collapsed");const r=t.getBoundingClientRect().height,a=t.animate([{height:e+"px",opacity:s,overflow:"hidden",paddingTop:e?"10px":"0px",paddingBottom:e?"10px":"0px"},{height:(w.collapsed?0:r)+"px",opacity:w.collapsed?0:1,overflow:"hidden",paddingTop:w.collapsed?"0px":"10px",paddingBottom:w.collapsed?"0px":"10px"}],{duration:180,easing:"cubic-bezier(.2,.7,.2,1)",fill:"both"});i=a,a.onfinish=()=>{i===a&&l()}});const d=document.getElementById("ssdg-delay"),c=()=>{d.classList.toggle("ssdg-delay-warning",(parseInt(d.value,10)||0)<1e3)};c(),d.addEventListener("input",c),d.addEventListener("change",n=>{e.autoGuessDelayMs=Math.max(400,parseInt(n.target.value)||1e3),n.target.value=e.autoGuessDelayMs,c(),L(),a&&ee()}),document.getElementById("ssdg-min-hints").addEventListener("change",event=>{w.minHints=normalizeHintThreshold(event.target.value);event.target.value=String(w.minHints);L();if(a)Q();K(s||"?",r,"")}),document.getElementById("ssdg-max-guesses").addEventListener("change",n=>{e.maxAutoGuesses=Math.max(1,parseInt(n.target.value)||15),n.target.value=e.maxAutoGuesses,L()}),document.getElementById("ssdg-export-btn").addEventListener("click",D),document.getElementById("ssdg-sync-btn").addEventListener("click",H),document.getElementById("ssdg-import-btn").addEventListener("click",()=>document.getElementById("ssdg-import-file").click()),document.getElementById("ssdg-import-file").addEventListener("change",e=>{importLearnedWords(e.target.files[0],activeLanguage).catch(error=>{console.warn("[Skribbl] Import failed:",error)});e.target.value=""}),document.getElementById("ssdg-reset-btn").addEventListener("click",q);const u=document.getElementById("ssdg-search"),p=document.getElementById("ssdg-search-clear"),b=()=>{p.hidden=!u.value};u.addEventListener("input",e=>{h=wordLibrary.normalizeWord(e.target.value,activeLanguage),b(),K(s||"—",r,"")}),p.addEventListener("click",()=>{u.value="",h="",b(),u.focus(),K(s||"—",r,"")});const f=document.getElementById("ssdg-list"),m=document.getElementById("ssdg-scroll-top");f.addEventListener("scroll",()=>{m.classList.toggle("visible",f.scrollTop>40)},{passive:!0}),m.addEventListener("click",()=>{f.scrollTo({top:0,behavior:"auto"}),m.classList.remove("visible")}),P(),W()}function W(){const e={"ssdg-rounds":y.rounds,"ssdg-correct":y.correct,"ssdg-guesses":y.guesses};Object.entries(e).forEach(([e,n])=>{const t=document.getElementById(e);t&&(t.textContent=n)})}function P() {
  const learned=document.getElementById("ssdg-learned-count");
  if (learned) learned.textContent=`Learned: ${m.size}`;
  const sync=document.getElementById("ssdg-sync-btn");
  if (sync) { sync.disabled=activeLanguage!=="en"||languageLoading||!m.size;
    sync.title=activeLanguage==="en"?"Send English learned words to the shared cloud list":"Cloud sync supports English only; words for this language stay on this device"; }
  for (const id of ["ssdg-import-btn","ssdg-reset-btn","ssdg-export-btn"]) {
    const control=document.getElementById(id); if(control) control.disabled=languageLoading||Boolean(languageLoadMessage);
  }
}async function H(){if(activeLanguage!=="en"||languageLoading)return;const language=activeLanguage,generation=languageGeneration,words=Array.from(m);const e=document.getElementById("ssdg-sync-btn");if(e&&0!==m.size){if(!(await chrome.storage.local.get("cloudSyncConsent")).cloudSyncConsent){if(!window.confirm("Sync learned words to the shared list?\n\nThis sends only your learned words and extension version to the developer’s Cloudflare storage. It does not send usernames, chat messages, drawings, browsing history, or a device identifier. Submitted words may be reviewed and added to future word lists.\n\nSelect OK to agree and sync."))return;await chrome.storage.local.set({cloudSyncConsent:!0})}if(generation!==languageGeneration||languageLoading)return;e.disabled=!0,e.textContent="Syncing…";try{const n=await chrome.runtime.sendMessage({type:"SYNC_LEARNED_WORDS",words});if(!n?.ok)throw new Error(n?.error||"Sync failed");if(generation!==languageGeneration)return;e.textContent="✓ Synced",K(s||"—",r,`Synced ${n.accepted} learned word(s)`),setTimeout(()=>{if(generation!==languageGeneration)return;e.textContent="Sync words",P()},1800)}catch(n){if(generation!==languageGeneration)return;e.textContent="Try again",K(s||"—",r,`Cloud sync failed: ${n.message}`),setTimeout(()=>{if(generation!==languageGeneration)return;e.textContent="Sync words",P()},2500)}}}function K(e,n,t){g||V();t=t||languageLoadMessage;if(!t&&a&&e&&e.includes("_")){const count=wordLibrary.countRevealedHints(e,activeLanguage);if(count<w.minHints)t=`Auto waiting for hints: ${count}/${w.minHints}`;}const o=document.getElementById("ssdg-hint-text"),s=document.getElementById("ssdg-match-count"),r=document.getElementById("ssdg-list"),l=document.getElementById("ssdg-status");o&&(o.textContent=e&&e.includes("_")?e:"—");const d=h?n.filter(e=>e.toLowerCase().includes(h)):n;s&&(s.textContent=d.length,s.title=h?`${n.length} total matches`:"");const c=document.querySelector("#ssdg-auto-btn .ssdg-auto-label");if(a&&c&&(c.textContent=i?"Auto: FORCE":"Auto: ON",c.parentElement.title=i?"Force Auto Guess is active":"Auto Guess is ranking candidates and guessing immediately"),l&&(t?(l.textContent=t,l.style.display="block",l.className="ssdg-status "+(/^(?:✅\s*)?correct\b/i.test(t)?"success":"")):(l.textContent="",l.style.display="none",l.className="ssdg-status")),!r)return;r.classList.toggle("ssdg-final-candidates",d.length>0&&d.length<=25);const u=new Set(Array.from(r.children,e=>e.textContent));r.innerHTML="",F(d).forEach(e=>{const n=document.createElement("button");n.className=u.has(e)?"ssdg-word":"ssdg-word ssdg-word-new";const t=document.createElement("span");t.className="ssdg-word-label",t.textContent=e,n.appendChild(t),n.title="Click to send this guess",n.addEventListener("click",t=>{t.preventDefault(),t.stopPropagation(),O(e),n.disabled=!0,n.style.opacity="0.35",setTimeout(te,250)}),r.appendChild(n)})}function Z(){a=!a,a||(i=!1);const e=document.getElementById("ssdg-auto-btn");if(e){const n=e.querySelector(".ssdg-auto-label");n&&(n.textContent=a?"Auto: ON":"Auto: OFF"),e.classList.toggle("active",a)}a?(d=0,ee()):ne(),X(),K(s||"?",r,"")}function X(){const e=document.getElementById("ssdg-force-btn");e&&(e.textContent=i?"Force: ON":"Force: OFF",e.classList.toggle("active",i))}function J(){if(i=!i,i){a=!0,d=0;const e=document.getElementById("ssdg-auto-btn");e&&e.classList.add("active"),ee()}X(),K(s||"—",r,"")}function Q(){if(languageLoading||languageLoadMessage||!a)return;const hint=currentGameHint();if(hint!==s){te();return;}if(!hint||0===r.length||wordLibrary.countRevealedHints(hint,activeLanguage)<w.minHints)return;if(document.hidden||!navigator.onLine||Date.now()<C)return;if("guessed"===u)return;if(!i&&d>=e.maxAutoGuesses&&r.length>25)return;const n=wordLibrary.hasRevealedLetter(s)?i?function(e){const n=F(e);if(n.length<2)return n[0];const t=n[0],o=t.toLowerCase(),s=y.wordSuccess[o]||0,r=f.has(o),a=t.length,i=n.filter(e=>{const n=e.toLowerCase();return(y.wordSuccess[n]||0)===s&&f.has(n)===r&&e.length===a});return i[Math.floor(Math.random()*i.length)]}(r):F(r)[0]:r[Math.floor(Math.random()*r.length)];n&&O(n)&&(d++,r=r.filter(e=>e.toLowerCase()!==n.toLowerCase()),K(s,r,""))}function ee(){ne(),Q(),l=setInterval(Q,e.autoGuessDelayMs)}function ne(){l&&(clearInterval(l),l=null)}function te() {
  if (languageLoading || languageLoadMessage) return;
  const generation=languageGeneration;
  z();
  (() => {
    const chat=$();
    if (!chat) return;
    const nodes=Array.from(chat.children||[]);
    let text="";
    if (nodes.length) {
      const added=nodes.filter(node=>!j.has(node));
      added.forEach(node=>j.add(node));
      text=added.map(node=>node.innerText||node.textContent||"").join("\n");
    } else {
      const all=chat.innerText||chat.textContent||"";
      if (all.length<_) _=0;
      text=all.slice(_); _=all.length;
    }
    text=text.normalize("NFC");
    if (!text.trim()) return;
    const player=document.querySelector("#game-players .me, .players-list .me, .player.me");
    const nameNode=player?.querySelector('.name, .player-name, [class*="name"]');
    const myName=(nameNode?.textContent||player?.textContent||"")
      .replace(/\s*\((?:You|T\u00fa)\)\s*/iu,"").trim().split(/\r?\n/).map(name=>name.trim()).find(Boolean)||"";
    const correctNames=[...text.matchAll(/(?:^|\n)\s*([^\n]+?)\s+(?:guessed the word|(?:ha )?adivin\u00f3 la palabra)!/gimu)]
      .map(match=>wordLibrary.normalizeWord(match[1],activeLanguage));
    const correct=/\byou\b[^!\n]{0,30}guess|\bhas\s+adivinado\s+la\s+palabra/iu.test(text) ||
      myName && correctNames.includes(wordLibrary.normalizeWord(myName,activeLanguage));
    if (correct && u!=="guessed") {
      u="guessed";
      if (!v) { v=true; y.correct++; A(); }
      const word=b;
      if (word) {
        p=word; f.add(word);
        y.wordSuccess[word]=(y.wordSuccess[word]||0)+1; A();
        T(word).then(learned=>{
          if (generation===languageGeneration && !languageLoading)
            K("\u2014",[],learned?`\u2705 Correct & learned: ${word}`:`\u2705 Correct! You guessed it: ${word}`);
        });
      } else K("\u2014",[],"\u2705 Correct! You guessed it");
      return;
    }
    const reveal=[...text.matchAll(/(?:(?:the[ \t]+)?word[ \t]+was|(?:la[ \t]+)?palabra[ \t]+era)[ \t]*:?[ \t]*["'\u201c\u2018]?([\p{L}\p{N}](?:[\p{L}\p{M}\p{N} .&'\u2019/\-]{0,38}[\p{L}\p{M}\p{N}])?)["'\u201d\u2019]?[.!]?[ \t]*(?=\r?\n|$)/gimu)].at(-1);
    if (reveal) {
      const word=wordLibrary.normalizeWord(reveal[1],activeLanguage); p=word;
      if (!v) { v=true; A(); }
      if (!U.has(word)) {
        U.add(word);
        T(word).then(learned=>{
          if (learned && generation===languageGeneration && !languageLoading)
            K(s||"\u2014",r,`Learned new word: ${word}`);
        });
      }
    }
  })();
  const hint=currentGameHint();
  if (!hint) {
    if (s) { s=""; r=[]; c.clear(); }
    K("\u2014",[],u==="guessed"&&p?`\u2705 Correct! You guessed it: ${p}`:"");
    return;
  }
  if (hint!==s) {
    const refined=wordLibrary.isHintRefinement(s,hint,activeLanguage);
    s=hint; u="guessing"; p="";
    if (!refined) { c.clear(); d=0; v=false; y.guesses=0; A(); }
    r=R(hint); K(hint,r,"");
    if (a) Q();
  } else {
    const next=R(hint);
    if (next.length!==r.length) { r=next; K(hint,r,""); }
  }
}
async function oe(){
  try {
    const stored=await chrome.storage.local.get(n);
    const saved=stored[n];
    lastLocalSettings=saved&&typeof saved==="object"&&!Array.isArray(saved)?structuredClone(saved):{};
    w={...w,...lastLocalSettings};
    w.minHints=normalizeHintThreshold(w.minHints);
    if(!w.defaultsV161){if(Number(w.delay)===1500)w.delay=1000;if(Number(w.maxGuesses)===10)w.maxGuesses=15;w.defaultsV161=true;}
    e.autoGuessDelayMs=Math.min(5000,Math.max(400,Number(w.delay)||e.autoGuessDelayMs));
    e.maxAutoGuesses=Math.min(50,Math.max(1,Number(w.maxGuesses)||e.maxAutoGuesses));
  } catch(error) { console.warn("[Skribbl] Could not load settings:",error); }
  globalThis.SG_PANEL_WINDOW.normalizeSettings(w);
  await selectLanguage(w.language);
  y.learned=m.size,V(),Y(),document.addEventListener("keydown",e=>{if(g?.hidden||e.defaultPrevented||e.isComposing||!g?.contains(e.target)||!e.altKey||e.ctrlKey||e.metaKey)return;const n=e.key.toLowerCase();if("a"===n)e.preventDefault(),e.stopPropagation(),Z();else if("1"===n){const n=F(r)[0];n&&(e.preventDefault(),e.stopPropagation(),O(n),setTimeout(te,250))}else if("f"===n){e.preventDefault();e.stopPropagation();const n=document.getElementById("ssdg-search");n&&n.focus()}},true),window.addEventListener("offline",()=>K(s||"—",r,"Auto paused: browser is offline")),window.addEventListener("online",()=>K(s||"—",r,"Connection restored")),window.addEventListener("pagehide",B),window.addEventListener("pageshow",()=>{B(),Y(),setTimeout(()=>{Y(),z(),te()},0)}),new MutationObserver(n=>{n.some(n=>(n.target.nodeType===1?n.target:n.target.parentElement)?.closest("#game, #game-word, #game-chat, #game-players, #game-round, #boxWord, #boxMessages, .word-container, .chat-content, .players-list"))&&(clearTimeout(refreshTimer),refreshTimer=setTimeout(te,80))}).observe(document.body,{childList:!0,subtree:!0,characterData:!0,attributes:!0}),setInterval(te,500),console.log("[Skribbl Auto Guess And Draw] Ready")}"loading"===document.readyState?document.addEventListener("DOMContentLoaded",oe):oe()})();
