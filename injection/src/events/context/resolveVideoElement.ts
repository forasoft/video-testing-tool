// Which <video> the tester right-clicked (PRD §16 F1).

// A video hidden with `display: none` is not the one under the cursor.
const isHidden = (element: HTMLElement) =>
  element.style.display === "none";

// Whether the point (clientX, clientY) of a mouse event is inside the element's box.
const includesPoint = (
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

// The first <video> under the point that plays a MediaStream; the children of the elements are searched too.
export const findVideoRecursively = (
  props: IFindProps
): HTMLVideoElement | undefined => {
  const {
    clientX,
    clientY,
    elements = document.getElementsByTagName("video"),
  } = props;

  for (const currentElement of elements) {
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
