import React, {
  useLayoutEffect, useRef, useState
} from "react";
import styles from "../stream-info/index.module.css";

interface TooltipProps {
  icon: React.ReactNode;
  text: string;
  visibleClassName: string;
  hiddenClassName: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  icon,
  text,
  visibleClassName,
  hiddenClassName,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  // Where the visible class puts the tooltip, in the viewport.
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const handleHover = () => {
    setIsHovered(true);
  };
  const handleUnhover = () => {
    setIsHovered(false);
    setPlace(null);
  };

  // A tile clips what sticks out of it (overflow: hidden keeps its content in place while the panel
  // resizes): the shown tooltip is fixed at the place its class gives it, so it is drawn whole.
  useLayoutEffect(() => {
    if (isHovered && !place && tooltip.current) {
      const { top, left } = tooltip.current.getBoundingClientRect();
      setPlace({ top, left });
    }
  }, [isHovered, place]);

  return (
    <div
      className={styles.iconWrapper}
      onMouseEnter={handleHover}
      onMouseLeave={handleUnhover}
    >
      {icon}
      <div
        ref={tooltip}
        className={isHovered ? visibleClassName : hiddenClassName}
        style={isHovered && place ? {
          position: "fixed", top: place.top, left: place.left, right: "auto", transform: "none",
        } : undefined}
      >
        {text}
      </div>
    </div>
  );
};
