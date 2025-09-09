import { ProcessProperty } from "../../types/State";
import { calculateGoodness } from "../calculateGoodness";

const LOWER_BOUND = 1;
const UPPER_BOUND = 5;

export const packetLossHandler: ProcessProperty<number> = (packetLoss) => {
  const goodness = calculateGoodness(packetLoss, LOWER_BOUND, UPPER_BOUND, "descending");
  return {
    value: `${packetLoss.toFixed(2)}%`,
    goodness,
  };
};
