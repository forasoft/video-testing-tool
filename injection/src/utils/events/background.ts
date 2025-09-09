interface IProps<T> {
  eventId: string;
  handler: (payload: T) => void;
}

const addBackgroundMessageHandler = <T = unknown>(props: IProps<T>) => {
  const { handler, eventId } = props;

  window.addEventListener("message", (event) => {
    if (event.source != window || event.data.id !== eventId) {
      return;
    }
    handler(event.data.payload);
  });
};

export default addBackgroundMessageHandler;
