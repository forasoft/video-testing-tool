// Before the tests: the extension must be built (npm run build or npm run watch) — the tests load build/.
import fs from "node:fs";
import path from "node:path";
import { BUILD } from "./lib/paths.js";

// Stops the run at once without build/; otherwise prints which build the tests load: its version and build time.
export default async function globalSetup() {
  const manifest = path.join(BUILD, "manifest.json");
  if (!fs.existsSync(manifest) || !fs.existsSync(path.join(BUILD, "injection.js"))) {
    throw new Error(`No extension in ${BUILD}: run \`npm run build\` first`);
  }
  const { version } = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const built = fs.statSync(path.join(BUILD, "injection.js")).mtime;
  console.log(`StreamTest ${version} from build/, built ${built.toLocaleString()}`);
}
