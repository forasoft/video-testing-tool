import { ProcessProperty } from "../../types/State";
import { calculateGoodness } from "../calculateGoodness";

interface IProps {
  bitrate: number;
  height: number;
}

const BOUNDS_SETTINGS = [
  {
    HEIGHT: 480,
    LOWER_BOUND: 200,
    UPPER_BOUND: 700,
  },
  {
    HEIGHT: 720,
    LOWER_BOUND: 400,
    UPPER_BOUND: 1200,
  },
  {
    HEIGHT: 1080,
    LOWER_BOUND: 500,
    UPPER_BOUND: 2000,
  },
  {
    HEIGHT: Infinity,
    LOWER_BOUND: 1000,
    UPPER_BOUND: 2000,
  }
];

const BYTES_IN_KBIT = 125;
const MILISEC_IN_SEC = 1000;

export const bitrateHandler: ProcessProperty<IProps> = ({ bitrate, height }) => {
  const kbps = (bitrate * MILISEC_IN_SEC) / BYTES_IN_KBIT;

  // @ts-ignore
  const { LOWER_BOUND, UPPER_BOUND } = BOUNDS_SETTINGS.find((setting) => (
    height < setting.HEIGHT
  ));
  const goodness = calculateGoodness(kbps, LOWER_BOUND, UPPER_BOUND, "ascending");

  return {
    value: `${kbps.toFixed(0)} kbps`,
    goodness,
  };
};
