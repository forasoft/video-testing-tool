export const postToWindow = (eventId: string, data: unknown) => {
  window.parent.postMessage({ id: eventId, data }, "*");
};
