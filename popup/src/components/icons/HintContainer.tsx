import React, { useState } from "react";
import styles from "../stream-info/index.module.css";
import { HintIcon } from "./statIcons/Hint";

interface HintIconProps {
  hintText: string,
}

export const HintContainer: React.FC<HintIconProps> = ({ hintText }) => {
  const [isHovered, setIsHovered] = useState(false);
  const handleHover = () => {
    setIsHovered(true);
  };
  const handleUnhover = () => {
    setIsHovered(false);
  };
  return (
    <div className={styles.iconWrapper} onMouseEnter={handleHover} onMouseLeave={handleUnhover}>
      <HintIcon className={styles.hintIcon} />
      <div className={isHovered ? styles.hintTextContainer : styles.hintTextContainerHidden}>
        {hintText}
      </div>
    </div>
  );
};
