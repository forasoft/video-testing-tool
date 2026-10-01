import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// The unpacked extension that `npm run build` makes.
export const BUILD = path.join(ROOT, "build");
export const STAND_URL = "http://localhost:8080/";
