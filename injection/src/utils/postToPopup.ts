export const postToPopup = (eventId: string, data: unknown) => {
    (<any>window.frames).vttFrame.postMessage({id: eventId, data}, '*');
};
