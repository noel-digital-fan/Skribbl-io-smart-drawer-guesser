# Skribbl Auto Guess And Draw

## Auto Draw — 2.2.1 direct drawing and drag/drop

Drop a PNG, JPEG, WebP or GIF file onto the canvas or Draw tab. The drop area also
opens a file picker. Drawing begins automatically after loading and planning.
There is no image search, Start button, or converted preview.

Choose Lines, Dots or Sketch, brush level 1–5 and speed before selecting an image. Defaults are level 1 and
Fastest. The reference-style engine fits the image, fills its most common background
color, and draws long horizontal color lines first. It clears the canvas before
drawing. Saved choices persist across sessions and updates.

Dots keeps your selected brush size. Fast fill uses short interior strokes and
fine boundary dots; turn it off for pure dots. Sketch traces connected outlines
and uses the bucket only after checking containment; unsafe fills use strokes.
Lines geometry is unchanged. Fastest pacing and point batching are quicker in all
styles. Level-1 hybrid dots compact adjacent marks only when pixels stay identical.
Plans above 55 seconds warn about the 60-second turn; complex images may still run
long. No automatic reduction in detail or brush enlargement is applied.

Local files stay on your device (10 MB / 20 MP limit; GIF uses the first frame).
Website-image drops depend on source access. If blocked, save and drop the file.
No third-party proxy or additional all-sites permission is used.

Pause/Resume and Stop remain available, including Stop during loading.
Selections outside your turn are not queued. Turn changes, hidden pages,
navigation and manual drawing/toolbar input stop automation.

Guess/Draw tabs remain available and switch automatically with your turn.
See ONLINE-DRAW.md and ENGINE-NOTES.md for behavior, limits and verification.
Live multiplayer and native Firefox behavior still require manual testing.


A simple Chrome/Edge extension that helps you guess words on [skribbl.io](https://skribbl.io).

It reads the current word hint (e.g. `c_t`, `____ __`, etc.), matches it against a list of **3,686 English words**, and shows clickable suggestions. You can also turn on **Auto mode** to automatically submit guesses.

## Features

- Real-time hint detection and filtering (including multi-word phrases)
- Search within the live suggestion list
- Click any suggested word to submit it instantly
- **Auto Guess** starts with random candidates while no letters are visible, switches to smart ranking when a letter appears, respects the round limit while the list is broad, then finishes all candidates once the list narrows to 25 or fewer
- **Force smart shuffle** guesses randomly while no letters are visible, then prioritizes successful and learned words once a letter is revealed, with no per-round limit
- Safer Auto mode that pauses while offline, hidden, or when chat submission is unavailable
- Persistent delay, guess limit, collapsed state, and panel position
- Keyboard shortcuts: **Alt+A** toggles Auto, **Alt+1** guesses the top result, **Alt+F** focuses search
- Match statistics mirror the game round number and keep correct answers for the full match, while the guess counter resets for each drawing
- Smarter ranking that prioritizes words that worked before
- **Auto-learn** new words when the round ends (“The word was …”) or when you guess correctly
- Import, export, or reset learned words from the panel
- Learned words are saved in the browser and reused next time
- Optional cloud sync, with first-use consent, sends only learned words and the extension version
- Draggable floating panel
- Guessing and local-file drawing work without an image-search service
- Works on the default English word list

## Installation (Chrome / Edge / Brave)

1. Download or copy the entire `skribbl-auto-guesser` folder to your computer.
2. Open your browser and go to `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode** (toggle in the top-right).
4. Click **Load unpacked**.
5. Select the `skribbl-auto-guesser` folder.
6. Go to [https://skribbl.io](https://skribbl.io) and start a game.

A floating panel will appear on the right side of the screen.

## How to use

- The panel shows the current hint and all matching words.
- **Click a word** → it is typed into the chat and submitted.
- Click **Auto: OFF** to turn it into **Auto: ON**.  
  The extension will automatically submit guesses (shortest first) with the delay you set.
- You can change the auto-guess delay (in milliseconds) at the bottom of the panel.
- Drag the header to move the panel. Click **−** to collapse it.
- Settings and panel placement are restored after restarting the browser.

## Notes

- The word list is the public English list collected around mid-2025 (~3686 words).  
  Private rooms with custom words or other languages will not match perfectly.
- Auto mode is limited to a small number of guesses per round to reduce the chance of being kicked for spam.
- This is for educational / fun purposes. Using automation may violate the game’s terms of service and can get you kicked or banned by other players.
- Cloud sync is optional and starts only when you press **Sync words** and accept its disclosure. No username, chat, drawing, browsing history, or installation identifier is uploaded.
- Privacy policy: https://skribbl-word-sync.lakshithadil30.workers.dev/privacy

## Files

- `manifest.json` – extension config (Manifest V3)
- `content.js` – main logic
- `styles.css` – panel styling
- `words.txt` – the word list
- `icon48.png` / `icon128.png` – icons

Enjoy!
