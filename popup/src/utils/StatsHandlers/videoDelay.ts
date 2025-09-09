import { Goodness, ProcessProperty } from "../../types/State";
import { calculateGoodness } from "../calculateGoodness";

const LOWER_BOUND = 300;
const UPPER_BOUND = 1000;

interface IProps {
  audioDelay: number;
  videoDelay: number;
}

export const videoDelayHandler: ProcessProperty<IProps> = ({
  audioDelay,
  videoDelay,
}) => {
  const goodness = (
    Math.max(audioDelay, videoDelay) - Math.min(audioDelay, videoDelay) > 500
  ) ? Goodness.Bad
    : calculateGoodness(audioDelay, LOWER_BOUND, UPPER_BOUND, "descending");

  return {
    value: `${videoDelay.toFixed(1)} ms`,
    goodness,
  };
};
