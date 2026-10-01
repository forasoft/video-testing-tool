// StreamTest stand: a loopback WebRTC call in one page with switches that
// reproduce the problems StreamTest must detect, plus an independent "Truth"
// readout of getStats() to compare the extension's numbers against.

const $ = (id) => document.getElementById(id);

const ui = {
  extBadge: $("extBadge"),
  turnBadge: $("turnBadge"),
  netBadge: $("netBadge"),
  callBadge: $("callBadge"),
  clock: $("clock"),
  resolution: $("resolution"),
  fps: $("fps"),
  codec: $("codec"),
  route: $("route"),
  preset: $("preset"),
  twoWay: $("twoWay"),
  autoStart: $("autoStart"),
  startBtn: $("startBtn"),
  stopBtn: $("stopBtn"),
  testBtn: $("testBtn"),
  jankBtn: $("jankBtn"),
  cpuBtn: $("cpuBtn"),
  freezeBtn: $("freezeBtn"),
  pauseBtn: $("pauseBtn"),
  hideBtn: $("hideBtn"),
  closeBtn: $("closeBtn"),
  secondBtn: $("secondBtn"),
  capBitrate: $("capBitrate"),
  layer: $("layer"),
  relayBtn: $("relayBtn"),
  netTarget: $("netTarget"),
  netButtons: $("netButtons"),
  remoteVideo: $("remoteVideo"),
  localVideo: $("localVideo"),
  returnVideo: $("returnVideo"),
  secondCard: $("secondCard"),
  secondVideo: $("secondVideo"),
  log: $("log"),
  truth: $("truth"),
  dumpBtn: $("dumpBtn"),
};

const TURN_AUTH = { username: "stand", credential: "stand" };
// Ports of coturn and of the shaping proxies as the stand's server reports them (/api/turn): a stand started on
// other ports (SHAPER_PORT, SHAPER2_PORT) shapes only its own calls.
const turnPorts = { turn: 3478, shaper: 3479, shaper2: 3480 };
const ROUTES = {
  direct: () => ({}),
  // UDP goes through the stand's shaping proxy (udp/3479) in front of coturn (3478).
  "turn-udp": () => ({
    iceServers: [{ urls: `turn:127.0.0.1:${turnPorts.shaper}?transport=udp`, ...TURN_AUTH }],
    iceTransportPolicy: "relay",
  }),
  "turn-tcp": () => ({
    iceServers: [{ urls: `turn:127.0.0.1:${turnPorts.turn}?transport=tcp`, ...TURN_AUTH }],
    iceTransportPolicy: "relay",
  }),
};
// On the TURN udp route the 2nd stream goes through a shaper of its own (udp/3480), so that its network can be
// spoiled while the call's stays clean.
const SECOND_TURN_UDP = () => ({
  iceServers: [{ urls: `turn:127.0.0.1:${turnPorts.shaper2}?transport=udp`, ...TURN_AUTH }],
  iceTransportPolicy: "relay",
});
// Where network presets go: the call's shaper or the 2nd stream's.
const NET_API = { call: "/api/net", second: "/api/net/second" };
const RESOLUTIONS = { 360: [640, 360], 720: [1280, 720], 1080: [1920, 1080] };

const NET_PRESETS = {
  clean: { label: "Clean", params: {} },
  loss5: { label: "Loss 5 %", params: { lossPct: 5 } },
  loss20: { label: "Loss 20 %", params: { lossPct: 20 } },
  jitter: { label: "Jitter 80±60 ms", params: { delayMs: 80, jitterMs: 60 } },
  throttle300: { label: "Throttle 300 kbit", params: { rateKbit: 300, queueMs: 300 }, durationMs: 10_000 },
  blackout3: { label: "Blackout", params: { blackout: true }, durationMs: 3_000 },
  blackout8: { label: "Blackout", params: { blackout: true }, durationMs: 8_000 },
  blackout40: { label: "Blackout", params: { blackout: true }, durationMs: 40_000 },
};

let call = null;
let second = null;
let cpuWorkers = [];
// The timer that ends a preset with a duration, per target.
const netTimers = { call: null, second: null };
let turnUp = false;

// ---------------------------------------------------------------- log & clock

