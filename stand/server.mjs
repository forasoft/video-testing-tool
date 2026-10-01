// StreamTest stand: serves the loopback call page and controls the network shaper.
//
//   npm run stand            → http://localhost:8080
//   npm run stand:turn       → starts coturn in Docker (needed for TURN routes and shaping)
//
// Environment: STAND_PORT (default 8080), SHAPER_PORT (default 3479), SHAPER2_PORT (default 3480), TURN_PORT (default 3478).

import dgram from "node:dgram";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createShapingProxy } from "./lib/shaper.mjs";

const STAND_PORT = Number(process.env.STAND_PORT || 8080);
const SHAPER_PORT = Number(process.env.SHAPER_PORT || 3479);
// The 2nd stream of the stand has a shaper of its own: its network can be spoiled while the call's stays clean.
const SHAPER2_PORT = Number(process.env.SHAPER2_PORT || SHAPER_PORT + 1);
const TURN_PORT = Number(process.env.TURN_PORT || 3478);
const TURN_HOST = "127.0.0.1";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const log = (line) => console.log(`[stand] ${line}`);

// Both shapers forward to coturn: the page points the call at SHAPER_PORT and the 2nd stream at SHAPER2_PORT.
const shaper = createShapingProxy({
  listenPort: SHAPER_PORT,
  targetHost: TURN_HOST,
  targetPort: TURN_PORT,
  log,
});
const shaper2 = createShapingProxy({
  listenPort: SHAPER2_PORT,
  targetHost: TURN_HOST,
  targetPort: TURN_PORT,
  log,
});

// The stand's API by "METHOD path": the network presets of the call's and the 2nd stream's shapers, and TURN.
const API = new Map([
  ["GET /api/net", (req, res) => json(res, 200, shaper.state())],
  ["POST /api/net", async (req, res) => {
    const state = shaper.set(await readJson(req));
    log(`network: ${describe(state.params)}`);
    return json(res, 200, state);
  }],
  ["GET /api/net/second", (req, res) => json(res, 200, shaper2.state())],
  ["POST /api/net/second", async (req, res) => {
    const state = shaper2.set(await readJson(req));
    log(`network of the 2nd stream: ${describe(state.params)}`);
    return json(res, 200, state);
  }],
  ["POST /api/net/clear", (req, res) => {
    log("network: clean");
    shaper2.clear();
    return json(res, 200, shaper.clear());
  }],
  ["GET /api/turn", async (req, res) => json(res, 200, {
    up: await isTurnUp(), host: TURN_HOST, port: TURN_PORT, shaperPort: SHAPER_PORT, shaper2Port: SHAPER2_PORT,
  })],
]);

// The API first, then the files of public/, which only GET and HEAD may ask for.
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const handle = API.get(`${req.method} ${url.pathname}`);
    if (handle) {
      return await handle(req, res);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(res, 405, { error: "method not allowed" });
    }
    return serveStatic(url.pathname, res);
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
});

// A file of public/, never one outside it; not cached, so an edited stand page is picked up on reload.
function serveStatic(pathname, res) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = path.resolve(publicDir, relative);
  if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  fs.createReadStream(file).pipe(res);
}

// A JSON answer, not cached: the shapers' state changes between requests.
function json(res, status, body) {
  res.writeHead(status, { "content-type": MIME[".json"], "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

// The request's JSON body, {} if it is empty; a body over 10 000 characters or one that is not JSON is rejected.
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// A shaper's preset for the log: `loss 5%, delay 80±60 ms`, `blackout` or `clean`.
function describe(p) {
  if (p.blackout) return "blackout";
  const parts = [];
  if (p.lossPct) parts.push(`loss ${p.lossPct}%`);
  if (p.delayMs || p.jitterMs) parts.push(`delay ${p.delayMs}±${p.jitterMs} ms`);
  if (p.rateKbit) parts.push(`rate ${p.rateKbit} kbit/s, queue ${p.queueMs} ms`);
  return parts.join(", ") || "clean";
}

// Sends a STUN Binding Request to the TURN server and waits for any reply.
function isTurnUp(timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const request = Buffer.alloc(20);
    request.writeUInt16BE(0x0001, 0); // Binding Request
    request.writeUInt16BE(0, 2); // no attributes
    request.writeUInt32BE(0x2112a442, 4); // magic cookie
    crypto.randomBytes(12).copy(request, 8);
    const finish = (up) => {
      clearTimeout(timer);
      socket.close();
      resolve(up);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once("message", () => finish(true));
    socket.once("error", () => finish(false));
    socket.send(request, TURN_PORT, TURN_HOST);
  });
}

// The shapers' ports must be free: the TURN udp route goes through them, so without them the stand does not start.
for (const [proxy, port] of [[shaper, SHAPER_PORT], [shaper2, SHAPER2_PORT]]) {
  try {
    await proxy.listen();
  } catch (err) {
    console.error(`[stand] cannot bind the network shaper on udp/${port}: ${err.message}`);
    process.exit(1);
  }
}

server.on("error", (err) => {
  console.error(`[stand] cannot start on http://localhost:${STAND_PORT}: ${err.message}`);
  process.exit(1);
});

server.listen(STAND_PORT, "127.0.0.1", async () => {
  log(`open http://localhost:${STAND_PORT}`);
  log(`network shaper on udp/${SHAPER_PORT} → TURN ${TURN_HOST}:${TURN_PORT}, the 2nd stream's on udp/${SHAPER2_PORT}`);
  log((await isTurnUp()) ? "TURN is running" : "TURN is not running — start it with `npm run stand:turn` for TURN routes and network presets");
});

// Ctrl+C or a stop of the process: the shapers' sockets close, then the server.
const shutdown = () => {
  shaper.close();
  shaper2.close();
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
