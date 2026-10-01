export const isHidden = (element: HTMLElement) =>
  element.style.display === "none";

export const includesPoint = (
  element: HTMLElement,
  clientX: number,
  clientY: number
): boolean => {
  if (isHidden(element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();

  return (
    rect.left <= clientX &&
    clientX <= rect.right &&
    rect.top <= clientY &&
    clientY <= rect.bottom
  );
};

interface IFindProps {
  clientX: number;
  clientY: number;
  elements?: HTMLElement[];
}

export const findVideoRecursively = (
  props: IFindProps
): HTMLVideoElement | undefined => {
  const {
    clientX,
    clientY,
    elements = document.getElementsByTagName("video"),
  } = props;

  for (let i = 0; i != elements.length; ++i) {
    const currentElement = elements[i];
    if (
      currentElement instanceof HTMLVideoElement
      && includesPoint(currentElement, clientX, clientY)
      && currentElement.srcObject !== null
    ) {
      return currentElement;
    }

    const videoElement = findVideoRecursively({
      clientX,
      clientY,
      elements: [].slice.call(currentElement.children),
    });

    if (videoElement) {
      return videoElement;
    }
  }
};