function elapsed() {
  if (!call) return "0:00";
  const s = Math.floor((performance.now() - call.startedAt) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function log(text) {
  const item = document.createElement("li");
  const time = document.createElement("time");
  time.textContent = elapsed();
  item.append(time, text);
  ui.log.append(item);
  while (ui.log.children.length > 300) ui.log.firstElementChild.remove();
  ui.log.scrollTop = ui.log.scrollHeight;
}

setInterval(() => {
  ui.clock.textContent = elapsed();
}, 250);

function setBadge(el, text, tone) {
  el.textContent = text;
  el.className = `badge${tone ? ` ${tone}` : ""}`;
}

// ---------------------------------------------------------------- media sources

class CanvasSource {
  constructor({ width, height, fps, label, hue }) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d");
    this.fps = fps;
    this.label = label;
    this.hue = hue;
    this.frame = 0;
    this.frozenUntil = 0;
    this.startedAt = performance.now();
    this.stream = this.canvas.captureStream(fps);
    this.track = this.stream.getVideoTracks()[0];
    this.timer = null;
  }

  start() {
    this.draw();
    // Timers keep drawing (at ~1 fps) while the tab is hidden; requestAnimationFrame would stop.
    this.timer = setInterval(() => this.draw(), 1000 / this.fps);
  }

  freeze(ms) {
    this.frozenUntil = performance.now() + ms;
  }

  draw() {
    const now = performance.now();
    if (now < this.frozenUntil) return; // canvas unchanged → captureStream sends no frames
    const { ctx } = this;
    const { width: w, height: h } = this.canvas;
    const t = (now - this.startedAt) / 1000;
    this.frame += 1;

    ctx.fillStyle = `hsl(${this.hue} 45% 22%)`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = `hsl(${this.hue} 70% 55%)`;
    const barX = ((t * 0.25) % 1) * (w + w * 0.2) - w * 0.2;
    ctx.fillRect(barX, 0, w * 0.2, h);
    ctx.beginPath();
    ctx.arc(w / 2 + Math.cos(t * 2) * w * 0.3, h / 2 + Math.sin(t * 2) * h * 0.3, h * 0.06, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "top";
    ctx.font = `600 ${Math.round(h * 0.16)}px ui-monospace, Menlo, monospace`;
    const min = Math.floor(t / 60);
    const sec = (t % 60).toFixed(3).padStart(6, "0");
    ctx.fillText(`${min}:${sec}`, w * 0.05, h * 0.08);
    ctx.font = `${Math.round(h * 0.06)}px ui-monospace, Menlo, monospace`;
    ctx.fillText(`frame ${this.frame}`, w * 0.05, h * 0.3);
    ctx.fillText(`${this.label} · ${w}×${h} · ${this.fps} fps`, w * 0.05, h * 0.86);
  }

  stop() {
    clearInterval(this.timer);
    this.track.stop();
  }
}

function createTone() {
  const ctx = new AudioContext();
  const destination = ctx.createMediaStreamDestination();
  const hum = ctx.createOscillator();
  const humGain = ctx.createGain();
  hum.frequency.value = 220;
  humGain.gain.value = 0.05;
  hum.connect(humGain).connect(destination);
  const beep = ctx.createOscillator();
  const beepGain = ctx.createGain();
  beep.frequency.value = 880;
  beepGain.gain.value = 0;
  beep.connect(beepGain).connect(destination);
  hum.start();
  beep.start();
  const timer = setInterval(() => {
    const at = ctx.currentTime;
    beepGain.gain.setValueAtTime(0.25, at);
    beepGain.gain.setValueAtTime(0, at + 0.1);
  }, 1000);
  return {
    track: destination.stream.getAudioTracks()[0],
    stop() {
      clearInterval(timer);
      ctx.close();
    },
  };
}

// ---------------------------------------------------------------- signalling

// Candidates are held until the other side has a remote description with the
// same ICE ufrag, so trickling survives ICE restarts.
function linkIce(from, to) {
  let pending = [];
  const matches = (candidate) =>
    to.remoteDescription &&
    (!candidate.usernameFragment || to.remoteDescription.sdp.includes(`a=ice-ufrag:${candidate.usernameFragment}`));
  const flush = () => {
    if (to.signalingState === "closed") return;
    const ready = pending.filter(matches);
    pending = pending.filter((candidate) => !matches(candidate));
    ready.forEach((candidate) => to.addIceCandidate(candidate).catch(() => {}));
  };
  from.addEventListener("icecandidate", (event) => {
    if (!event.candidate) return;
    pending.push(event.candidate);
    flush();
  });
  return flush;
}

function connectPair(offerer, answerer, beforeAnswer) {
  const flushToAnswerer = linkIce(offerer, answerer);
  const flushToOfferer = linkIce(answerer, offerer);
  const state = { busy: false, again: false };

  const negotiate = async () => {
    if (state.busy) {
      state.again = true;
      return;
    }
    state.busy = true;
    try {
      await offerer.setLocalDescription(await offerer.createOffer());
      await answerer.setRemoteDescription(offerer.localDescription);
      flushToAnswerer();
      if (beforeAnswer) await beforeAnswer();
      await answerer.setLocalDescription(await answerer.createAnswer());
      await offerer.setRemoteDescription(answerer.localDescription);
      flushToOfferer();
    } catch (err) {
      if (offerer.signalingState !== "closed") log(`Negotiation failed: ${err.message}`);
    } finally {
      state.busy = false;
      if (state.again) {
        state.again = false;
        negotiate();
      }
    }
  };
  offerer.addEventListener("negotiationneeded", negotiate);
}

function applyCodecPreference(transceiver, codec) {
  const caps = RTCRtpReceiver.getCapabilities && RTCRtpReceiver.getCapabilities("video");
  if (!caps) return;
  const mime = `video/${codec}`.toLowerCase();
  const preferred = caps.codecs.filter((c) => c.mimeType.toLowerCase() === mime);
  if (!preferred.length) {
    log(`${codec} is not available in this browser — using the default codec`);
    return;
  }
  transceiver.setCodecPreferences([...preferred, ...caps.codecs.filter((c) => c.mimeType.toLowerCase() !== mime)]);
}

async function updateEncoding(sender, patch, degradationPreference) {
  const params = sender.getParameters();
  if (!params.encodings || !params.encodings.length) params.encodings = [{}];
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete params.encodings[0][key];
    else params.encodings[0][key] = value;
  }
  if (degradationPreference) params.degradationPreference = degradationPreference;
  await sender.setParameters(params);
}

// ---------------------------------------------------------------- the call

function readSettings() {
  return {
    resolution: ui.resolution.value,
    fps: Number(ui.fps.value),
    codec: ui.codec.value,
    route: ui.route.value,
    preset: ui.preset.value,
    twoWay: ui.twoWay.checked,
    autoStart: ui.autoStart.checked,
  };
}

async function startCall() {
  const settings = readSettings();
  if (settings.route !== "direct" && !turnUp) {
    log("TURN is not running — start it with `npm run stand:turn`, or use the Direct route");
    return;
  }

  const [width, height] = RESOLUTIONS[settings.preset === "blurry" ? "1080" : settings.resolution];
  const source = new CanvasSource({ width, height, fps: settings.fps, label: "Sender A", hue: 212 });
  const returnSource = settings.twoWay
    ? new CanvasSource({ width: 640, height: 360, fps: 30, label: "Receiver return", hue: 150 })
    : null;
  const tone = createTone();
  const config = ROUTES[settings.route]();
  const pc1 = new RTCPeerConnection(config);
  const pc2 = new RTCPeerConnection(config);

  call = {
    settings,
    source,
    returnSource,
    tone,
    config,
    pc1,
    pc2,
    startedAt: performance.now(),
    timers: [],
    connected: false,
    desynced: false,
    truthPrev: null,
    lossWindow: { video: [], audio: [] },
  };
  ui.log.replaceChildren();
  log(
    `Start: ${width}×${height}@${settings.fps} ${settings.codec}, route ${settings.route}, preset ${settings.preset}` +
      `${settings.twoWay ? ", two-way" : ""}`,
  );

  // One stream id for audio and video = one sync group (lip sync). Chrome reports estimatedPlayoutTimestamp
  // only for tracks it keeps in sync, so Desync keeps them together too and breaks the sync later.
  const shared = new MediaStream();
  const videoTransceiver = pc1.addTransceiver(settings.preset === "novideo" ? "video" : source.track, {
    direction: settings.twoWay ? "sendrecv" : "sendonly",
    streams: [shared],
  });
  pc1.addTransceiver(tone.track, { direction: "sendonly", streams: [shared] });
  applyCodecPreference(videoTransceiver, settings.codec);
  call.videoSender = videoTransceiver.sender;

  const remote = new MediaStream();
  pc2.addEventListener("track", (event) => {
    remote.addTrack(event.track);
    ui.remoteVideo.srcObject = remote;
  });

  if (returnSource) {
    const back = new MediaStream();
    pc1.addEventListener("track", (event) => {
      if (event.track.kind !== "video") return;
      back.addTrack(event.track);
      ui.returnVideo.srcObject = back;
    });
  }

  connectPair(pc1, pc2, async () => {
    if (!returnSource) return;
    const transceiver = pc2.getTransceivers().find((t) => t.receiver.track.kind === "video");
    if (transceiver && transceiver.sender.track !== returnSource.track) {
      transceiver.direction = "sendrecv";
      await transceiver.sender.replaceTrack(returnSource.track);
      transceiver.sender.setStreams(new MediaStream());
    }
  });

  pc2.addEventListener("connectionstatechange", renderCallState);
  pc2.addEventListener("iceconnectionstatechange", () => {
    log(`Receiver ICE: ${pc2.iceConnectionState}`);
    renderCallState();
    if (!call.connected && ["connected", "completed"].includes(pc2.iceConnectionState)) {
      call.connected = true;
      onConnected();
    }
  });

  if (settings.route === "direct") {
    call.timers.push(
      setTimeout(() => {
        if (call && !call.connected) {
          log(
            "Direct route did not connect in 6 s: host candidates are unreachable " +
              "(a VPN/TUN proxy owns the default route, or mDNS is blocked). Use the TURN udp route.",
          );
        }
      }, 6000),
    );
  }

  ui.localVideo.srcObject = source.stream;
  source.start();
  if (returnSource) returnSource.start();
  call.timers.push(setInterval(updateTruth, 1000));
  setControls(true);
  renderCallState();
}

async function onConnected() {
  const { settings } = call;
  const connectedAt = elapsed();
  log(`Connected in ${connectedAt}`);

  try {
    if (settings.preset === "blurry") {
      call.source.track.contentHint = "detail";
      call.baseMaxBitrate = 250_000;
      await updateEncoding(call.videoSender, { maxBitrate: call.baseMaxBitrate }, "maintain-resolution");
      log("Blurry preset: 1080p capped at 250 kbps, resolution kept");
    }
    await applyCap();
    await applyLayer();
  } catch (err) {
    log(`Could not apply encoder settings: ${err.message}`);
  }

  if (settings.preset === "novideo") {
    log("No video for 6 s: video track is attached 6 s after connect");
    call.timers.push(
      setTimeout(async () => {
        if (!call) return;
        await call.videoSender.replaceTrack(call.source.track);
        log("Video track attached");
      }, 6000),
    );
  }
  if (settings.autoStart) call.timers.push(setTimeout(testThisStream, 500));
}

function stopCall() {
  if (!call) return;
  call.timers.forEach((timer) => {
    clearInterval(timer);
    clearTimeout(timer);
  });
  call.pc1.close();
  call.pc2.close();
  call.source.stop();
  if (call.returnSource) call.returnSource.stop();
  call.tone.stop();
  if (second) toggleSecond();
  Object.keys(netTimers).forEach((target) => {
    clearTimeout(netTimers[target]);
    netTimers[target] = null;
  });
  Promise.all([postNet({}), postNet({}, "second")]).then(() => setBadge(ui.netBadge, "Network: clean"));
  log("Stop");
  call = null;
  [ui.remoteVideo, ui.localVideo, ui.returnVideo].forEach((video) => {
    video.srcObject = null;
  });
  ui.truth.replaceChildren();
  setControls(false);
  renderCallState();
}

function renderCallState() {
  if (!call) {
    setBadge(ui.callBadge, "Idle");
    return;
  }
  const state = call.pc2.connectionState;
  const tone = { connected: "ok", connecting: "warn", new: "warn", disconnected: "bad", failed: "bad", closed: "bad" };
  setBadge(ui.callBadge, `Call: ${state}`, tone[state]);
}

function setControls(active) {
  ui.startBtn.disabled = active;
  ui.stopBtn.disabled = !active;
  ui.testBtn.disabled = !active;
  document.querySelectorAll("[data-needs-call]").forEach((el) => {
    el.disabled = !active;
  });
  [ui.resolution, ui.fps, ui.codec, ui.route, ui.preset, ui.twoWay, ui.autoStart].forEach((el) => {
    el.disabled = active;
  });
  if (!active) {
    ui.capBitrate.value = "0";
    ui.layer.value = "1";
  }
}

// ---------------------------------------------------------------- StreamTest

function testThisStream() {
  const rect = ui.remoteVideo.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  // The extension remembers the last right-click position and, on its menu item,
  // receives VTT_CONTEXT_BTN_CLICK via window.postMessage. Reproduce both.
  ui.remoteVideo.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY }));
  window.postMessage({ id: "VTT_CONTEXT_BTN_CLICK" }, "*");
  log(window.__vtt ? "Test this stream → sent to StreamTest" : "Test this stream: StreamTest extension not detected");
}

