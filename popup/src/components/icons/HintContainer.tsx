import React from "react";
import styles from "../stream-info/index.module.css";
import { HintIcon } from "./statIcons/Hint";
import { Tooltip } from "./Tooltip";

interface HintIconProps {
  hintText: string,
}

export const HintContainer: React.FC<HintIconProps> = ({ hintText }) => (
  <Tooltip
    icon={<HintIcon className={styles.hintIcon} />}
    text={hintText}
    visibleClassName={styles.hintTextContainer}
    hiddenClassName={styles.hintTextContainerHidden}
  />
);
