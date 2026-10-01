// UDP proxy that sits between the browser and the TURN server and degrades the
// network on demand: random loss, delay with jitter, a rate limit with a bounded
// queue (overflow is dropped, like a real bottleneck) and full blackouts.
//
// The stand points both peer connections at turn:127.0.0.1:<listenPort>; every
// packet of the call, media and TURN control alike, crosses this proxy twice
// (browser → TURN, then TURN → the other browser). Only the TURN → browser leg
// is shaped, so each media stream crosses exactly one degraded hop and a preset
// means the end-to-end value: "loss 5 %" is 5 % loss, "delay 100 ms" is 100 ms
// one way (RTT +200 ms), a rate limit is each browser's downlink.

import dgram from "node:dgram";

// A clean network; `queueMs` matters only with a rate limit.
const DEFAULTS = Object.freeze({
  lossPct: 0,
  delayMs: 0,
  jitterMs: 0,
  rateKbit: 0,
  queueMs: 300,
  blackout: false,
});

// A browser socket silent this long is forgotten, and its socket towards TURN closed.
const CLIENT_IDLE_MS = 60_000;

// A shaper on udp/listenPort in front of the TURN server at targetHost:targetPort. `set` takes a preset, `state` is
// what GET /api/net answers: the preset, packets forwarded and dropped, browser sockets seen.
export function createShapingProxy({ listenPort, targetHost, targetPort, log = () => {} }) {
  let params = { ...DEFAULTS };
  const counters = { forwarded: 0, dropped: 0 };
  const clients = new Map();
  const front = dgram.createSocket("udp4");

  // Browser → TURN: forwarded at once, unshaped.
  front.on("message", (msg, rinfo) => {
    const key = `${rinfo.address}:${rinfo.port}`;
    let client = clients.get(key);
    if (!client) {
      client = createClient(rinfo);
      clients.set(key, client);
    }
    client.lastSeen = Date.now();
    client.upstream.send(msg, targetPort, targetHost);
  });
  front.on("error", (err) => log(`shaper: ${err.message}`));

  // Each browser socket gets a socket of its own towards TURN, which tells its clients apart by their address; what
  // TURN sends to that socket goes back, shaped, to that browser socket.
  function createClient(rinfo) {
    const client = {
      upstream: dgram.createSocket("udp4"),
      fromTurn: { nextFree: 0 },
      lastSeen: Date.now(),
    };
    client.upstream.on("message", (msg) => {
      shape(client.fromTurn, msg, () => front.send(msg, rinfo.port, rinfo.address));
    });
    client.upstream.on("error", (err) => log(`shaper upstream: ${err.message}`));
    return client;
  }

  // Drops the packet (blackout, random loss, a full queue) or sends it after its wait in the queue, the delay and the
  // jitter. The rate limit is a queue per browser socket: `bucket.nextFree` is when its link is free again.
  function shape(bucket, msg, send) {
    if (params.blackout || (params.lossPct > 0 && Math.random() * 100 < params.lossPct)) {
      counters.dropped += 1;
      return;
    }

    const now = performance.now();
    let waitMs = 0;
    if (params.rateKbit > 0) {
      // kbit/s equals bits per millisecond.
      const transmitMs = (msg.length * 8) / params.rateKbit;
      const start = Math.max(now, bucket.nextFree);
      if (start - now > params.queueMs) {
        counters.dropped += 1;
        return;
      }
      bucket.nextFree = start + transmitMs;
      waitMs = bucket.nextFree - now;
    }

    const jitter = params.jitterMs > 0 ? (Math.random() * 2 - 1) * params.jitterMs : 0;
    const totalMs = Math.max(0, waitMs + params.delayMs + jitter);
    counters.forwarded += 1;
    if (totalMs < 1) {
      send();
    } else {
      setTimeout(send, totalMs);
    }
  }

  // Browser sockets of ended calls are forgotten after CLIENT_IDLE_MS.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, client] of clients) {
      if (now - client.lastSeen > CLIENT_IDLE_MS) {
        client.upstream.close();
        clients.delete(key);
      }
    }
  }, CLIENT_IDLE_MS / 2);
  sweep.unref();

  return {
    listen() {
      return new Promise((resolve, reject) => {
        front.once("error", reject);
        front.bind(listenPort, "127.0.0.1", () => {
          front.off("error", reject);
          resolve();
        });
      });
    },
    // A preset replaces the previous one as a whole (a missing field takes its default); rate limit queues restart.
    set(next) {
      params = { ...DEFAULTS, ...sanitize(next) };
      for (const client of clients.values()) client.fromTurn.nextFree = 0;
      return this.state();
    },
    clear() {
      return this.set({});
    },
    state() {
      return { params: { ...params }, counters: { ...counters }, clients: clients.size };
    },
    close() {
      clearInterval(sweep);
      for (const client of clients.values()) client.upstream.close();
      front.close();
    },
  };
}

// The preset's numbers clamped to their ranges; one that is missing or not a number is left out: it takes its default.
function sanitize(input = {}) {
  const num = (value, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
  };
  const out = {
    lossPct: num(input.lossPct, 0, 100),
    delayMs: num(input.delayMs, 0, 5000),
    jitterMs: num(input.jitterMs, 0, 5000),
    rateKbit: num(input.rateKbit, 0, 1_000_000),
    queueMs: num(input.queueMs, 10, 5000),
    blackout: input.blackout === true,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}