function detectExtension(attempt = 0) {
  if (window.__vtt) {
    setBadge(ui.extBadge, `StreamTest ${window.__vtt.version}`, "ok");
  } else if (attempt < 20) {
    setTimeout(() => detectExtension(attempt + 1), 500);
  } else {
    setBadge(ui.extBadge, "StreamTest extension not detected", "warn");
  }
}

// ---------------------------------------------------------------- scenarios

function jank() {
  log("Jank 400 ms");
  const until = performance.now() + 400;
  while (performance.now() < until) {
    // Busy loop on purpose: blocks the main thread like heavy page JavaScript.
  }
}

function toggleCpuBurn() {
  if (cpuWorkers.length) {
    cpuWorkers.forEach((worker) => worker.terminate());
    cpuWorkers = [];
    ui.cpuBtn.textContent = "CPU burn: off";
    ui.cpuBtn.setAttribute("aria-pressed", "false");
    log("CPU burn off");
    return;
  }
  const url = URL.createObjectURL(new Blob(["for (;;) {}"], { type: "text/javascript" }));
  const count = navigator.hardwareConcurrency || 4;
  cpuWorkers = Array.from({ length: count }, () => new Worker(url));
  URL.revokeObjectURL(url);
  ui.cpuBtn.textContent = `CPU burn: ${count} workers`;
  ui.cpuBtn.setAttribute("aria-pressed", "true");
  log(`CPU burn on (${count} workers)`);
}

