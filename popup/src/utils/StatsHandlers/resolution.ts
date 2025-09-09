import { Goodness } from "../../types/State";

export const resolutionHandler = (
  width: number,
  height: number,
  widthUpperBound: number,
  heightUpperBound: number,
) => {
  const resolution = `${width}x${height}`;
  //
  let goodness = null;

  if (width < widthUpperBound / 2 || height < heightUpperBound / 2) {
    goodness = Goodness.Bad;
  }
  if (width >= widthUpperBound && height >= heightUpperBound) {
    goodness = Goodness.Good;
  }
  if (goodness === null) {
    goodness = Goodness.Moderate;
  }

  return {
    value: `${resolution}`,
    goodness,
  };
};
