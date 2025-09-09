import { Goodness } from "../types/State";

export const calculateGoodness = (
  value: number | string,
  lowerBound: number,
  upperBound: number,
  monotonicity: "ascending" | "descending",
) => {
  if (monotonicity === "ascending") {
    if ((value > lowerBound) && (value < upperBound)) {
      return Goodness.Moderate;
    }
    if (value < lowerBound) {
      return Goodness.Bad;
    }
    return Goodness.Good;
  }
  if (value > lowerBound && value < upperBound) {
    return Goodness.Moderate;
  }
  if (value < lowerBound) {
    return Goodness.Good;
  }
  return Goodness.Bad;
};
