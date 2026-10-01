# Chrome Web Store

Everything the [developer dashboard](https://chrome.google.com/webstore/devconsole) asks for when StreamTest is published or updated: the package, the images and the texts to paste.

Published: [StreamTest in the Chrome Web Store](https://chromewebstore.google.com/detail/streamtest/iccaenpebpeacjofjkikdmeejlpeohma), item ID `iccaenpebpeacjofjkikdmeejlpeohma`.

## Files

| File | Dashboard field |
|---|---|
| `streamtest-2.0.0.zip` (not in git) | Package → upload |
| `icon-128.png` | Store listing → Store icon |
| `screenshots/1-compact.png` … `4-report.png` (1280 × 800) | Store listing → Screenshots |
| `promo-440x280.png` | Store listing → Small promo tile |
| `privacy-policy.md` | publish it on the site → Privacy → Privacy policy URL |

The package is `build/` zipped with `manifest.json` at the root. The screenshots are the extension of `build/` on the stand dressed as a video call: a clean 33 s run first (so the Report has Previous run), then a run with Throttle 300 kbit 10 s.

To make them again after a change:

```bash
npm run build
```

```bash
npm run store:assets
```

It needs TURN (`npm run stand:turn`) and Playwright (`npm run e2e:install`), starts a stand of its own on port 8095 (its network presets do not touch a call on the default stand) and takes about 5 minutes. `npm run store:assets -- --zip` makes only the ZIP.

The manifest icons are made from `popup/public/logo512.png`; the 128 px one is 96 × 96 artwork with 16 px of transparent padding, as the store asks:

```bash
cd popup/public && for pair in 16:16 32:30 48:46 128:96; do size=${pair%%:*}; art=${pair##*:}; magick logo512.png -trim +repage -filter Lanczos -resize "${art}x${art}" -background none -gravity center -extent "${size}x${size}" "PNG32:logo${size}.png"; done
```

## Checklist

1. **Account.** Sign in to the dashboard with the company's Google account, accept the developer agreement, pay the one-time registration fee. 2-Step Verification must be on for the account. Contact email: `info@forasoft.com` — the dashboard sends it a confirmation to verify; users see it in the item's contact information. Trader status: **Non-trader** (StreamTest is free); the status can be changed later in the account settings.
2. **Package.** The item exists (ID `iccaenpebpeacjofjkikdmeejlpeohma`): a new version is uploaded to it — see *A later update* below.
3. **Store listing** — the texts below, the icon, the four screenshots, the promo tile.
4. **Privacy** — the texts below; the privacy policy published on the site and its URL.
5. **Distribution** — free, no in-app purchases; visibility Public (or Unlisted to share by link first); all regions.
6. **Test instructions** — the text below: the reviewers cannot open the stand.
7. **Submit for review.** Usually a few days, up to a few weeks: `https://*/*` host permissions get a closer review. With deferred publishing the approved item waits up to 30 days for the Publish button.

A later update: raise `version` in `popup/public/manifest.json` and `package.json`, `npm run build`, `npm run store:assets -- --zip`, then the item → *Package* → *Upload new package* (the version must be higher than the published one; users and reviews stay). Every update is reviewed the same way.

## Store listing

**Title** (from the package): `StreamTest`

**Summary** (from the package, the manifest's `description`, ≤ 132 characters):

```
Check any participant’s WebRTC video stream: live metrics, problems with likely causes, and a report to share.
```

**Description:**

```
StreamTest finds the problems of a WebRTC video stream right in the browser and shows, for each one, what happened, why and what to check.

Right-click a participant's video in a call and choose “Test stream”. The panel shows the stream's metrics live and tells you the moment something goes wrong.

WHAT YOU SEE
• Compact panel: a status line (“No problems” or the problem happening now) and seven metrics with 2-minute sparklines — frame rate, video and audio delay, packet loss, resolution, freezes and bitrate — plus the codecs and the connection type.
• Timeline: bitrate, frame rate, packet loss and delay on one time axis, events (first frame, resolution changes, path changes, a hidden tab, your marks) and every problem as a band across the charts.
• Problem card: when it started and how long it lasted, the numbers before and during it, the likely cause and what to check.
• Report: a verdict (OK, Degraded or Severe, with the seconds of degradation), all problems, percentiles of every metric, other video streams on the page and a comparison with the previous run on the same site.

PROBLEMS IT DETECTS
Bandwidth drop · Video freeze (and where the frames stopped: network, decoder, page or player) · Page jank · Connection path changed · Reconnection · Your upload limited by CPU or bandwidth · Audio stutter · Audio / video out of sync · Blurry picture · Slow start

FOR THE BUG REPORT
• Mark: one click puts a numbered mark on the timeline, to find the moment later.
• Copy summary: the verdict, the problems and the key numbers as text for a ticket.
• Export: JSON with the whole session (per-second samples, events, problems, connection, SDP) or CSV.

PRIVACY
StreamTest works locally. It reads the WebRTC statistics of the stream you pick, keeps the session in the page's memory and sends nothing anywhere. The browser's extension storage keeps only the panel size you chose and a short summary of the previous run per site. Files are saved only when you click Export or Download logs.

Works on HTTPS sites and on http://localhost and http://127.0.0.1 for local development.

For QA engineers, developers and support teams of video calling, streaming and telemedicine products.

Made by ForaSoft — www.forasoft.com · Questions and feedback: info@forasoft.com
```

**Category:** Developer Tools · **Language:** English

**Homepage URL:** `https://www.forasoft.com/`

## Privacy

**Single purpose description:**

```
StreamTest diagnoses the quality of a WebRTC video stream on the current page. The user right-clicks a participant's video and picks “Test stream”; the extension shows live metrics of that stream, detects quality problems (freezes, bandwidth drops, packet loss, delay, reconnections) with their likely causes and builds a report the user can copy or export.
```

**Permission justification:**

`contextMenus`

```
Adds the “Test stream” item to the context menu. The user right-clicks a participant's video and picks this item to choose the stream to diagnose.
```

`activeTab`

```
When the user clicks the toolbar button or the “Test stream” menu item, the extension passes the click to its panel in that tab (show or hide the panel, test the clicked video). activeTab limits this access to the tab the user acted on.
```

`scripting`

```
chrome.scripting.executeScript passes the toolbar-button click and the context-menu click from the service worker to the tab, where the extension's content script handles them. The injected function is part of the package and only posts a message; no code is loaded from anywhere.
```

`storage`

```
chrome.storage.local keeps two things on the user's device: the panel size the user chose (mini, compact or expanded) and a short summary of the previous test run per site (start time, duration, verdict, seconds of degradation, number of freezes, 95th-percentile delay and packet loss, median bitrate), so that the Report can compare two runs. No addresses, media or page content are stored.
```

Host permission (`https://*/*`, `http://*/`, `http://localhost/*`, `http://127.0.0.1/*`)

```
The content script has to be on the page before the user picks a stream: it finds the RTCPeerConnection that feeds the selected <video> and reads its getStats() once a second while the test runs. Video calls run on any site, so the sites cannot be listed in advance; localhost and 127.0.0.1 let developers test their apps locally. The extension reads only the WebRTC statistics of the stream the user picked and sends nothing off the device.
```

**Are you using remote code?** No, I am not using remote code.

**Data usage:** check none of the data types; check all three certifications (no selling or transferring user data, no use unrelated to the single purpose, no creditworthiness or lending).

**Privacy policy URL:** the page where `privacy-policy.md` is published, e.g. on `www.forasoft.com`.

## Test instructions

```
No account or login is needed.

1. Open https://webrtc.github.io/samples/src/content/peerconnection/pc1/ — the WebRTC sample page that calls itself. Click Start (allow the camera; any virtual camera works), then Call.
2. Right-click the right-hand video (the received stream) and choose “Test stream”. The StreamTest panel opens with live metrics; after 5 seconds the status line reads “No problems” with the session time.
3. The chart button in the panel's header opens the Timeline (four charts, events, problems); the Report tab shows the verdict and the percentiles. Mark puts a mark on the timeline; Export saves JSON or CSV.
4. Collapse the panel (the button with two arrows next to ✕), then click Hang up on the sample page: the status line changes to “Stream disconnected”, and the data of the test stays in the panel.
```
