# StreamTest 2.0

A Chrome extension that finds the problems of a WebRTC video stream on the receiving side and, for each one, tells what happened, when, how bad it was, the likely cause (network, sender, page or this device) and what to check. Right-click a participant's video → **Test stream**.

- **Compact** (350 px): the status row (`No problems · 2:00`, `Bandwidth drop · now`, `3 problems · last 76s ago`), seven tiles with sparklines, codecs and the connection chip, Mark.
- **Mini** (190 px): the tiles' values and one status line.
- **Expanded → Timeline** (900 × 700): the verdict, four charts on one time axis (bitrate, frame rate, packet loss, delay), problem bands, the events band, the problems list and a card per problem.
- **Expanded → Report**: the verdict with a text for a ticket and Copy summary, the comparison with the previous run on the site, every problem with its card, percentiles, other streams of the page, JSON / CSV export.

Everything is collected and computed in the page; nothing leaves the browser.

## Install

```bash
npm run install-all
```

```bash
npm run build
```

Open `chrome://extensions`, turn on Developer mode, **Load unpacked** → the `build/` folder. Chrome 116 or newer; building and tests need Node.js 20 or newer (CI runs 20).

The extension works on `https://` pages, on the root page of an `http://` site and on `http://localhost` / `http://127.0.0.1` with any path.

## Development

| Command | What it does |
|---|---|
| `npm run watch` | rebuilds `build/` on every change (webpack for the injection, Vite for the panel); press ⟳ on the extension card afterwards |
| `npm test` | unit tests (vitest): formulas, detectors, export, the panel's pure functions |
| `npm --prefix popup run dev` | the panel without the extension, on a synthetic session: `http://localhost:5173/?mock=compact&speed=10` (`mini`, `expanded`, `start`; `&tab=report`, `&disconnect=90` and more — see `popup/src/dev/mockSession.ts`) |
| `npm run stand` | the test stand, http://localhost:8080 — see below |
| `npm run e2e` | end-to-end tests on the stand — see below |

Linters: `cd injection && ESLINT_USE_FLAT_CONFIG=false npx eslint src --ext .ts`, `cd popup && ESLINT_USE_FLAT_CONFIG=false npx eslint src --ext .ts,.tsx`, `npm run lint:stand` (stand, scripts, e2e).

## Architecture

```
injection/        runs in the page's own JS world (injected by main.js as <script>)
  wrappers/       RTCPeerConnection wrapper: the page's connections, setRemoteDescription / ICE / first-packet times, video track numbers
  events/         the context-menu click → the <video> under the cursor → its connection → a session; start errors
  session/        one session: getStats() once a second → extract → metrics → the sample buffer (60 min) →
                  events and problem detectors (problems/*.ts, one per type) → verdict, status, report, export
shared/           the message protocol between the page and the panel (protocol.ts), sample fields, formats
popup/src/        the panel: a React app in an iframe; it only draws what the injection sends
popup/public/     main.js — content script: the panel's frame, modes and sizes, dragging, chrome.storage (mode, previous run);
                  background.js — the context menu item and the toolbar button; manifest.json
stand/            the test stand: a loopback call, a Truth panel, scenario buttons, network shaping through TURN
e2e/              Playwright tests on the stand
```

Data flow: the session polls the selected connection's `getStats()` once a second, turns the report into a per-second sample, stores it column-wise, runs the detectors and sends the panel one `VTT_BATCH` with the sample, the new events and problem updates; Frame rate comes four times a second (`VTT_FPS`). The panel asks for what it does not keep (`VTT_GET_HISTORY`, `VTT_GET_REPORT`, `VTT_EXPORT`, `VTT_COPY_SUMMARY`). The messages are typed in `shared/protocol.ts`.

### Debugging from the page's console

`window.__vtt` reads the latest session, also after it ended:

| Call | Returns |
|---|---|
| `__vtt.state()` | `idle` / `live` / `disconnected` / `stopped` |
| `__vtt.sample()`, `__vtt.series("v_bitrate", 60)` | the latest sample, the last values of a field |
| `__vtt.events()`, `__vtt.problems()`, `__vtt.streams()` | events, problems with their cards, other streams of the page |
| `__vtt.export("json" \| "csv")` | downloads the session's file |
| `await __vtt.debug.perf()` | the load: `getStats()` calls per second, the rVFC callback, the panel's renders and redraws, memory; `exceeded` lists what is over the limits |
| `await __vtt.debug.fastForward(3600)` | the live session runs an hour further at once (its recorded samples replayed), to measure a long session |
| `__vtt.debug.exportSize()` | the size of the export files and the time to make them |

## Test stand

A WebRTC call between two peer connections in one page, with buttons that reproduce every problem type and a **Truth** panel that computes the key numbers from `getStats()` independently of the extension.

```bash
npm run stand:turn
```

```bash
npm run stand
```

`stand:turn` starts coturn in Docker once — the network presets (loss, throttling, blackouts) shape the traffic that goes through it; stop it with `npm run stand:turn:down`. Open http://localhost:8080, **Start**, then **Test this stream**. Routes, presets, the HTTP API and ports: [stand/README.md](stand/README.md).

## End-to-end tests

Playwright with its Chromium, on the built `build/` and the stand (the stand is started if it is not running; network scenarios need `npm run stand:turn`).

```bash
npm run e2e:install
```

```bash
npm run e2e
```

- `npm run e2e -- --grep no-network` / `--grep network` / `--grep smoke` — one group; `HEADED=1 npm run e2e` — with a browser window.
- `npm run e2e:repeat` — every scenario with a problem ×10 without retries and the table «problem — matches of 10» (the cause must match in ≥ 9 of 10).

The e2e tests are run by hand: they need Docker and Chromium.

## Permissions

- `contextMenus` — the **Test stream** item;
- `activeTab`, `scripting` — to pass the menu click and the toolbar button to the page;
- `storage` — the panel's mode and the summary of the previous run per site (no addresses, no SDP);
- host permissions — `https://*/*`, `http://*/`, `http://localhost/*`, `http://127.0.0.1/*`.

The extension makes no network requests of its own: no server, no analytics, no web fonts.

## Chrome Web Store

`store/` holds what the store's dashboard asks for: the package ZIP, the icon, the screenshots, the promo tile, the texts of the listing and of the privacy tab, and the privacy policy — see [store/README.md](store/README.md). After `npm run build`, `npm run store:assets` makes the ZIP and the images again.

## License

MIT — see [LICENSE](LICENSE).
