// Numbers in interface texts (PRD §7): thousands separated by a narrow space, decimal point.
const NARROW_SPACE = "\u202F";

// Rounded to an integer, thousands grouped:
// 1 546
export const groupThousands = (value: number): string =>
  Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_SPACE);

// Seconds from the session start → m:ss (PRD §5).
export const mmss = (t: number): string => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
