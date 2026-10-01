// Value formats of PRD §7: thousands separated by a narrow space, decimal point.
import { groupThousands } from "../../../shared/format";


// 30.0 fps
export const formatFps = (fps: number): string => `${fps.toFixed(1)} fps`;

// 138 ms
export const formatMs = (ms: number): string => `${Math.round(ms)} ms`;

// 0.21 %
export const formatPct = (pct: number): string => `${pct.toFixed(2)} %`;

// 1 546 kbps
export const formatKbps = (kbps: number): string => `${groupThousands(kbps)} kbps`;

// 1280×720
export const formatResolution = (width: number, height: number): string => `${width}×${height}`;
