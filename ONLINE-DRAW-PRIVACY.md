# Publishing notes — Auto Draw 2.2.1

These are proposed disclosure updates, not confirmation that a hosted policy or store listing was updated.


Auto Draw accepts a user-selected or dragged PNG, JPEG, WebP or GIF image. Local files are decoded and converted into drawing commands on the user's device. They are not uploaded to an image provider, learned-word sync, or another image-processing service. GIF uses its first frame.

If the user drops an image from a website, the extension requests that specific HTTPS image using normal browser CORS restrictions. The source website receives ordinary connection information, including the IP address and requested URL. Requests omit credentials and referrers, reject redirects, and do not use a third-party proxy. Sources that block access require the user to save and drop the file locally.

The image is held in page memory for the drawing session and is not intentionally persisted. The generated drawing is submitted through Skribbl's normal drawing controls and is visible to game participants. Draw style, brush size and speed are stored locally without expiry, including migration of older saved settings. They are removed if the browser clears extension data or the extension is uninstalled. The optional learned-word cloud sync remains separate and follows its existing consent disclosure.

Google Images is a search window opened only when clicked. It sends the selected drawing word plus cartoon drawing to Google in a small separate browser window, where Google privacy practices apply. No search API, automatic search request, or result scraping is used. The extension does not contact Wikimedia Commons or request Wikimedia host permissions.

Reviewer test: join a private Skribbl room, wait for your drawing turn, then drop a local image on the Draw tab. Verify that a new installation defaults to Sketch, 5 px and Ultra Fast. Test all three brush sizes, Pause/Resume, Stop, manual takeover, and navigation/turn cancellation. Switching tabs/apps should not explicitly cancel drawing, though browser throttling can slow it. Google Images should open results for the current word in a small separate window only after a click. The engine clears the canvas before drawing. With another drawing extension enabled, verify that its panel remains separate and that drops/pastes outside our visible Draw pane do not load an image here.

No credentials, image API key, remote executable code, or image-search connection is required. Version is 2.2.1. See BUILDING.md for the reproducible Terser build.