async function applyCap() {
  if (!call || !call.connected) return;
  const kbps = Number(ui.capBitrate.value);
  // "off" returns to the preset's own cap (Blurry keeps 250 kbps), otherwise no cap.
  await updateEncoding(call.videoSender, { maxBitrate: kbps ? kbps * 1000 : call.baseMaxBitrate || null });
  if (kbps || call.capWasSet) log(kbps ? `Cap bitrate ${kbps} kbps` : "Cap bitrate off");
  call.capWasSet = Boolean(kbps);
}

async function applyLayer() {
  if (!call || !call.connected) return;
  const factor = Number(ui.layer.value);
  await updateEncoding(call.videoSender, { scaleResolutionDownBy: factor });
  if (factor !== 1 || call.layerWasSet) log(`Layer ${ui.layer.selectedOptions[0].textContent} (scale 1/${factor})`);
  call.layerWasSet = factor !== 1;
}

function freezeSource() {
  call.source.freeze(3000);
  log("Freeze source 3 s");
}

function pauseVideo() {
  ui.remoteVideo.pause();
  log("Pause video 3 s");
  call.timers.push(
    setTimeout(() => {
      ui.remoteVideo.play().catch(() => {});
      log("Video resumed");
    }, 3000),
  );
}

function hideTab() {
  log("Hide tab 10 s");
  window.open("hide.html", "_blank");
}

