// Problem numbers in the Bitrate row (PRD §11.2): a 14 px circle in the top-left corner of the
// problem's band. Problems that start together (Reconnection and the freeze it causes) would put
// their numbers on top of each other, so a number moves right past the one before it.
export const NUMBER_R = 7;
const GAP = 2;

export interface NumberedBand {
  from: number;
  number?: number;
}

export interface NumberCenter {
  number: number;
  x: number;
  y: number;
}

// Centers of the numbers, px; `x` — the plot's scale.
export const numberCenters = (bands: NumberedBand[], x: (t: number) => number): NumberCenter[] => {
  const numbered = bands
    .filter((band): band is Required<NumberedBand> => band.number !== undefined)
    .sort((a, b) => a.from - b.from || a.number - b.number);
  let previous = -Infinity;
  return numbered.map(({ from, number }) => {
    const center = Math.max(Math.max(0, x(from)) + NUMBER_R + GAP, previous + 2 * NUMBER_R + GAP);
    previous = center;
    return { number, x: center, y: NUMBER_R + GAP };
  });
};
