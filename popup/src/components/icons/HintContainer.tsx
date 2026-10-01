// The hint beside a Compact tile's label.
import React from "react";
import styles from "../stream-info/index.module.css";
import { HintIcon } from "./statIcons/Hint";
import { Tooltip } from "./Tooltip";

interface HintIconProps {
  hintText: string,
}

// A ? icon whose hint text shows while the pointer is over it.
export const HintContainer: React.FC<HintIconProps> = ({ hintText }) => (
  <Tooltip
    icon={<HintIcon className={styles.hintIcon} />}
    text={hintText}
    visibleClassName={styles.hintTextContainer}
    hiddenClassName={styles.hintTextContainerHidden}
  />
);
