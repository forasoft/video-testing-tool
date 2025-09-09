import { VTTInternal } from "src/types/vtt-internal";

export let vttInternal: VTTInternal | null = null;

export const connectionsObserver = (connections: VTTInternal) => {
    vttInternal = connections;
} 
