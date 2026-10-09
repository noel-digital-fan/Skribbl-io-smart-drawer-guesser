# Public-room admission investigation

Observed on October 4, 2026. These are live admission observations, separate
from the extension's simulated vote tests. No votes, chat, guesses, drawing,
kicks, or bans were sent by the diagnostic. All diagnostic connections were
closed afterward.

The first English-room comparison returned code 2 (full room), which did not
resolve the identity question. Subsequent comparisons used native language ID
3 (Czech) to reduce competition for slots.

The final comparison observed a public lobby (`type: 0`) with 3 of 8 slots
occupied immediately before the first invitation attempt. It used the normal
`POST /api/play` lookup with the room ID; the returned endpoint matched the
primary connection. The diagnostic waited at least 12 seconds before each
additional login.

| Connection | Name / avatar | Browser storage | Result |
| --- | --- | --- | --- |
| Primary public matchmaking | Probe Alpha / `[0,0,0,-1]` | Temporary normal context | Joined; public lobby |
| Normal invitation to that room | Peer Beta / `[1,1,1,-1]` | Same context as primary | `joinerr: 100` |
| Normal invitation to that room | Guest Gamma / `[2,2,2,-1]` | New isolated context; cookie jar verified empty before loading the site | `joinerr: 100` |

The names were distinct and within the native input's 21-character limit.
Socket.IO session IDs and Engine.IO session IDs differed from the primary.
The isolated context used the same browser and network; no network identity
changes were attempted. Earlier Czech comparisons also received code 100 with
shared avatars and then with distinct avatars.

The [official game client](https://skribbl.io/js/game.js) maps code 100 to
already being connected to the room. It reports full-room and rate-limit
failures with separate codes. Its normal login flow contains no exposed token
or fingerprint that our helper needs to supply. The Socket.IO
[`forceNew` and `multiplex` options](https://socket.io/docs/v4/client-options/)
create a separate manager; this was also checked with the site's actual
Socket.IO library offline.

The observations establish that ordinary new socket sessions, the native
room lookup, distinct names and avatars, and isolated browser storage did not
resolve this public-room rejection in the tested environment. An IP or other
network-based admission rule is a plausible explanation, not a verified
server implementation. Browser/process characteristics and other server
inputs were not independently isolated. No server-side identity value or
working browser-only workaround was found. This does not prove that every
possible admission method is unavailable.

Repeat the login-only diagnostic with:

```powershell
node scripts/diagnose-votekick-admission.cjs --live --lang 3
```

It opens one primary connection and at most two invitation attempts. Without
`--live`, it opens no browser or game connection. The reported zero votes is
enforced by rejecting every application-level socket emission except login.
Room IDs, other players' names, cookie values, and connection IDs are omitted
from its output.
