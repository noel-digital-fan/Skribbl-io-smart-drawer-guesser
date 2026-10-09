"use strict";

// Offline: validate the retained sanitized trace and the actual client library.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const capture = JSON.parse(fs.readFileSync(path.join(__dirname,"native-admission-capture.json"),"utf8"));
const io = require(path.join(__dirname,"socket.io.js"));
const options = {path:"/5005/",autoConnect:false,forceNew:true,multiplex:false,reconnection:false};
const first = io("https://server3.skribbl.io",options), second = io("https://server3.skribbl.io",options);
assert.notEqual(first,second); assert.notEqual(first.io,second.io);
assert.equal(first.connected,false); assert.equal(second.connected,false);
first.close(); second.close();
assert.equal(capture.sessions.length,4);
const capturedOtherApplicationEmissions = capture.sessions.flatMap(session=>session.websocketEvents)
  .filter(row=>row.unexpectedApplicationEmission).length;
const parseFailures = capture.sessions.flatMap(session=>session.websocketEvents).filter(row=>row.parseFailure).length;
assert.equal(capturedOtherApplicationEmissions,0);
assert.equal(capture.sentNonLoginApplicationFrames,0);
assert.equal(parseFailures,0);
const comparisons = [];
const normalizedSessionFrame = {};
for (const session of capture.sessions) {
  assert.deepEqual(session.blockedApplicationEmissions,[]);
  assert.deepEqual(session.errors,[]);
  const lookup = session.requests.filter(row=>row.url.endsWith("/api/play"));
  assert.equal(lookup.length,1); assert.equal(lookup[0].status,200);
  assert.ok(lookup[0].wireHeaders,"Lookup wire headers were not retained");
  const created = session.websocketEvents.filter(row=>row.type==="created");
  assert.equal(created.length,1);
  const destination = new URL(created[0].url);
  assert.equal(destination.protocol,"wss:"); assert.equal(destination.hostname,"server3.skribbl.io");
  assert.equal(destination.pathname,"/5005/"); assert.equal(destination.searchParams.get("EIO"),"4");
  const upgrade = session.websocketEvents.find(row=>row.type==="handshake-response");
  assert.equal(upgrade.status,101);
  const sent = session.websocketEvents.filter(row=>row.type==="sent" && row.text?.startsWith("42["));
  assert.equal(sent.length,1);
  const [event,login] = JSON.parse(sent[0].text.slice(2)); assert.equal(event,"login");
  const result = session.websocketEvents.find(row=>row.type==="received" && /^42\["(?:data|joinerr)"/.test(row.text));
  assert.ok(result);
  const [resultEvent,resultPayload] = JSON.parse(result.text.slice(2));
  const open = session.websocketEvents.find(row=>row.type==="received" && row.text?.startsWith("0{"));
  const engine = JSON.parse(open.text.slice(1));
  const connected = session.websocketEvents.find(row=>row.type==="received" && row.text?.startsWith("40{"));
  const socketId = JSON.parse(connected.text.slice(2)).sid;
  const canonicalLogin = {...login};
  if (login.create===1) {
    assert.equal(typeof login.join,"string");
    canonicalLogin.join = 0;
  }
  normalizedSessionFrame[session.label] = {login:canonicalLogin,
    creationJoinNote:login.create===1 ? "Collector's original alias() erroneously aliased numeric zero. Canonical numeric 0 is recovered from the inspected native creation call; original sanitized capture is unchanged." : undefined};
  comparisons.push({label:session.label,httpStatus:lookup[0].status,body:lookup[0].body,
    returnedEndpoint:lookup[0].responseBody,websocket:created[0].url,upgradeStatus:upgrade.status,
    engineId:engine.sid,socketId,pingInterval:engine.pingInterval,pingTimeout:engine.pingTimeout,maxPayload:engine.maxPayload,
    cookieOnLookup:Boolean(lookup[0].wireHeaders?.cookie),lookupWireHeadersAvailable:Boolean(lookup[0].wireHeaders),
    cookieOnWebSocket:Boolean(session.websocketEvents.find(row=>row.type==="handshake-request").headers.cookie),
    result:resultEvent==="joinerr" ? {joinerr:resultPayload} : {joined:true,type:resultPayload.data.type,
      room:resultPayload.data.id,me:resultPayload.data.me,owner:resultPayload.data.owner,capacity:resultPayload.data.settings[1],occupied:resultPayload.data.users.length},
    timeLoginToAdmissionMs:Math.round((result.time-sent[0].time)*1000)});
}
assert.equal(new Set(comparisons.map(row=>row.engineId)).size,4);
assert.equal(new Set(comparisons.map(row=>row.socketId)).size,4);
assert.deepEqual(comparisons.map(row=>row.result.joinerr || row.result.type),[0,100,1,1]);
const analysis = {verifiedOffline:true,realSocketIoManagersDistinct:true,networkOpenedByVerification:false,
  capturedGameConnections:comparisons.length,capturedApplicationLogins:comparisons.length,capturedOtherApplicationEmissions,
  guardBlockedApplicationEmissions:0,comparisons,normalizedSessionFrame,
  collectorLimitations:["Original collector captured selected HTTP headers and standard unnamespaced Socket.IO application frames, not all browser traffic.",
    "Original source had no WebSocket allowlist, but all four recorded sockets were checked as first-party game connections.",
    "Original source relied on the native client's disconnect handling; retained trace verifies exactly four distinct game connections and one login each.",
    "Original source aliased numeric creation join 0 as a room string; native source confirms numeric 0. Corrected collector preserves numeric values.",
    "Original request-extra-info listener could miss reordered events; all four lookup records in this trace do contain wireHeaders.",
    "Collector was hardened after this run; no new live run was performed because the retained trace has sufficient admission evidence."]};
fs.writeFileSync(path.join(__dirname,"native-admission-analysis.json"),JSON.stringify(analysis,null,2)+"\n");
console.log(JSON.stringify({verifiedOffline:true,realSocketIoManagersDistinct:true,comparisons},null,2));
