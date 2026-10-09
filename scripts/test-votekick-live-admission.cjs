"use strict";

// Opt-in bounded admission test of the actual MAIN-world VoteKick runner.
// Three supported helper cases; login only; no selected player or votes.
// node scripts/test-votekick-live-admission.cjs --live --lang 3
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const ROOT = path.resolve(__dirname,"..");
const originalArtifacts = path.join(ROOT,"artifacts/public-private-investigation-2026-10-04");
const collector = fs.readFileSync(path.join(originalArtifacts,"capture-native-admission.cjs"),"utf8");
const helperPrefix = collector.slice(0,collector.lastIndexOf("\nasync function main() {"));
const sandbox = {require,process,console,WebSocket,setTimeout,clearTimeout,__dirname:originalArtifacts};
vm.runInNewContext(helperPrefix+"\nthis.helpers={launchBrowser,evaluate,connectWithEvents,safeUrl,headers,frame,alias};",sandbox);
const {launchBrowser,evaluate,connectWithEvents,safeUrl,headers,frame,alias} = sandbox.helpers;
const pause = ms=>new Promise(resolve=>setTimeout(resolve,ms));
const guard = `(() => {
  const state=window.__liveProbe={records:[],blocked:[],statuses:[]};
  document.addEventListener('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-status',event=>{
    try{const payload=JSON.parse(event.detail);if(payload.type==='status')state.statuses.push(payload);}catch{}
  });
  let factory;
  Object.defineProperty(window,'io',{configurable:true,get:()=>factory,set:value=>{
    factory=new Proxy(value,{apply(target,thisArg,args){
      if(state.records.length>=3)throw new Error('Live test permits at most three sockets per page.');
      const socket=Reflect.apply(target,thisArg,[args[0],{...args[1],reconnection:false}]);
      const record={socket,room:null,users:new Set(),login:null,error:null};state.records.push(record);
      const emit=socket.emit;
      socket.emit=function(event,...parameters){
        if(event!=='login'){state.blocked.push({event,packetId:parameters[0]?.id});throw new Error('Live test blocks gameplay and voting.');}
        if(record.login){state.blocked.push({event:'repeat-login'});throw new Error('One login per socket.');}
        record.login=parameters[0];return Reflect.apply(emit,this,[event,...parameters]);
      };
      socket.on('data',packet=>{
        if(packet?.id===10){record.room=packet.data;record.users=new Set(packet.data.users.map(user=>user.id));}
        else if(packet?.id===1)record.users.add(packet.data.id);
        else if(packet?.id===2)record.users.delete(packet.data.id);
      });
      socket.on('joinerr',code=>{record.error={joinerr:code};});
      socket.on('connect_error',()=>{record.error={connectError:true};});
      return socket;
    }});
  }});
  window.__liveSummary=()=>state.records.map(record=>({
    login:record.login,room:record.room?.id,type:record.room?.type,me:record.room?.me,
    owner:record.room?.owner,capacity:Number(record.room?.settings?.[1]),occupied:record.users.size,
    error:record.error,connected:record.socket.connected
  }));
  window.__closeLive=()=>state.records.forEach(record=>record.socket.close());
})();`;
async function main() {
  if(!process.argv.includes("--live")) {
    console.log("No live connections. Add --live for actual runner public invitation/matchmaking and private invitation probes, with votes blocked.");return;
  }
  const language=process.argv.includes("--lang")?process.argv[process.argv.indexOf("--lang")+1]:"3";
  assert.ok(/^\d+$/.test(language)&&Number(language)<=27,"Invalid native language ID");
  const runner=fs.readFileSync(path.join(ROOT,"votekick-runner.js"),"utf8");
  const artifactDir=path.join(ROOT,"artifacts/votekick-public-implementation-2026-10-04");
  fs.mkdirSync(artifactDir,{recursive:true});
  const report={startedAtUtc:new Date().toISOString(),language:Number(language),
    method:"Actual runner, native primary UI, three one-helper admission probes, same network, votes/gameplay blocked",
    runnerSha256:crypto.createHash("sha256").update(runner).digest("hex"),sessions:[],cases:[]};
  fs.writeFileSync(path.join(artifactDir,"runner-tested.js"),runner);
  let browser;
  const clients=[],pending=[];
  async function waitFor(client,expression,timeout=20000) {
    const began=Date.now();
    while(Date.now()-began<timeout){try{if(await evaluate(client,expression))return;}catch{}await pause(100);}
    throw new Error("Timed out waiting for runner/page admission");
  }
  async function page(label) {
    const log={label,requests:[],websocketEvents:[],errors:[]};report.sessions.push(log);
    const {targetId}=await browser.client.send("Target.createTarget",{url:"about:blank"});
    const targets=await(await fetch(browser.base+"/json/list")).json();
    const tracked=new Map(),extras=new Map(),webSockets=new Set();
    let client;
    client=await connectWithEvents(targets.find(target=>target.id===targetId).webSocketDebuggerUrl,(method,params)=>{
      if(method==="Network.requestWillBeSent"&&params.request.url==="https://skribbl.io/api/play"){
        const body=new URLSearchParams(params.request.postData||"");
        const row={method:params.request.method,url:params.request.url,time:params.timestamp,
          body:body.has("id")?"id="+alias(body.get("id"),"room"):params.request.postData,headers:headers(params.request.headers)};
        if(extras.has(params.requestId))row.wireHeaders=extras.get(params.requestId);
        tracked.set(params.requestId,row);log.requests.push(row);
      }else if(method==="Network.requestWillBeSentExtraInfo"){
        const value=headers(params.headers);extras.set(params.requestId,value);
        if(tracked.has(params.requestId))tracked.get(params.requestId).wireHeaders=value;
      }else if(method==="Network.responseReceived"&&tracked.has(params.requestId)){
        Object.assign(tracked.get(params.requestId),{status:params.response.status,responseHeaders:headers(params.response.headers)});
      }else if(method==="Network.loadingFinished"&&tracked.has(params.requestId)){
        pending.push(client.send("Network.getResponseBody",{requestId:params.requestId}).then(result=>{
          tracked.get(params.requestId).responseBody=safeUrl(result.body.trim());
        }).catch(error=>log.errors.push(error.message)));
      }else if(method==="Network.webSocketCreated"){
        const url=new URL(params.url);
        if(url.protocol==="wss:"&&url.hostname.endsWith(".skribbl.io")&&/^\/\d+\/$/.test(url.pathname)){
          webSockets.add(params.requestId);log.websocketEvents.push({type:"created",id:params.requestId,url:safeUrl(params.url)});
        }
      }else if(webSockets.has(params.requestId)){
        if(method==="Network.webSocketWillSendHandshakeRequest")log.websocketEvents.push({type:"handshake-request",id:params.requestId,time:params.timestamp,headers:headers(params.request.headers)});
        else if(method==="Network.webSocketHandshakeResponseReceived")log.websocketEvents.push({type:"handshake-response",id:params.requestId,time:params.timestamp,status:params.response.status,headers:headers(params.response.headers)});
        else if(method==="Network.webSocketFrameSent"||method==="Network.webSocketFrameReceived"){
          const direction=method.endsWith("Sent")?"sent":"received";
          const parsed=frame(params.response.payloadData,direction);
          if(parsed)log.websocketEvents.push({type:direction,id:params.requestId,time:params.timestamp,...parsed});
        }else if(method==="Network.webSocketClosed")log.websocketEvents.push({type:"closed",id:params.requestId,time:params.timestamp});
        else if(method==="Network.webSocketFrameError")log.errors.push(params.errorMessage);
      }
    });
    clients.push(client);
    await client.send("Network.enable");await client.send("Page.enable");
    await client.send("Page.addScriptToEvaluateOnNewDocument",{source:guard});
    await client.send("Page.addScriptToEvaluateOnNewDocument",{source:runner});
    await client.send("Page.navigate",{url:"https://skribbl.io/"});
    await waitFor(client,"typeof io==='function' && document.readyState==='complete' && Boolean(document.querySelector('.button-play'))");
    return client;
  }
  async function primary(client,create) {
    await evaluate(client,`document.querySelector('#home .input-name').value=${JSON.stringify(create?"Runner Test Owner":"Runner Test Primary")};
      document.querySelector('#home .container-name-lang select').value=${JSON.stringify(language)};
      document.querySelector(${JSON.stringify(create?".button-create":".button-play")}).click()`);
    await waitFor(client,"Boolean(__liveProbe.records[0]?.room || __liveProbe.records[0]?.error)");
    const value=(await evaluate(client,"__liveSummary()"))[0];
    if(!value||value.error||!value.room)throw new Error("Primary failed admission");
    return {room:alias(value.room,"room"),type:value.type,me:value.me,owner:value.owner,capacity:value.capacity,occupied:value.occupied};
  }
  async function probe(client,label,mode) {
    const occupancy=(await evaluate(client,"__liveSummary()"))[0];
    if(!occupancy.connected||occupancy.occupied>=occupancy.capacity){report.cases.push({label,skipped:"Disconnected/full; no retry"});return;}
    await evaluate(client,`__liveProbe.statuses.length=0;
      document.dispatchEvent(new CustomEvent('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-request',{detail:JSON.stringify({action:'probe',mode:${JSON.stringify(mode)}})}))`);
    await waitFor(client,"__liveProbe.statuses.some(value=>value.probe && !value.running)");
    const statuses=await evaluate(client,"__liveProbe.statuses");
    const terminal=statuses.findLast(value=>value.probe&&!value.running);
    const sockets=await evaluate(client,"__liveSummary()");
    const result={label,mode,occupiedBefore:occupancy.occupied,capacity:occupancy.capacity,
      statuses:statuses.map(value=>({state:value.state,message:value.message,running:value.running,admissionCode:value.admissionCode,probe:value.probe})),
      terminal:{state:terminal.state,message:terminal.message,probe:terminal.probe},
      sockets:sockets.map(value=>({room:alias(value.room,"room"),type:value.type,me:value.me,error:value.error,connected:value.connected,
        login:value.login?{join:alias(value.login.join,"room"),create:value.login.create}:null}))};
    report.cases.push(result);console.log(label+": "+JSON.stringify(result.terminal));
    assert.ok(sockets[0].connected,"Probe closed primary");
    assert.ok(sockets.slice(1).every(value=>!value.connected),"Probe left helpers connected");
  }
  try{
    browser=await launchBrowser();report.browser=await browser.client.send("Browser.getVersion");
    const publicPage=await page("public");report.publicPrimary=await primary(publicPage,false);
    assert.equal(report.publicPrimary.type,0);
    await pause(12500);await probe(publicPage,"public-native-invitation","invite");
    await pause(12500);await probe(publicPage,"public-native-matchmaking","matchmaking");
    await evaluate(publicPage,"__closeLive()");
    await pause(12500);
    const privatePage=await page("private");report.privatePrimary=await primary(privatePage,true);
    assert.equal(report.privatePrimary.type,1);
    await pause(12500);await probe(privatePage,"private-runner-invitation","invite");
    await evaluate(privatePage,"__closeLive()");
  }catch(error){report.error=error.message;process.exitCode=1;}
  finally{
    for(let index=0;index<clients.length;index++){
      try{report.sessions[index].blocked=await evaluate(clients[index],"(()=>{__closeLive();return __liveProbe.blocked})()");}catch{}
    }
    await Promise.allSettled(pending);
    report.finishedAtUtc=new Date().toISOString();
    report.nonLoginApplicationEvents=report.sessions.flatMap(session=>session.websocketEvents).filter(value=>value.unexpectedApplicationEmission).length;
    report.blockedGameplayAttempts=report.sessions.reduce((sum,session)=>sum+(session.blocked?.length||0),0);
    report.selectedPublicRoomAdmissionVerified=report.cases.some(value=>value.label.startsWith("public-")
      &&value.terminal?.probe?.sameRoom&&value.terminal.state==="done");
    fs.writeFileSync(path.join(artifactDir,"runner-admission-capture.json"),JSON.stringify(report,null,2)+"\n");
    console.log("Saved actual-runner capture; selected public-room admission:",report.selectedPublicRoomAdmissionVerified);
    console.log("Non-login application events:",report.nonLoginApplicationEvents,"blocked gameplay attempts:",report.blockedGameplayAttempts);
    clients.forEach(client=>client.close());
    if(browser){
      try{await browser.client.send("Browser.close");}catch{browser.child.kill();}browser.client.close();
      if(browser.child.exitCode===null)await Promise.race([once(browser.child,"exit"),pause(5000)]);
      const resolved=path.resolve(browser.profile),relative=path.relative(path.resolve(os.tmpdir()),resolved);
      if(relative&&!relative.startsWith("..")&&!path.isAbsolute(relative)&&path.basename(resolved).startsWith("skribbl-votekick-ui-"))
        fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
