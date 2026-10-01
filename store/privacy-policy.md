# StreamTest — Privacy Policy

Effective: September 25, 2026

StreamTest is a Chrome extension by ForaSoft (www.forasoft.com) that diagnoses the quality of a WebRTC video stream in the browser. This policy describes what the extension reads, what it keeps and what it shares.

## What StreamTest reads

Only after you pick a video with “Test stream”, and only on the page where you picked it:

- the WebRTC statistics of the connection that feeds that video (`getStats()`: bitrate, packets, frames, delays, codecs, the addresses of the connection's candidates) and its session descriptions (SDP);
- the timing of the video's frames, and how long the page's main thread was blocked.

StreamTest does not read the page's text, your camera or microphone, the video or audio itself, cookies, passwords or browsing history.

## Where the data goes

Nowhere. The data of a test stays in the memory of the page where it runs and is gone when you leave that page. StreamTest has no server, no analytics and no tracking, and makes no network requests of its own.

## What StreamTest keeps

In the browser's local extension storage (`chrome.storage.local`), on your device only:

- the panel size you chose (mini, compact or expanded);
- for each site, a short summary of the previous test run on it: start time, duration, verdict, seconds of degradation, number of freezes, 95th-percentile delay and packet loss, median bitrate. No addresses, media or page content.

Removing the extension deletes this storage.

## Files you export

Export JSON, Export CSV, Download logs and Copy summary create files or text on your device only when you click them. An exported JSON file contains the connection's details, including network addresses and SDP. You decide whether to share these files and with whom.

## Permissions

- `contextMenus` — the “Test stream” menu item.
- `activeTab`, `scripting` — to pass your click on the toolbar button or on the menu item to the panel in the current tab.
- `storage` — the panel size and the previous-run summary described above.
- Access to HTTPS sites, `http://localhost` and `http://127.0.0.1` — to find the WebRTC connection of the video you pick on the site where you test it.

## Sharing and sale

ForaSoft does not collect, sell or transfer any user data, because StreamTest sends none.

## Changes

A change to this policy will be published on this page with a new effective date.

## Contact

ForaSoft — www.forasoft.com — info@forasoft.com
