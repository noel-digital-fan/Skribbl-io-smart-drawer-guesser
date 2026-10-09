"use strict";

// Dependency-free word-library checks and real Chromium tests of guessing,
// language persistence, Unicode hints, minimum hints and asynchronous language changes.
// Run: node scripts/test-guess-languages.cjs (Node 22+, Chrome/Edge or BROWSER).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const ROOT = path.resolve(__dirname, "..");
const EN = ["cat", "dog", "cafe", "tree", "test", "catfish"];
const ES = ["año", "avión", "pingüino", "árbol", "café", "niño", "uña", "perro", "gato", "don quijote", "pato"];
const FIXTURES = {
  en: EN, es: ES,
  de: ["äpfel", "straße", "fuß", "häuser", "mädchen", "pferd"],
  fr: ["été", "chat", "chien", "forêt", "garçon", "café"],
  ko: ["고양이", "강아지", "나무", "커피"],
  pl: ["żółw", "gęś", "łódź", "żaba", "ptak"],
  ru: ["кот", "кошка", "ёлка", "дерево"],
  ja: ["ねこ", "いぬ", "さくら", "コーヒー"],
  tr: ["İNEK", "ıslak", "ÇİLEK", "ağaç"],
};
const IMPORT_FIXTURES = { de: "ölkanne", fr: "éclair", ko: "토끼", pl: "źrebak", ru: "собака", ja: "らくだ", tr: "ışık" };
let CATALOG;

function readCatalog() {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "word-catalog.js"), "utf8"), sandbox);
  const catalog = sandbox.SG_WORD_CATALOG;
  assert.ok(Array.isArray(catalog) && catalog.length >= 2, "Language catalogue is missing");
  assert.equal(new Set(catalog.map(entry => entry.code)).size, catalog.length, "Duplicate language codes");
  for (const entry of catalog) {
    assert.equal(typeof entry.code, "string"); assert.ok(entry.label);
    assert.ok(/^[\w.-]+\.txt$/.test(entry.file), `Unsafe word-list filename: ${entry.file}`);
    assert.ok(fs.existsSync(path.join(ROOT, entry.file)), `Catalogue references a missing file: ${entry.file}`);
  }
  assert.equal(catalog[0].code, "en");
  assert.ok(catalog.some(entry => entry.code === "es"));
  return catalog;
}

function fixtureWords(entry) {
  return FIXTURES[entry.code] || ["fixture " + entry.code, entry.code + "bird"];
}

function normalizeFixture(word, language) {
  try { return word.normalize("NFC").toLocaleLowerCase(language).normalize("NFC"); }
  catch { return word.normalize("NFC").toLowerCase().normalize("NFC"); }
}

function moduleTests() {
  const sandbox = { SG_WORD_CATALOG: CATALOG };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "word-library.js"), "utf8"), sandbox);
  const library = sandbox.SG_WORD_LIBRARY;
  assert.ok(library, "Word library was not exported");
  assert.equal(library.normalizeWord("  A\u0301RBOL  DE   NAVIDAD "), "árbol de navidad");
  for (const word of ES) assert.equal(library.isLearnableWord(word), true, `Rejected Spanish word: ${word}`);
  for (const value of ["", "a", "<script>", "hello!", "x".repeat(41)]) assert.equal(library.isLearnableWord(value), false);
  for (const [word, hint] of [["año", "_ñ_"], ["avión", "a_ió_"], ["pingüino", "____ü___"], ["árbol", "a\u0301____"], ["don quijote", "___ _______"]]) {
    assert.equal(library.matchHint(word, hint), true, `Unicode hint did not match ${word}`);
  }
  assert.equal(library.matchHint("café", "caf_"), true);
  assert.equal(library.matchHint("café", "ca_e"), false, "Matching erased an accent");
  assert.equal(library.matchHint("ano", "_ñ_"), false, "Matching confused n with ñ");
  assert.equal(library.matchHint("don quijote", "__________"), false, "A blank crossed a word separator");
  assert.equal(library.hasRevealedLetter("__ñ_"), true);
  assert.equal(library.hasRevealedLetter("á___"), true);
  assert.equal(library.hasRevealedLetter("___ ____"), false);
  for (const [hint, count] of [["___ ____", 0], ["a___", 1], ["a_ñ_", 2], ["a_ñó_", 3],
    ["a\u0301_n\u0303o\u0301_", 3], ["___ 3 7 .&-' /", 0], ["고_양_", 2], ["𐐀__", 1], [null, 0]]) {
    assert.equal(library.countRevealedLetters(hint), count, `Wrong revealed letter count: ${hint}`);
  }
  assert.equal(library.hasRevealedLetter("_1_"), false, "Digits unlocked letter-dependent auto guessing");
  assert.equal(library.countRevealedHints("_2_2"), 2, "Actual numeric word slots did not count as hints");
  assert.equal(library.countRevealedHints("_-___ / .&'"), 0, "Punctuation counted as hints");
  for (const [word, hint] of [["straße", "stra_e"], ["forêt", "for_t"], ["고양이", "고__"], ["żółw", "ż___"], ["gęś", "g_ś"], ["ёлка", "ё___"], ["さくら", "さ__"]]) {
    assert.equal(library.matchHint(word, hint), true, `Unicode script hint rejected ${word}`);
    assert.equal(library.isLearnableWord(word), true, `Unicode script learning rejected ${word}`);
  }
  if (CATALOG.some(entry => entry.code === "tr")) {
    assert.equal(library.normalizeWord("İNEK", "tr"), "inek", "Turkish uppercase dotted I was not normalized for Turkish");
    assert.equal(library.normalizeWord("ISLAK", "tr"), "ıslak", "Turkish uppercase I was normalized to the wrong letter");
  }
  assert.equal(library.isHintRefinement("____", "__ñ_"), true);
  assert.equal(library.isHintRefinement("café_", "cafe_"), false);
  assert.equal(library.parseHint({ querySelectorAll: () => [], textContent: "a\u0301____" }), "á____");
  assert.equal(library.parseHint({ querySelectorAll: () => [
    { className: "letter", textContent: "a\u0301" }, { className: "dash", textContent: "" },
    { className: "space", textContent: "" }, { className: "letter", textContent: "ñ" },
    { className: "dash", textContent: "_" },
  ] }), "á_ ñ_");
  const maskedMultiword = library.parseHint({ querySelectorAll: () => Array.from({ length: 11 }, () => ({ className: "hint", textContent: "_" })), querySelector: () => ({ textContent: "3 7" }) });
  assert.equal(maskedMultiword, "___ _______", "Official word-length metadata did not restore a masked separator");
  assert.equal(library.countRevealedLetters(maskedMultiword), 0, "Word-length metadata counted as a hint");
  assert.equal(library.countRevealedHints(maskedMultiword), 0, "Numeric word-length metadata counted as a hint");
  console.log("PASS word library: Unicode/NFC revealed letter counts, metadata exclusion, accents, spaces and hint refinement");
}

