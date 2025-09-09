// internal Video testing tool's data

import registerContextEvents from "src/events/context/register";
import { VTTInternal } from "types/vtt-internal";
import initWrappers from "wrappers";

import { connectionsObserver } from "./utils/connectionsObserver";

const vttInternal: VTTInternal = [];

connectionsObserver(vttInternal);

initWrappers(vttInternal);

// add vttInternal to window for debugging
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(<any>window).vttInternal = vttInternal;

registerContextEvents();

console.log("Video testing tool initialized");