function closeReceiver() {
  call.pc2.close();
  log("Receiver PC closed");
  renderCallState();
}

async function toggleSecond() {
  if (second) {
    second.a.close();
    second.b.close();
    second.source.stop();
    ui.secondVideo.srcObject = null;
    ui.secondCard.hidden = true;
    ui.secondBtn.textContent = "Add 2nd stream";
    second = null;
    clearTimeout(netTimers.second);
    netTimers.second = null;
    postNet({}, "second");
    log("2nd stream removed");
    return;
  }
  const source = new CanvasSource({ width: 640, height: 360, fps: 30, label: "Stream 2", hue: 28 });
  const config = call && call.settings.route === "turn-udp" ? SECOND_TURN_UDP() : call ? call.config : {};
  const a = new RTCPeerConnection(config);
  const b = new RTCPeerConnection(config);
  const remote = new MediaStream();
  b.addEventListener("track", (event) => {
    remote.addTrack(event.track);
    ui.secondVideo.srcObject = remote;
  });
  connectPair(a, b);
  a.addTransceiver(source.track, { direction: "sendonly", streams: [new MediaStream()] });
  source.start();
  second = { a, b, source, truthPrev: null, lossWindow: [] };
  ui.secondCard.hidden = false;
  ui.secondBtn.textContent = "Remove 2nd stream";
  log("2nd stream added");
}

// ---------------------------------------------------------------- network