async function connect(endpoint) {
  const socket = new WebSocket(endpoint), pending = new Map();
  let next = 0;
  socket.addEventListener("message", ({ data }) => {
    const result = JSON.parse(data), entry = pending.get(result.id);
    if (!entry) return;
    pending.delete(result.id); clearTimeout(entry.timer);
    result.error ? entry.reject(new Error(result.error.message)) : entry.resolve(result.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 20000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    }),
    close: () => socket.close(),
  };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function launchBrowser() {
  const executable = process.env.BROWSER || [
    "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find(file => fs.existsSync(file));
  assert.ok(executable, "Set BROWSER to an installed Chromium browser");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "skribbl-language-test-"));
  const child = spawn(executable, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling", "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  const endpoint = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`Browser did not expose CDP: ${log.slice(-500)}`)), 20000);
    child.once("error", reject);
    child.stderr.on("data", chunk => {
      log += chunk;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  return { client: await connect(endpoint), child, profile, base: endpoint.replace(/^ws:/, "http:").replace(/\/devtools\/browser\/.*$/, "") };
}

async function mount(client, initial = {}) {
  await evaluate(client, `
    window.__storage=${JSON.stringify(initial)};window.__writes=[];window.__heldWrites=[];window.__messages=[];window.__guesses=[];window.__errors=[];
    window.addEventListener('error',event=>__errors.push(event.message));window.addEventListener('unhandledrejection',event=>__errors.push(String(event.reason)));
    window.confirm=()=>true;
    window.chrome={runtime:{getURL:name=>location.origin+'/'+name,sendMessage:async message=>{__messages.push(structuredClone(message));return{ok:true,accepted:message.words?.length||0}}},storage:{local:{
      get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>key in __storage).map(key=>[key,structuredClone(__storage[key])])),
      set:async data=>{Object.assign(__storage,structuredClone(data));__writes.push(structuredClone(data));if(window.__holdWriteKey&&Object.hasOwn(data,__holdWriteKey))await new Promise(resolve=>__heldWrites.push(resolve))}
    }}};
    window.__waitFor=async(check,label='language panel condition')=>{const began=performance.now();while(!check()){if(performance.now()-began>8000)throw new Error('Timed out: '+label);await new Promise(resolve=>setTimeout(resolve,10))}};
    window.__pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    window.__words=()=>Array.from(document.querySelectorAll('#ssdg-list .ssdg-word-label'),node=>node.textContent);
    window.__change=(selector,value,type='change')=>{const control=document.querySelector(selector);control.value=value;control.dispatchEvent(new Event(type,{bubbles:true}))};
    window.__hint=async hint=>{document.querySelector('#game-word .hints').textContent=hint;await __waitFor(()=>document.querySelector('#ssdg-hint-text')?.textContent===hint.normalize('NFC').toLowerCase(),'hint '+hint)};
    window.__clientHints=async(lengths,reveals,expected)=>{const container=Object.assign(document.createElement('div'),{className:'container'});const size=lengths.reduce((sum,length)=>sum+length,lengths.length-1);for(let index=0;index<size;index++)container.append(Object.assign(document.createElement('div'),{className:'hint',textContent:reveals[index]??'_'}));container.append(Object.assign(document.createElement('div'),{className:'word-length',textContent:lengths.join(' ')}));document.querySelector('#game-word .hints').replaceChildren(container);await __waitFor(()=>document.querySelector('#ssdg-hint-text')?.textContent===expected,'official client hints')};
    window.__chat=text=>document.querySelector('.chat-content').append(Object.assign(document.createElement('p'),{textContent:text}));
    window.__import=(text,hold=false)=>{const file=new File([text],'words.txt',{type:'text/plain'});if(hold)Object.defineProperty(file,'text',{value:()=>new Promise(resolve=>window.__releaseImport=()=>resolve(text))});const transfer=new DataTransfer();transfer.items.add(file);const input=document.querySelector('#ssdg-import-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))};
    const realFetch=window.fetch.bind(window);window.__heldFetches=[];
    window.fetch=async(...args)=>{const spanish=String(args[0]).endsWith('/words-es.txt');if(spanish&&window.__missingSpanishFetch)return new Response('',{status:404});if(spanish&&window.__emptySpanishFetch)return new Response('',{status:200});const response=await realFetch(...args);if(window.__holdSpanishFetch&&spanish){await new Promise(resolve=>__heldFetches.push(resolve))}return response};
    document.querySelector('.chat-form').addEventListener('submit',event=>{event.preventDefault();__guesses.push(document.querySelector('#inputChat').value)});
  `);
  const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8").replace(/^\uFEFF/, "");
  await evaluate(client, `document.head.append(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(css)}}));`);
  for (const file of ["word-catalog.js", "word-library.js", "panel-window.js", "content.js"]) await evaluate(client, fs.readFileSync(path.join(ROOT, file), "utf8"));
  await evaluate(client, "__waitFor(()=>document.querySelector('#ssdg-language')&&document.querySelector('#ssdg-hint-text')?.textContent==='___'&&__words().length>0,'initial word list')");
}

async function browserTests() {
  const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <div id="game-word"><div class="hints">___</div></div>
    <div id="game-players"><div class="player me"><span class="name">Tester (You)</span></div></div>
    <div id="game-chat"><div class="chat-content"></div><form class="chat-form"><input id="inputChat" type="text"><button type="submit">Send</button></form></div>
  </body></html>`;
  const dictionaries = new Map(CATALOG.map(entry => ["/" + entry.file, fixtureWords(entry)]));
  const server = http.createServer((req, res) => {
    const words = dictionaries.get(req.url);
    res.setHeader("Content-Type", words ? "text/plain;charset=utf-8" : "text/html;charset=utf-8");
    res.end(words ? words.join("\n") + "\n" : fixture);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  let browser;
  try {
    browser = await launchBrowser();
    async function page(initial, task) {
      const url = `http://127.0.0.1:${server.address().port}/`;
      const { targetId } = await browser.client.send("Target.createTarget", { url });
      const targets = await (await fetch(`${browser.base}/json/list`)).json();
      const client = await connect(targets.find(target => target.id === targetId).webSocketDebuggerUrl);
      try {
        // about:blank may still be complete while this target's real navigation
        // is pending. Inject only after the local game fixture has loaded.
        for (let tries = 0; !await evaluate(client, `location.href===${JSON.stringify(url)}&&document.readyState==='complete'&&Boolean(document.querySelector('.chat-form'))`); tries++) {
          assert.ok(tries < 800, "Language fixture did not finish navigation");
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        await mount(client, initial);
        await task(client);
        assert.deepEqual(await evaluate(client, "__errors"), [], "Language panel reported a browser error");
      } finally { client.close(); await browser.client.send("Target.closeTarget", { targetId }); }
    }
    async function words(client, hint, expected) {
      await evaluate(client, `__hint(${JSON.stringify(hint)})`);
      await evaluate(client, `__waitFor(()=>JSON.stringify(__words().slice().sort())===${JSON.stringify(JSON.stringify(expected.slice().sort()))},${JSON.stringify("candidates for " + hint)})`);
      assert.deepEqual((await evaluate(client, "__words()")).sort(), expected.slice().sort());
    }
    async function language(client, value, expected) {
      await evaluate(client, `__change('#ssdg-language',${JSON.stringify(value)});__waitFor(()=>__storage.guesserSettingsV160.language===${JSON.stringify(value)},'saved language')`);
      if (expected) await words(client, "___", expected);
    }

    for (const threshold of [0, 1, 2, 3, 4, 5]) await page({ guesserSettingsV160: { minHints: threshold, delay: 5000 } }, async client => {
      const options = await evaluate(client, "Array.from(document.querySelector('#ssdg-min-hints').options,option=>Number(option.value))");
      assert.deepEqual(options, [0, 1, 2, 3, 4, 5], "Selector omitted a native supported hint count");
      assert.equal(await evaluate(client, "Number(document.querySelector('#ssdg-min-hints').value)"), threshold);
      await words(client, "_______", ["catfish"]);
      await evaluate(client, "document.querySelector('#ssdg-auto-btn').click();__pause(150)");
      if (threshold === 0) assert.deepEqual(await evaluate(client, "__guesses"), ["catfish"], "Default threshold delayed the first guess");
      else {
        assert.deepEqual(await evaluate(client, "__guesses"), [], "Auto guessed before any letters appeared");
        for (let count = 1; count <= threshold; count++) {
          const hint = "catfish".slice(0, count) + "_".repeat(7 - count);
          const began = Date.now();
          await evaluate(client, `__hint(${JSON.stringify(hint)})`);
          if (count < threshold) {
            await evaluate(client, "__pause(150)");
            assert.deepEqual(await evaluate(client, "__guesses"), [], `${count} hints unlocked a ${threshold}-hint threshold`);
          } else {
            await evaluate(client, "__waitFor(()=>__guesses.length===1,'threshold guess')");
            assert.deepEqual(await evaluate(client, "__guesses"), ["catfish"]);
            assert.ok(Date.now() - began < 1500, "Reaching the threshold waited for the five-second guess interval");
            assert.equal(await evaluate(client, "document.querySelector('#ssdg-guesses').textContent"), "1", "Refining a hint reset the round counter");
          }
        }
      }
    });
    console.log("PASS minimum hints: all native 0/1/2/3/4/5 thresholds; immediate start on the qualifying refinement");

    let hintSettings;
    await page({}, async client => {
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-min-hints').value"), "0", "Legacy settings did not default to zero hints");
      await evaluate(client, "__change('#ssdg-min-hints','3');__waitFor(()=>__storage.guesserSettingsV160.minHints===3,'saved hint threshold')");
      await language(client, "es", ["año", "uña"]);
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-min-hints').value"), "3", "Language switching reset the hint threshold");
      hintSettings = await evaluate(client, "structuredClone(__storage)");
    });
    await page(hintSettings, async client => {
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-min-hints').value"), "3", "Reload lost the selected threshold");
      assert.equal(await evaluate(client, "__storage.guesserSettingsV160.minHints"), 3);
    });
    console.log("PASS minimum hints persistence: default zero, saved selector, language switching and reload");

    await page({ guesserSettingsV160: { minHints: 3, delay: 400 } }, async client => {
      await words(client, "_______", ["catfish"]);
      await evaluate(client, "document.querySelector('#ssdg-force-btn').click();__hint('ca_____');__pause(650)");
      assert.deepEqual(await evaluate(client, "__guesses"), [], "Force bypassed the hint threshold");
      await evaluate(client, "document.querySelector('#ssdg-list button').click();__waitFor(()=>__guesses.length===1,'manual click below threshold')");
      assert.deepEqual(await evaluate(client, "__guesses"), ["catfish"], "Threshold blocked a manual word click");
      await words(client, "____", ["cafe", "tree", "test"]);
      await evaluate(client, "document.querySelector('#ssdg-search').dispatchEvent(new KeyboardEvent('keydown',{key:'1',altKey:true,bubbles:true}));__waitFor(()=>__guesses.length===2,'manual shortcut below threshold')");
      assert.ok(["cafe", "tree", "test"].includes((await evaluate(client, "__guesses"))[1]), "Threshold blocked Alt+1");
      await evaluate(client, "__pause(650)");
      assert.equal(await evaluate(client, "__guesses.length"), 2, "Round with fewer hints sent automatic guesses");
    });
    for (const hiddenSelector of ["#game-word .hints", "#game-word .hints .container"]) await page({ guesserSettingsV160: { minHints: 3, delay: 400 }, extraWords: ["catfold", "catfins"] }, async client => {
      await words(client, "_______", ["catfish", "catfold", "catfins"]);
      await evaluate(client, "document.querySelector('#ssdg-force-btn').click();__clientHints([7],{0:'c',1:'a',2:'t'},'cat____');__waitFor(()=>__guesses.length===1,'force after threshold')");
      await evaluate(client, `document.querySelector('#game-word .hints').style.cssText='display:block;width:200px;height:30px';document.querySelector(${JSON.stringify(hiddenSelector)}).style.display='none';document.querySelector('#ssdg-force-btn').click();document.querySelector('#ssdg-force-btn').click();__waitFor(()=>document.querySelector('#ssdg-hint-text').textContent==='—','hidden old hint');__pause(200)`);
      if (hiddenSelector.endsWith(".container")) assert.equal(await evaluate(client, "document.querySelector('#game-word .hints').getClientRects().length>0"), true, "Native hidden-container case did not retain its visible wrapper");
      assert.equal(await evaluate(client, "__guesses.length"), 1, "Hidden hints from an ended turn unlocked Force");
      await evaluate(client, "document.querySelector('#game-word .hints').style.display='';__clientHints([4],{},'____')");
      await evaluate(client, "__pause(650)");
      assert.equal(await evaluate(client, "__guesses.length"), 1, "Previous turn hints unlocked a new turn");
      await evaluate(client, "document.querySelector('#game-word .hints').textContent='?';__pause(150)");
      assert.equal(await evaluate(client, "__guesses.length"), 1, "Unknown hints unlocked guessing");
    });
    console.log("PASS minimum hints gating: Force obeys threshold; manual clicks/Alt+1 work; fewer, unknown and old hidden turn hints stay paused");

    await page({ guesserSettingsV160: { language: "es", minHints: 2, delay: 5000 } }, async client => {
      await evaluate(client, "__clientHints([3,7],{3:' '},'___ _______');document.querySelector('#ssdg-auto-btn').click();__pause(150)");
      assert.deepEqual(await evaluate(client, "__guesses"), [], "Separators or numeric metadata unlocked guessing");
      await evaluate(client, "__clientHints([3,7],{0:'d',3:' '},'d__ _______');__pause(150)");
      assert.deepEqual(await evaluate(client, "__guesses"), [], "One revealed letter unlocked a two-hint threshold");
      await evaluate(client, "__clientHints([3,7],{0:'d',3:' ',4:'q'},'d__ q______');__waitFor(()=>__guesses.length===1,'multiword threshold')");
      assert.deepEqual(await evaluate(client, "__guesses"), ["don quijote"]);
      await evaluate(client, "__clientHints([5],{0:'a\\u0301'},'á____');__pause(150)");
      assert.equal(await evaluate(client, "__guesses.length"), 1, "Decomposed accent counted as two hints");
      await evaluate(client, "__clientHints([5],{0:'a\\u0301',1:'r'},'ár___');__waitFor(()=>__guesses.length===2,'Unicode threshold')");
      assert.deepEqual(await evaluate(client, "__guesses"), ["don quijote", "árbol"]);
    });
    await page({ guesserSettingsV160: { minHints: 3, delay: 5000 } }, async client => {
      await words(client, "_______", ["catfish"]);
      await evaluate(client, "document.querySelector('#ssdg-auto-btn').click();__hint('ca_____');__change('#ssdg-min-hints','2');__waitFor(()=>__guesses.length===1,'lowered hint threshold')");
      assert.deepEqual(await evaluate(client, "__guesses"), ["catfish"], "Lowering a satisfied threshold did not start immediately");
    });
    console.log("PASS minimum hints parsing: official multiword metadata, spaces, NFC accents and lowered thresholds");

    await page({ guesserSettingsV160: { minHints: 2, delay: 5000 }, extraWords: ["r-2d2"] }, async client => {
      await evaluate(client, "__clientHints([5],{},'_____');document.querySelector('#ssdg-auto-btn').click();__pause(150)");
      assert.deepEqual(await evaluate(client, "__guesses"), [], "Word-length metadata unlocked a numeric word");
      await evaluate(client, "__clientHints([5],{1:'-'},'_-___');__pause(150)");
      assert.deepEqual(await evaluate(client, "__guesses"), [], "Revealed punctuation unlocked a numeric word");
      await evaluate(client, "__clientHints([5],{1:'-',2:'2'},'_-2__');__pause(150)");
      assert.deepEqual(await evaluate(client, "__guesses"), [], "One actual numeric slot unlocked a two-hint threshold");
      await evaluate(client, "__clientHints([5],{1:'-',2:'2',4:'2'},'_-2_2');__waitFor(()=>__guesses.length===1,'numeric word threshold')");
      assert.deepEqual(await evaluate(client, "__guesses"), ["r-2d2"], "Two revealed digits did not unlock guessing");
    });
    console.log("PASS minimum hints numeric words: actual revealed digits count; punctuation and numeric length metadata remain excluded");

    await page({}, async client => {
      const options = await evaluate(client, "Array.from(document.querySelector('#ssdg-language').options,option=>({code:option.value,label:option.textContent}))");
      assert.deepEqual(options, Array.from(CATALOG, entry => ({ code: entry.code, label: entry.label })), "Selector does not expose the sourced catalogue in order");
      for (const entry of CATALOG.filter(entry => !["en", "es"].includes(entry.code))) {
        await language(client, entry.code);
        const sample = fixtureWords(entry).map(word => normalizeFixture(word, entry.code));
        const length = Array.from(sample[0]).length;
        await words(client, "_".repeat(length), sample.filter(word => Array.from(word).length === length && !/\s/u.test(word)));
        const hint = Array.from(sample[0], (letter, index) => index === 0 || letter === " " ? letter : "_").join("");
        await words(client, hint, sample.filter(word => Array.from(word).length === length && Array.from(hint).every((letter, index) => letter === "_" ? !/\s/u.test(Array.from(word)[index]) : letter === Array.from(word)[index])));
        const imported = IMPORT_FIXTURES[entry.code] || "learned " + entry.code;
        await evaluate(client, `__import(${JSON.stringify(imported)});__waitFor(()=>__storage[${JSON.stringify("extraWords:" + entry.code)}]?.includes(${JSON.stringify(imported)}),'catalogue language import')`);
        assert.equal(await evaluate(client, "document.querySelector('#ssdg-sync-btn').disabled"), true, "Non-English language enabled English cloud sync");
        if (entry.sourceUrl) assert.equal(await evaluate(client, "document.querySelector('#ssdg-word-source').href"), entry.sourceUrl);
      }
      assert.deepEqual(await evaluate(client, "__messages"), []);
    });
    console.log(`PASS sourced catalogue: ${CATALOG.length} selector options; every additional language loads its own list, imports and source link`);

    let persisted;
    await page({ extraWords: ["cow"], guesserStatsV160: { rounds: 4, correct: 2, guesses: 1, learned: 1, wordSuccess: { dog: 7 } } }, async client => {
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-language').value"), "en");
      await words(client, "___", ["cat", "dog", "cow"]);
      assert.equal((await evaluate(client, "__words()"))[0], "dog", "Legacy English ranking was not retained");
      await language(client, "es", ["año", "uña"]);
      assert.deepEqual(await evaluate(client, "__storage.extraWords"), ["cow"], "Selecting Spanish overwrote English extras");
      assert.ok(!await evaluate(client, "(__storage['guesserStatsV160:es']?.wordSuccess||{}).dog"), "English rankings leaked to Spanish");
      persisted = await evaluate(client, "structuredClone(__storage)");
    });
    await page(persisted, async client => {
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-language').value"), "es");
      await words(client, "___", ["año", "uña"]);
      await language(client, "en", ["cat", "dog", "cow"]);
      assert.equal((await evaluate(client, "__words()"))[0], "dog");
    });
    console.log("PASS language selection: saved across reload; legacy English words/rankings retained; candidates isolated");

    await page({ guesserSettingsV160: { language: "es" } }, async client => {
      await words(client, "____", ["café", "niño", "gato", "pato"]);
      await words(client, "_ñ_", ["año", "uña"]);
      await words(client, "a_ió_", ["avión"]);
      await words(client, "____ü___", ["pingüino"]);
      await words(client, "a\u0301____", ["árbol"]);
      await words(client, "___ _______", ["don quijote"]);
      await words(client, "____", ["café", "niño", "gato", "pato"]);
      await evaluate(client, "Array.from(document.querySelectorAll('#ssdg-list button')).find(button=>button.textContent==='pato').click();__waitFor(()=>document.querySelector('#ssdg-guesses').textContent==='1','submitted guess count')");
      assert.equal((await evaluate(client, "__guesses"))[0], "pato");
      await words(client, "__ñ_", ["niño"]);
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-guesses').textContent"), "1", "Revealing ñ reset guesses during the same turn");
    });
    console.log("PASS Spanish guessing: accents, ñ, ü, NFC, spaces and revealed-letter progress");

    await page({ guesserSettingsV160: { language: "es" } }, async client => {
      await evaluate(client, "__clientHints([3,7],{},'___ _______')");
      await evaluate(client, "__waitFor(()=>__words().length===1&&__words()[0]==='don quijote','masked multiword separator')");
      await evaluate(client, "document.querySelector('#ssdg-list button').click();__waitFor(()=>document.querySelector('#ssdg-guesses').textContent==='1','multiword guess')");
      await evaluate(client, "__clientHints([3,7],{0:'d',3:' ',4:'q'},'d__ q______')");
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-guesses').textContent"), "1", "Revealing the official separator reset this turn");
      await evaluate(client, `__clientHints([5],{0:${JSON.stringify("a\u0301")}},'á____');__waitFor(()=>__words().length===1&&__words()[0]==='árbol','NFC individual hint node')`);
      await evaluate(client, "__clientHints([8],{4:'ü'},'____ü___');__waitFor(()=>__words().length===1&&__words()[0]==='pingüino','umlaut individual hint node')");
    });
    console.log("PASS official client markup: masked separators from word-length metadata; live space/letter revelations and Unicode nodes");

    await page({}, async client => {
      await evaluate(client, `__import(${JSON.stringify("otter\nrobins")});__waitFor(()=>__storage.extraWords?.includes('otter'),'English import')`);
      await language(client, "es", ["año", "uña"]);
      await evaluate(client, `__import(${JSON.stringify("cañón\nmelón")});__waitFor(()=>__storage['extraWords:es']?.includes('cañón'),'Spanish import')`);
      assert.deepEqual((await evaluate(client, "__storage.extraWords")).sort(), ["otter", "robins"]);
      assert.deepEqual((await evaluate(client, "__storage['extraWords:es']")).sort(), ["cañón", "melón"]);
      await words(client, "_____", ["avión", "árbol", "perro", "cañón", "melón"]);
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-sync-btn').disabled"), true, "Spanish sync could contaminate the English cloud list");
      await evaluate(client, "document.querySelector('#ssdg-sync-btn').click()");
      assert.deepEqual(await evaluate(client, "__messages"), []);
      await language(client, "en", ["cat", "dog"]);
      await evaluate(client, `__import(${JSON.stringify("toucan\nwalrus")},true);__waitFor(()=>typeof __releaseImport==='function','delayed import')`);
      await language(client, "es", ["año", "uña"]);
      await evaluate(client, "__releaseImport();__waitFor(()=>__storage.extraWords?.includes('walrus'),'import after switch')");
      assert.ok((await evaluate(client, "__storage.extraWords")).includes("toucan"));
      assert.deepEqual((await evaluate(client, "__storage['extraWords:es']")).sort(), ["cañón", "melón"]);
      await words(client, "______", []);
    });
    console.log("PASS imports: separate language buckets, captured language across delayed imports; Spanish cloud sync disabled");

    await page({}, async client => {
      await evaluate(client, `__chat(${JSON.stringify("The word was 'horse'")});__waitFor(()=>__storage.extraWords?.includes('horse'),'official quoted English reveal')`);
      await language(client, "es", ["año", "uña"]);
      await evaluate(client, `__chat(${JSON.stringify("The word was 'cañón'")});__waitFor(()=>__storage['extraWords:es']?.includes('cañón'),'Spanish word in official quoted system reveal')`);
      await evaluate(client, "__chat('La palabra era: melón');__waitFor(()=>__storage['extraWords:es']?.includes('melón'),'Spanish system reveal')");
      assert.deepEqual(await evaluate(client, "__storage.extraWords"), ["horse"]);
      assert.deepEqual((await evaluate(client, "__storage['extraWords:es']")).sort(), ["cañón", "melón"]);
      await words(client, "_____", ["avión", "árbol", "perro", "cañón", "melón"]);
      await language(client, "en", ["cat", "dog"]);
      await words(client, "_____", ["horse"]);
      await evaluate(client, "__chat('The word was: cañón');__waitFor(()=>__storage.extraWords?.includes('cañón'),'same reveal in different language')");
      assert.ok((await evaluate(client, "__storage.extraWords")).includes("cañón"), "Reveal deduplication leaked across languages");
    });
    console.log("PASS chat learning: English/Spanish system reveals target current language; deduplication is isolated");

    await page({ guesserSettingsV160: { language: "es" } }, async client => {
      await evaluate(client, "Array.from(document.querySelectorAll('#ssdg-list button')).find(button=>button.textContent==='año').click();__chat('Tester guessed the word!');__waitFor(()=>__storage['guesserStatsV160:es']?.wordSuccess?.['año']===1,'correct Spanish guess')");
      assert.equal(await evaluate(client, "__storage['guesserStatsV160:es'].correct"), 1);
      assert.ok(!await evaluate(client, "__storage.guesserStatsV160?.wordSuccess?.['año']"), "Spanish success ranking leaked into English");
      await words(client, "____", ["café", "niño", "gato", "pato"]);
      await evaluate(client, "Array.from(document.querySelectorAll('#ssdg-list button')).find(button=>button.textContent==='niño').click();__chat('Tester adivinó la palabra!');__waitFor(()=>__storage['guesserStatsV160:es']?.wordSuccess?.['niño']===1,'localized correct Spanish guess')");
      assert.equal(await evaluate(client, "__storage['guesserStatsV160:es'].correct"), 2);
    });
    await page({ guesserSettingsV160: { language: "es" } }, async client => {
      await evaluate(client, "window.__holdWriteKey='extraWords:es';__chat('The word was: cañón');__waitFor(()=>__heldWrites.length>0,'held learned-word write')");
      await language(client, "en", ["cat", "dog"]);
      await evaluate(client, "window.__holdWriteKey=null;__heldWrites.splice(0).forEach(resolve=>resolve());__pause(200)");
      await words(client, "___", ["cat", "dog"]);
      assert.ok(!await evaluate(client, "document.querySelector('#ssdg-status').textContent.includes('cañón')"), "A delayed Spanish learning callback changed the English status");
      assert.deepEqual(await evaluate(client, "__storage['extraWords:es']"), ["cañón"]);
      assert.ok(!await evaluate(client, "__storage.extraWords?.includes('cañón')"));
    });
    console.log("PASS correct guesses and chat races: language-specific rankings; delayed learning cannot update a switched panel");

    await page({}, async client => {
      await evaluate(client, "document.querySelector('.chat-content').textContent='The word was: horse';__waitFor(()=>__storage.extraWords?.includes('horse'),'text-only English reveal')");
      await language(client, "es", ["año", "uña"]);
      await evaluate(client, "__pause(550)");
      assert.ok(!await evaluate(client, "__storage['extraWords:es']?.includes('horse')"), "Old text-only chat was learned in the new language");
      await evaluate(client, `document.querySelector('.chat-content').textContent+=${JSON.stringify("\nThe word was: ca\u006e\u0303o\u0301n")};__waitFor(()=>__storage['extraWords:es']?.includes('cañón'),'NFC text-only Spanish reveal')`);
      assert.deepEqual(await evaluate(client, "__storage['extraWords:es']"), ["cañón"]);
    });
    console.log("PASS chat history: old text-only messages are skipped after switching; decomposed Spanish reveals normalize to NFC");

    await page({ "guesserStatsV160:es": { rounds: 4, correct: 9, guesses: 12, learned: 0, wordSuccess: { "año": 9 } } }, async client => {
      await words(client, "____", ["cafe", "tree", "test"]);
      await evaluate(client, "__change('#ssdg-delay','400');document.querySelector('#ssdg-auto-btn').click();window.__holdSpanishFetch=true;__change('#ssdg-language','es');__waitFor(()=>__heldFetches.length>0,'held Spanish list')");
      assert.deepEqual(await evaluate(client, "__words()"), [], "English suggestions remained visible while Spanish loaded");
      await evaluate(client, "window.dispatchEvent(new Event('pagehide'))");
      assert.equal(await evaluate(client, "__storage['guesserStatsV160:es'].correct"), 9, "A page lifecycle event overwrote saved Spanish statistics while loading");
      const count = await evaluate(client, "__guesses.length");
      await evaluate(client, "__pause(600)");
      assert.equal(await evaluate(client, "__guesses.length"), count, "Auto guess sent a stale word during loading");
      await evaluate(client, "if(document.querySelector('#ssdg-auto-btn').classList.contains('active'))document.querySelector('#ssdg-auto-btn').click()");
      await language(client, "en");
      await words(client, "____", ["cafe", "tree", "test"]);
      await evaluate(client, "window.__holdSpanishFetch=false;__heldFetches.splice(0).forEach(resolve=>resolve());__pause(200)");
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-language').value"), "en");
      assert.equal(await evaluate(client, "__storage.guesserSettingsV160.language"), "en");
      await words(client, "____", ["cafe", "tree", "test"]);
    });
    console.log("PASS asynchronous switching: loading gates guesses; late Spanish responses cannot replace English");

    for (const failure of ["missing", "empty"]) await page({}, async client => {
      await evaluate(client, `window.${failure === "missing" ? "__missingSpanishFetch" : "__emptySpanishFetch"}=true;__change('#ssdg-language','es');__waitFor(()=>document.querySelector('#ssdg-status').textContent.includes('Could not load Spanish'),'visible failed dictionary')`);
      assert.deepEqual(await evaluate(client, "__words()"), [], `${failure} Spanish dictionary fell back to English words`);
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-language').value"), "es");
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-status').style.display"), "block");
      await evaluate(client, "__change('#ssdg-delay','400');document.querySelector('#ssdg-auto-btn').click();document.querySelector('#ssdg-search').dispatchEvent(new KeyboardEvent('keydown',{key:'1',altKey:true,bubbles:true}));__pause(500)");
      assert.deepEqual(await evaluate(client, "__guesses"), [], "A failed Spanish dictionary sent guesses");
      await evaluate(client, "if(document.querySelector('#ssdg-auto-btn').classList.contains('active'))document.querySelector('#ssdg-auto-btn').click()");
      await language(client, "en", ["cat", "dog"]);
    });
    console.log("PASS dictionary failures: missing/empty Spanish lists show an error, send no guesses and never substitute English");
  } finally {
    server.close();
    if (browser) {
      try { await browser.client.send("Browser.close"); } catch { browser.child.kill(); }
      browser.client.close();
      if (browser.child.exitCode === null) await Promise.race([once(browser.child, "exit"), new Promise(resolve => setTimeout(resolve, 5000))]);
      const relative = path.relative(os.tmpdir(), browser.profile);
      assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(browser.profile).startsWith("skribbl-language-test-"), "Unexpected browser profile cleanup target");
      fs.rmSync(browser.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

(async () => { CATALOG = readCatalog(); moduleTests(); await browserTests(); })().catch(error => { console.error(error); process.exitCode = 1; });
