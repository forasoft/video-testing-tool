# StreamTest stand

A WebRTC call between two peer connections in one page, with buttons that reproduce the problems StreamTest has to detect, and a **Truth** panel that computes the key numbers from `getStats()` independently of the extension — so every task can compare the extension's values with a reference.

## Run

```bash
npm run build          # or `npm run watch` while developing
npm run stand:turn     # once: coturn in Docker, needed for TURN routes and network presets
npm run stand          # http://localhost:8080
```

Load `build/` as an unpacked extension in `chrome://extensions` (⟳ after each rebuild), open http://localhost:8080, press **Start**, then **Test this stream** (or right-click the receiver video → “Test stream”).

Stop TURN with `npm run stand:turn:down`.

## Routes

| Route | Path of the media | Network presets |
|---|---|---|
| **TURN udp (shaped)** — default when TURN is running | browser → shaper (udp/3479) → coturn (3478) → shaper → browser | yes |
| TURN tcp | browser → coturn (tcp/3478) → browser | no |
| Direct | browser ↔ browser, host candidates | no |

**Direct** needs the two peers to reach each other's host candidate. It fails when a VPN or TUN proxy owns the default route (Chrome then offers only the tunnel address, e.g. `198.18.0.1`) or when mDNS `.local` names do not resolve (headless Chromium, some corporate setups). The stand logs a hint after 6 s. Use the TURN udp route, or for automation start Chromium with `--disable-features=WebRtcHideLocalIpsWithMdns`.

## Network presets

The shaper is a small UDP proxy inside `server.mjs`. Every packet of a TURN udp call crosses it twice, and only the TURN → browser leg is degraded, so each media stream crosses exactly one shaped hop and a preset is the end-to-end value:

| Preset | Effect |
|---|---|
| Loss 5 % / 20 % | random loss of that share of packets |
| Jitter 80±60 ms | one-way delay 80 ms ± 60 ms per packet (RTT grows by ~160 ms) |
| Throttle 300 kbit 10 s | each browser's downlink limited to 300 kbit/s with a 300 ms queue; overflow is dropped |
| Blackout 3 / 8 / 40 s | every packet dropped. ICE turns `disconnected` after ~5 s; after 8 s it comes back to `connected`; after 40 s consent has expired and the call stays `disconnected` for good (no ICE restart) |
| Clean | no shaping |

**Presets apply to** picks whose network a preset spoils: *the call* or *the 2nd stream*. On the TURN udp route the 2nd stream (Add 2nd stream) goes through a shaper of its own (udp/3480), so Loss 5 % on it leaves the call clean — the case of Other streams in the Report.

The same controls are available over HTTP for scripts:

```bash
curl -X POST localhost:8080/api/net -H 'content-type: application/json' -d '{"lossPct":5}'
```

`GET /api/net` returns the current parameters and counters, `POST /api/net/clear` removes shaping (of both the call and the 2nd stream), `GET /api/turn` tells whether coturn answers. `GET` / `POST /api/net/second` — the same for the 2nd stream's shaper.

## Scenarios

| Control | What it does |
|---|---|
| Test this stream | starts a StreamTest session on the receiver video — the same `VTT_CONTEXT_BTN_CLICK` message the extension's menu item posts |
| Jank 400 ms | blocks the page's main thread for 400 ms |
| CPU burn | one busy Web Worker per CPU core |
| Freeze source 3 s | the sender stops drawing — no frames are sent for 3 s |
| Pause video 3 s | pauses the receiver `<video>` element |
| Hide tab 10 s | opens a tab that closes itself after 10 s |
| Close receiver PC | `pc.close()` on the receiving side |
| Add 2nd stream | a second call with its own video, for “Other streams”; Truth gets its rows (Stream 2 · incoming video) |
| Cap bitrate / Layer | `maxBitrate` / `scaleResolutionDownBy` on the sender |
| Block UDP → relay tcp | on the TURN udp route: ICE restarts on TURN over TCP and the shaper drops UDP for 35 s, so the selected pair moves to `relay→relay · tcp` (a path change). Chrome keeps a working pair — after an ICE restart alone the new pairs are not even checked — and host UDP between two peers of one machine cannot be cut, so a direct call cannot be moved to relay here |
| Preset: Blurry | 1920×1080 capped at 250 kbps with resolution kept |
| Preset: No video for 6 s | the video track is attached 6 s after the call connects |
| Preset: Desync | audio and video in one stream (Chrome reports `estimatedPlayoutTimestamp` only for tracks it keeps in sync); once both are reported (~10 s after connect), the video jitter buffer target jumps to 1 s — audio runs ~0.85 s ahead, and lip sync takes ~15 s to catch up. Truth shows the A/V offset |
| Two-way call | the receiver also sends video, so its connection has outgoing stats |
| Auto-start StreamTest | presses Test this stream right after the call connects |
| Dump getStats | saves both sides' `RTCStatsReport` as JSON (fixtures for tests) |

`window.stand` in the console exposes `startCall`, `stopCall`, `testThisStream`, `applyNetPreset(name, target)`, `toggleSecond` and the current `call` and `second` for scripts and e2e tests.

## Ports

| Port | Used by | Change with |
|---|---|---|
| 8080/tcp | stand page and API | `STAND_PORT` |
| 3479/udp | network shaper | `SHAPER_PORT` |
| 3480/udp | network shaper of the 2nd stream | `SHAPER2_PORT` |
| 3478/udp+tcp | coturn | `TURN_PORT` and `docker-compose.yml` |
| 49160–65535/udp | coturn relays, inside the container only (not published) | `docker-compose.yml`. The range is wide on purpose: an allocation that a closed browser did not release lives 10 min, and an e2e run starts hundreds of calls |

The page takes these ports from `/api/turn`, so a second stand on other ports (as `npm run store:assets` starts one) shapes only its own calls.

Credentials of the stand TURN server: `stand` / `stand`. It listens on 127.0.0.1 only.
