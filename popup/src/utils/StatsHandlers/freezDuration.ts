import { ProcessProperty } from "../../types/State";
import { calculateGoodness } from "../calculateGoodness";

const LOWER_BOUND = 2;
const UPPER_BOUND = 5;

export const freezesDurationHandler: ProcessProperty<number> = (freezesDuration) => {
  const goodness = calculateGoodness(freezesDuration, LOWER_BOUND, UPPER_BOUND, "descending");
  return {
    value: `${freezesDuration.toFixed(2)}%`,
    goodness,
  };
};
