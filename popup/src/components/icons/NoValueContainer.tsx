// What the tiles and codecs show instead of a value they do not have, with the reason as a tooltip.
import React from "react";
import styles from "../stream-info/index.module.css";
import { ExclamationIcon } from "./statIcons/Exclamation";
import { Tooltip } from "./Tooltip";

interface NoValueContainerProps {
  errorText: string,
}

// A codec without a value: a red ! icon with the error text as the tooltip.
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
