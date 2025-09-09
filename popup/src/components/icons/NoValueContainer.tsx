import React, { useState } from "react";
import styles from "../stream-info/index.module.css";
import { ExclamationIcon } from "./statIcons/Exclamation";

interface NoValueContainerProps {
  errorText: string,
}

export const NoValueTextContainer: React.FC<NoValueContainerProps> = ({ errorText }) => {
  const [isHovered, setIsHovered] = useState(false);
  const handleHover = () => {
    setIsHovered(true);
  };
  const handleUnhover = () => {
    setIsHovered(false);
  };
  return (
    <div className={styles.iconWrapper} onMouseEnter={handleHover} onMouseLeave={handleUnhover}>
      <ExclamationIcon className={styles.hintIcon} />
      <div className={isHovered ? styles.errorTextContainer : styles.errorTextContainerHidden}>
        {errorText}
      </div>
    </div>
  );
};
