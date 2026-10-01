// Paths and the URL that the e2e setup, fixtures and tests share.
import path from "node:path";
import { fileURLToPath } from "node:url";

// The project's root, two levels above e2e/lib.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// The unpacked extension that `npm run build` makes.
export const BUILD = path.join(ROOT, "build");
// The stand of `npm run stand`; playwright.config.js starts it if it is not running.
export const STAND_URL = "http://localhost:8080/";
