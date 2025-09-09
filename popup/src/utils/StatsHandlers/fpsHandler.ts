import { ProcessProperty } from "../../types/State";
import { calculateGoodness } from "../calculateGoodness";

const LOWER_BOUND = 10;
const UPPER_BOUND = 20;

export const fpsHandler: ProcessProperty<number> = (fps) => {
  const goodness = calculateGoodness(fps, LOWER_BOUND, UPPER_BOUND, "ascending");
  return {
    value: `${fps.toFixed(1)} fps`,
    goodness,
  };
};
