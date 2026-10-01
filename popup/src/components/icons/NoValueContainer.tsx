import React from "react";
import styles from "../stream-info/index.module.css";
import { ExclamationIcon } from "./statIcons/Exclamation";
import { Tooltip } from "./Tooltip";

interface NoValueContainerProps {
  errorText: string,
}

export const NoValueTextContainer: React.FC<NoValueContainerProps> = ({ errorText }) => (
  <Tooltip
    icon={<ExclamationIcon className={styles.hintIcon} />}
    text={errorText}
    visibleClassName={styles.errorTextContainer}
    hiddenClassName={styles.errorTextContainerHidden}
  />
);

// A tile without data: a gray dash with the tile's error text as the tooltip (PRD §9.2).
export const NoValueTile: React.FC<NoValueContainerProps> = ({ errorText }) => (
  <Tooltip
    icon={<span className={styles.noValue} data-value>—</span>}
    text={errorText}
    visibleClassName={styles.errorTextContainer}
    hiddenClassName={styles.errorTextContainerHidden}
  />
);
