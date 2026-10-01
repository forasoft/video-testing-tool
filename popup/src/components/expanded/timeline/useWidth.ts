import { RefObject, useEffect, useState } from "react";

// Width of an element in whole pixels: charts are drawn in pixels and follow the panel's width.
export const useWidth = (ref: RefObject<HTMLElement>): number => {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
};
