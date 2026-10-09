# Skribbl Smart Drawer/Guesser identity

- Display name: **Skribbl Smart Drawer/Guesser**
- Version: **1.0**
- Unpacked extension ID: `bpjccmbldjbdpkgaikbejoninpmgaidd`
- Icon master: `quill-source.png`
- Installed icons: `../icon16.png`, `../icon32.png`, `../icon48.png`, `../icon128.png`

See [MENU-THEME.md](MENU-THEME.md) for the current title font, blue doodle artwork,
licenses, and background generation prompt.

The icon was generated with the built-in image generation tool, using the user's
pencil image as a style reference. The master is preserved; `scripts/build-icons.ps1`
exports the browser sizes. Small toolbar sizes use bicubic filtering; larger
sizes preserve hard pixel edges with nearest-neighbor sampling.

The manifest contains only the public identity key. The private signing key is
stored outside this repository at
`%USERPROFILE%\.codex\extension-keys\skribbl-quill.pem`. Keep that file private and
reuse it if packaging signed CRX builds. Do not include it in a distributable.
The old extension's update URL was removed. A future Web Store publication needs
its own store setup; reconcile its assigned public key with the development key.
Chrome documents the [manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/key)
and [version format](https://developer.chrome.com/docs/extensions/reference/manifest/version).

## Generation prompt

The original icon prompt below predates the display-name change; the quill icon is retained.

Use case: logo-brand. Asset type: square Chrome extension icon for Skribbl Quill. The attached image is a STYLE REFERENCE, not a design to copy. Create a DIFFERENT original design with a QUILL PEN instead of the pencil. Match the reference's chunky uniform black outline width (about 4 pixels on a 90-pixel-wide design), charming rough stair-stepped pixel edges and flat, lightly stippled pixel texture. A single large recognizable feather quill angled from lower left nib to upper right feather tip, broad curving warm ivory and golden-yellow feather with orange shading, a strong dark central shaft, a few angular feather notches and a black ink nib. No pencil barrel or eraser. Keep the feather silhouette bold and simple so it reads at 16 and 32 pixels. Square royal-blue background with very subtle darker blue playful doodles, matching the reference mood but different doodles. Quill occupies about 80 percent of the square, comfortably inside the edges. Flat 2D retro drawing-game pixel art, crisp hard edges, consistent thick black outline, restrained small palette, no gradients, no glossy rendering, no 3D, no letters, no text, no watermark. Output a single finished square icon.
