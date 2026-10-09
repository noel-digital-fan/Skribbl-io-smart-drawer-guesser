# Interface previews

The latest pixel-font screenshots are embedded in the [main README](../../README.md)
and stored in [`docs/images`](../../docs/images). The older screenshots below retain
the typography used when they were captured.

## Current name and reference-inspired theme

- [Skribbl Smart Drawer/Guesser popup](smart-popup.png)
- [Guess menu](smart-guess.png)
- [Draw menu](smart-draw.png)
- [300 px viewport](smart-narrow.png)

Captured with the actual unpacked Chrome extension and the real skribbl.io home
page. Verified the exact display name, unchanged extension ID/version, successful
local font loading in both surfaces, the background asset's extension URL,
no horizontal overflow in either tab at 300 px, and compact collapsed height.
Panel/window, image experience and Votekick UI regression suites passed.
No multiplayer session was joined for these screenshots.

## Earlier branding

[Skribbl Quill 1.0 popup](quill-popup.png) was captured from an actual unpacked
Chrome installation after the icon and identity update. Chrome reported ID
`bpjccmbldjbdpkgaikbejoninpmgaidd`; all four PNG icon sizes and the popup's version
and image loading were verified. Earlier screenshots below show the prior branding.

Captured in headless Chromium using the production UI with local game/Chrome API fixtures.
These screenshots do not represent live multiplayer sessions.

- [Guess](guess-preview.png)
- [Draw](draw-preview.png)
- [Extension popup](popup-preview.png)
- [Image editor](editor-preview.png)
- [Image queue](waiting-images.png)
- [Private-lobby Votekick](votekick-preview.png)
- [320 px viewport](compact-panel.png)
- [Expanded panel](panel-resized.png)

Validated with the existing dependency-free suites:

```sh
node scripts/test-panel-window.cjs --artifacts artifacts/ui-redesign
node scripts/test-panel-experience.cjs --artifacts artifacts/ui-redesign
node scripts/test-guess-languages.cjs
node scripts/test-votekick-ui.cjs
```

All passed. Additional browser review checked horizontal overflow in both tabs
at 280, 360 and 560 px panel widths. The visual changes add no dependencies,
permissions, remote fonts or runtime image requests. Engine and lobby execution
logic are unchanged; histogram colors affect only the editor's histogram display.
