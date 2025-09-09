export enum Goodness {
  Bad = "bad",
  Moderate = "moderate",
  Good = "good",
}

export type ProcessProperty<T> = (property: T) => {
  goodness: Goodness;
  value: string;
};

export enum Properties {
  AverageFps = "averageFps",
  VideoDelay = "videoDelay",
  AudioDelay = "audioDelay",
  PacketLoss = "packetLoss",
  Resolution = "resolution",
  FreezesDuration = "freezesDuration",
  Bitrate = "bitrate",
}
export interface StateData {
  value: string;
  goodness: Goodness;
}
export type StateTypes = {
  [index: string]: StateData | string | boolean;
};
