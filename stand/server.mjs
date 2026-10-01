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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/net" && req.method === "GET") {
      return json(res, 200, shaper.state());
    }
    if (url.pathname === "/api/net" && req.method === "POST") {
      const state = shaper.set(await readJson(req));
      log(`network: ${describe(state.params)}`);
      return json(res, 200, state);
    }
    if (url.pathname === "/api/net/second" && req.method === "GET") {
      return json(res, 200, shaper2.state());
    }
    if (url.pathname === "/api/net/second" && req.method === "POST") {
      const state = shaper2.set(await readJson(req));
      log(`network of the 2nd stream: ${describe(state.params)}`);
      return json(res, 200, state);
    }
    if (url.pathname === "/api/net/clear" && req.method === "POST") {
      log("network: clean");
      shaper2.clear();
      return json(res, 200, shaper.clear());
    }
    if (url.pathname === "/api/turn" && req.method === "GET") {
      return json(res, 200, {
        up: await isTurnUp(), host: TURN_HOST, port: TURN_PORT, shaperPort: SHAPER_PORT, shaper2Port: SHAPER2_PORT,
      });
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(res, 405, { error: "method not allowed" });
    }
    return serveStatic(url.pathname, res);
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
});

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

function json(res, status, body) {
  res.writeHead(status, { "content-type": MIME[".json"], "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

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

const shutdown = () => {
  shaper.close();
  shaper2.close();
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
