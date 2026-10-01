// Rebuilds the extension into ./build on every source change.
// Runs `webpack --watch` (injection) and `vite build --watch` (popup) and repeats
// the copy step of build.sh whenever either output changes.
// After a rebuild, press ⟳ on the extension card in chrome://extensions.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const popupOut = path.join(root, "popup", "build");
const injectionOut = path.join(root, "injection", "dist");
const buildDir = path.join(root, "build");

const children = [
  run("injection", "npx", ["webpack", "--watch"], path.join(root, "injection")),
  run("popup", "npx", ["vite", "build", "--watch"], path.join(root, "popup")),
];

// Spawns a tool with each line of its output prefixed by `name`; when a tool exits, the whole watch stops.
function run(name, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = (chunk) =>
    chunk
      .toString()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => `[${name}] ${line}`)
      .join("\n");
  child.stdout.on("data", (chunk) => console.log(prefix(chunk)));
  child.stderr.on("data", (chunk) => console.error(prefix(chunk)));
  child.on("exit", (code) => {
    console.error(`[${name}] exited with code ${code}`);
    shutdown(code ?? 1);
  });
  return child;
}

// The copy step of build.sh: build/ is the popup's output plus the injection's bundle as injection.js; nothing is
// copied until both tools have built once.
function copyBuild() {
  const injectionBundle = path.join(injectionOut, "main.js");
  if (!fs.existsSync(path.join(popupOut, "index.html")) || !fs.existsSync(injectionBundle)) {
    return;
  }
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  fs.cpSync(popupOut, buildDir, { recursive: true });
  fs.copyFileSync(injectionBundle, path.join(buildDir, "injection.js"));
  console.log(`[watch] build/ updated at ${new Date().toLocaleTimeString()} — reload the extension`);
}

// Both tools rewrite several files per rebuild (vite also empties its outDir),
// so wait until the output has been quiet for a moment before copying.
let timer = null;
function scheduleCopy() {
  clearTimeout(timer);
  timer = setTimeout(copyBuild, 400);
}

// Watches a tool's output folder; it is created first, as fs.watch needs it before the tool's first build.
const watchers = [];
function watchOutput(dir) {
  fs.mkdirSync(dir, { recursive: true });
  watchers.push(fs.watch(dir, { recursive: true }, scheduleCopy));
}
watchOutput(popupOut);
watchOutput(injectionOut);

// Stops the watchers and the tools still running: on Ctrl+C, or when one of the tools exits.
function shutdown(code = 0) {
  watchers.forEach((watcher) => watcher.close());
  children.forEach((child) => child.exitCode === null && child.kill());
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