async function postNet(params, target = "call") {
  try {
    const res = await fetch(NET_API[target], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// target — "call" (the call's shaper) or "second" (the 2nd stream's), by default what "Presets apply to" says.
async function applyNetPreset(name, target = ui.netTarget.value) {
  const preset = NET_PRESETS[name];
  const throughTurn = call && call.settings.route === "turn-udp" && (target === "second" ? Boolean(second) : !call.switchedToTcp);
  if (!throughTurn) {
    log(
      target === "second"
        ? "Note: no 2nd stream on the shaped TURN route — the preset has no effect yet"
        : "Note: the call does not go through the shaped TURN route — the preset has no effect on it",
    );
  }
  clearTimeout(netTimers[target]);
  netTimers[target] = null;
  if (!(await postNet(preset.params, target))) {
    log("Network preset failed: the stand server is not reachable");
    return;
  }
  const label = preset.durationMs ? `${preset.label} ${preset.durationMs / 1000} s` : preset.label;
  const network = target === "second" ? "Network of the 2nd stream" : "Network";
  log(`${network}: ${label}`);
  setBadge(ui.netBadge, `${network}: ${label}`, name === "clean" ? "" : "warn");
  if (preset.durationMs) {
    netTimers[target] = setTimeout(async () => {
      await postNet({}, target);
      log(`${network}: clean (end of ${label})`);
      setBadge(ui.netBadge, "Network: clean");
      netTimers[target] = null;
    }, preset.durationMs);
  }
}

// Chrome keeps a working candidate pair: after an ICE restart the new pairs are not even checked
// while the old path works, and UDP between two peers of one machine cannot be cut from the page.
// So the path change is "UDP blocked": ICE restarts on TURN over TCP, and the shaper drops UDP until
// the old path's consent has expired (30 s) — otherwise the call moves back to it.
const UDP_BLOCK_MS = 35_000;

async function switchToTcpRelay() {
  if (!turnUp) {
    log("TURN is not running — start it with `npm run stand:turn`");
    return;
  }
  if (call.settings.route !== "turn-udp" || call.switchedToTcp) {
    log("Block UDP → relay tcp needs a call on the TURN udp route: only its UDP goes through the stand");
    return;
  }
  const config = ROUTES["turn-tcp"]();
  call.pc1.setConfiguration(config);
  call.pc2.setConfiguration(config);
  call.switchedToTcp = true;
  call.pc1.restartIce();
  clearTimeout(netTimers.call);
  if (!(await postNet({ blackout: true }))) {
    log("Block UDP failed: the stand server is not reachable");
    return;
  }
  log(`Block UDP → relay tcp: ICE restart on TURN tcp, UDP dropped for ${UDP_BLOCK_MS / 1000} s`);
  setBadge(ui.netBadge, "Network: UDP blocked", "warn");
  netTimers.call = setTimeout(async () => {
    await postNet({});
    log("Network: UDP back (the call stays on TCP)");
    setBadge(ui.netBadge, "Network: clean");
    netTimers.call = null;
  }, UDP_BLOCK_MS);
}

let routeTouched = false;
ui.route.addEventListener("change", () => {
  routeTouched = true;
});

async function checkTurn() {
  try {
    const res = await fetch("/api/turn");
    const turn = await res.json();
    turnUp = Boolean(turn.up);
    Object.assign(turnPorts, { turn: turn.port, shaper: turn.shaperPort, shaper2: turn.shaper2Port });
  } catch {
    turnUp = false;
  }
  setBadge(ui.turnBadge, turnUp ? "TURN running" : "TURN off — npm run stand:turn", turnUp ? "ok" : "");
  // The TURN route works on any machine and supports network presets, so prefer it when available.
  if (turnUp && !routeTouched && !call && ui.route.value === "direct") ui.route.value = "turn-udp";
}

// ---------------------------------------------------------------- truth

function find(report, type, kind) {
  for (const stat of report.values()) {
    if (stat.type === type && (!kind || stat.kind === kind)) return stat;
  }
  return undefined;
}

function selectedPair(report) {
  const transport = find(report, "transport");
  let pair = transport && report.get(transport.selectedCandidatePairId);
  if (!pair) {
    for (const stat of report.values()) {
      if (stat.type === "candidate-pair" && stat.nominated && stat.state === "succeeded") pair = stat;
    }
  }
  if (!pair) return {};
  return { pair, local: report.get(pair.localCandidateId), remote: report.get(pair.remoteCandidateId) };
}

const rate = (cur, prev, key) =>
  cur && prev && cur[key] !== undefined && prev[key] !== undefined && cur.timestamp > prev.timestamp
    ? ((cur[key] - prev[key]) * 8) / (cur.timestamp - prev.timestamp)
    : undefined;

const perItem = (cur, prev, total, count) => {
  if (!cur || !prev) return undefined;
  const dCount = cur[count] - prev[count];
  return dCount > 0 ? ((cur[total] - prev[total]) / dCount) * 1000 : undefined;
};

function windowLoss(windowArr, cur, prev) {
  if (cur && prev) {
    windowArr.push({ lost: cur.packetsLost - prev.packetsLost, received: cur.packetsReceived - prev.packetsReceived });
    if (windowArr.length > 5) windowArr.shift();
  }
  const lost = windowArr.reduce((sum, s) => sum + s.lost, 0);
  const received = windowArr.reduce((sum, s) => sum + s.received, 0);
  return lost + received > 0 ? (lost / (lost + received)) * 100 : undefined;
}

const fmt = (value, digits = 0, unit = "") =>
  value === undefined || value === null || Number.isNaN(value) ? "—" : `${Number(value).toFixed(digits)}${unit}`;

// Desync: once lip sync works (the receiver reports playout timestamps of both tracks), the video jitter
// buffer target jumps to 1 s — the audio runs ahead until lip sync has delayed it as much (~15 s).
const DESYNC_MS = 1000;

function desync(current) {
  current.desynced = true;
  const receiver = current.pc2.getReceivers().find((r) => r.track.kind === "video");
  if (!receiver) return;
  if ("jitterBufferTarget" in receiver) receiver.jitterBufferTarget = DESYNC_MS;
  else receiver.playoutDelayHint = DESYNC_MS / 1000;
  log(`Desync: video jitter buffer +${DESYNC_MS / 1000} s — audio runs ahead until lip sync catches up`);
}

const playoutOffset = (aIn, vIn) =>
  aIn && vIn && aIn.estimatedPlayoutTimestamp && vIn.estimatedPlayoutTimestamp
    ? aIn.estimatedPlayoutTimestamp - vIn.estimatedPlayoutTimestamp
    : undefined;

async function updateTruth() {
  const current = call;
  if (!current || current.pc2.signalingState === "closed") return;
  let rx;
  let tx;
  const other = second;
  let rx2 = null;
  try {
    [rx, tx, rx2] = await Promise.all([current.pc2.getStats(), current.pc1.getStats(), other ? other.b.getStats() : null]);
  } catch {
    return;
  }
  if (current !== call) return;

  const now = {
    vIn: find(rx, "inbound-rtp", "video"),
    aIn: find(rx, "inbound-rtp", "audio"),
    vOut: find(tx, "outbound-rtp", "video"),
    rOut: find(rx, "outbound-rtp", "video"),
    ...selectedPair(rx),
  };
  const prev = current.truthPrev || {};
  current.truthPrev = now;

  const { vIn, aIn, vOut, rOut, pair, local, remote } = now;
  if (current.settings.preset === "desync" && !current.desynced && playoutOffset(aIn, vIn) !== undefined) desync(current);
  const codec = vIn && rx.get(vIn.codecId);
  const concealed =
    aIn && prev.aIn && aIn.totalSamplesReceived - prev.aIn.totalSamplesReceived > 0
      ? ((aIn.concealedSamples - prev.aIn.concealedSamples) / (aIn.totalSamplesReceived - prev.aIn.totalSamplesReceived)) * 100
      : undefined;
  const path =
    local && remote
      ? `${local.candidateType}→${remote.candidateType} · ${local.relayProtocol || local.protocol}`
      : "—";

  const rows = [
    ["Receiver · incoming video"],
    ["Bitrate", fmt(rate(vIn, prev.vIn, "bytesReceived"), 0, " kbps")],
    ["Frame rate (framesPerSecond)", fmt(vIn && vIn.framesPerSecond, 1, " fps")],
    ["Resolution", vIn && vIn.frameWidth ? `${vIn.frameWidth}×${vIn.frameHeight}` : "—"],
    ["Packet loss (5 s)", fmt(windowLoss(current.lossWindow.video, vIn, prev.vIn), 2, " %")],
    ["Jitter", fmt(vIn && vIn.jitter * 1000, 0, " ms")],
    ["Jitter buffer", fmt(perItem(vIn, prev.vIn, "jitterBufferDelay", "jitterBufferEmittedCount"), 0, " ms")],
    ["Freezes (decoder)", vIn ? `${vIn.freezeCount ?? 0} · ${fmt(vIn.totalFreezesDuration, 1, " s")}` : "—"],
    ["Codec", codec ? codec.mimeType.replace("video/", "") : "—"],
    ["Decoder", (vIn && vIn.decoderImplementation) || "—"],
    ["Receiver · incoming audio"],
    ["Bitrate", fmt(rate(aIn, prev.aIn, "bytesReceived"), 0, " kbps")],
    ["Packet loss (5 s)", fmt(windowLoss(current.lossWindow.audio, aIn, prev.aIn), 2, " %")],
    ["Concealed", fmt(concealed, 1, " %")],
    ["A/V offset (audio − video)", fmt(playoutOffset(aIn, vIn), 0, " ms")],
    ["Connection"],
    ["ICE state", current.pc2.iceConnectionState],
    ["Path", path],
    ["RTT", fmt(pair && pair.currentRoundTripTime * 1000, 0, " ms")],
    ["Channel estimate", fmt(pair && pair.availableIncomingBitrate / 1000, 0, " kbps")],
    ["Sender A · outgoing video"],
    ["Bitrate", fmt(rate(vOut, prev.vOut, "bytesSent"), 0, " kbps")],
    ["Target", fmt(vOut && vOut.targetBitrate / 1000, 0, " kbps")],
    ["Resolution", vOut && vOut.frameWidth ? `${vOut.frameWidth}×${vOut.frameHeight}` : "—"],
    ["Limited by", (vOut && vOut.qualityLimitationReason) || "—"],
    ["Encoder", (vOut && vOut.encoderImplementation) || "—"],
  ];
  if (current.settings.twoWay) {
    rows.push(
      ["Receiver · outgoing video (two-way)"],
      ["Bitrate", fmt(rate(rOut, prev.rOut, "bytesSent"), 0, " kbps")],
      ["Limited by", (rOut && rOut.qualityLimitationReason) || "—"],
    );
  }
  if (other && rx2 && other === second) {
    const in2 = find(rx2, "inbound-rtp", "video");
    const prev2 = other.truthPrev;
    other.truthPrev = in2;
    rows.push(
      ["Stream 2 · incoming video"],
      ["Bitrate", fmt(rate(in2, prev2, "bytesReceived"), 0, " kbps")],
      ["Resolution", in2 && in2.frameWidth ? `${in2.frameWidth}×${in2.frameHeight}` : "—"],
      ["Packet loss (5 s)", fmt(windowLoss(other.lossWindow, in2, prev2), 2, " %")],
      ["Freezes (decoder)", in2 ? `${in2.freezeCount ?? 0} · ${fmt(in2.totalFreezesDuration, 1, " s")}` : "—"],
    );
  }
  renderTruth(rows);
}

function renderTruth(rows) {
  const body = rows.map(([label, value]) => {
    const tr = document.createElement("tr");
    if (value === undefined) {
      const th = document.createElement("th");
      th.colSpan = 2;
      th.textContent = label;
      tr.append(th);
    } else {
      const name = document.createElement("td");
      const val = document.createElement("td");
      name.textContent = label;
      val.textContent = value;
      tr.append(name, val);
    }
    return tr;
  });
  ui.truth.replaceChildren(...body);
}

async function dumpStats() {
  const [rx, tx] = await Promise.all([call.pc2.getStats(), call.pc1.getStats()]);
  const data = {
    takenAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    settings: call.settings,
    receiver: [...rx.values()],
    sender: [...tx.values()],
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `getstats_${data.takenAt.replace(/[:.]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  log("getStats dumped");
}

// ---------------------------------------------------------------- wiring

function markUnsupportedCodecs() {
  const caps = RTCRtpReceiver.getCapabilities && RTCRtpReceiver.getCapabilities("video");
  if (!caps) return;
  const available = new Set(caps.codecs.map((c) => c.mimeType.toLowerCase()));
  for (const option of ui.codec.options) {
    if (!available.has(`video/${option.value}`.toLowerCase())) {
      option.disabled = true;
      option.textContent += " (not available)";
    }
  }
}

ui.startBtn.addEventListener("click", startCall);
ui.stopBtn.addEventListener("click", stopCall);
ui.testBtn.addEventListener("click", testThisStream);
ui.jankBtn.addEventListener("click", jank);
ui.cpuBtn.addEventListener("click", toggleCpuBurn);
ui.freezeBtn.addEventListener("click", freezeSource);
ui.pauseBtn.addEventListener("click", pauseVideo);
ui.hideBtn.addEventListener("click", hideTab);
ui.closeBtn.addEventListener("click", closeReceiver);
ui.secondBtn.addEventListener("click", toggleSecond);
ui.capBitrate.addEventListener("change", applyCap);
ui.layer.addEventListener("change", applyLayer);
ui.relayBtn.addEventListener("click", switchToTcpRelay);
ui.dumpBtn.addEventListener("click", dumpStats);
ui.netButtons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-net]");
  if (button) applyNetPreset(button.dataset.net);
});
document.addEventListener("visibilitychange", () => {
  if (call) log(document.hidden ? "Tab hidden" : "Tab visible");
});

markUnsupportedCodecs();
setControls(false);
detectExtension();
checkTurn();
setInterval(checkTurn, 5000);

// Handy for e2e tests and the console.
window.stand = {
  startCall,
  stopCall,
  testThisStream,
  applyNetPreset,
  toggleSecond,
  get call() { return call; },
  get second() { return second; },
};
