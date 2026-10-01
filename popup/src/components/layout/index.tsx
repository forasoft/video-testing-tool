// The panel's frame inside the iframe: the start screen, Compact / Mini with their footer, or Expanded. It reports
// its height to main.js, which sizes the iframe to it.
import React, {
  useCallback, useContext, useEffect, useRef, useState
} from "react";
import { CONST } from "../../CONST/const";
import { DisplayContext } from "../../context/DisplayContext";
import { answerPerf } from "../../utils/perf";
import { onPageMessage, postToWindow } from "../../utils/page";
import { BackToPrevIcon } from "../icons/backToPrevIcon";
import { ButtonTip } from "../icons/ButtonTip";
import { ForaSoftLogo } from "../icons/logo/ForaSoft";
import { ForaSoftSecondary } from "../icons/logo/ForaSoftSecondary";
import { mediaIcons } from "../icons/mediaIcons/allTogether";
import { Expanded } from "../expanded/Expanded";
import { MarkButton } from "../mark/MarkButton";

import styles from "./index.module.css";
import { MainScreen } from "./mainScreen/MainScreen";
import { SocialLink } from "./mainScreen/SocialLinks";

const FORASOFT_URL = "https://www.forasoft.com/";

// The messages that show the start screen: the panel was hidden, or picking a stream failed (with the error).
const START_SCREEN_MESSAGES: string[] = [CONST.VTT_WAS_HIDDEN, CONST.VTT_GO_TO_MAIN_SCREEN];

interface StartScreenProps {
  error: string | null;
  onOpenReport: () => void;
}

// The start screen: what StreamTest does, the steps, the error of the last attempt, the last session, and the links.
const StartScreen: React.FC<StartScreenProps> = ({ error, onOpenReport }) => (
  <>
    <MainScreen error={error} onOpenReport={onOpenReport} />
    <footer className={styles.mainFooter}>
      <div className={styles.firstRow}>
        <a href={FORASOFT_URL} target="_blank" rel="noreferrer" className={styles.ForaSoftLogo} aria-label="ForaSoft">
          <ForaSoftLogo />
        </a>
        {mediaIcons.map((iconObj) => (
          <span key={iconObj.url} className={styles.linkIcon}>
            <SocialLink Icon={iconObj.icon} url={iconObj.url} label={iconObj.label} />
          </span>
        ))}
      </div>
      <p className={styles.credo}>
        Creating multimedia products
        <br />
        exactly the way you need them
      </p>
    </footer>
  </>
);

interface SessionFooterProps {
  // Compact: with texts and Mark; Mini: the Back icon alone.
  fullSize: boolean;
  onBackToMain: () => void;
}

// The footer of Compact and Mini: Back to main, Mark and `by ForaSoft`.
const SessionFooter: React.FC<SessionFooterProps> = ({ fullSize, onBackToMain }) => (
  <footer className={styles.footer}>
    <button type="button" className={styles.footerBtn} onClick={onBackToMain} aria-label="Back to main">
      <BackToPrevIcon />

      {fullSize ? (
        <div className={styles.footerText}>Back to main</div>
      ) : (
        // Mini: the icon alone; the footer clips what sticks out of it, so the tooltip is beside the icon.
        <ButtonTip text="Back to main" placement="beside" />
      )}
    </button>

    {fullSize && <MarkButton size="footer" />}

    <div className={styles.footerBy}>
      <div className={styles.footerText}>by</div>

      <a href={FORASOFT_URL} target="_blank" rel="noreferrer" aria-label="ForaSoft">
        <ForaSoftSecondary className={styles.footerIcon} />
      </a>
    </div>
  </footer>
);

// Picks the screen from the display state, and tells main.js what it sizes the panel by: the content's height and
// whether the start screen is shown.
const Layout: React.FC<React.PropsWithChildren> = (props) => {
  const {
    state: { mode }, setMode, mainScreen: isMainscreen, setMainScreen: setIsMainscreen,
  } = useContext(DisplayContext);
  // Why the last attempt to pick a stream failed (PRD §14.2): shown until the next attempt.
  const [error, setError] = useState<string | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);

  // The iframe is as tall as the panel's content: main.js sets its height (plan §4, decision 4).
  // Expanded has a fixed height; main.js skips the reports while it is open.
  const postHeight = useCallback(() => {
    const height = Math.ceil(layoutRef.current?.getBoundingClientRect().height ?? 0);
    if (height > 0) {
      postToWindow(CONST.VTT_CONTENT_HEIGHT, { height });
    }
  }, []);

  useEffect(() => {
    const layout = layoutRef.current;
    if (!layout) {
      return undefined;
    }
    const observer = new ResizeObserver(postHeight);
    observer.observe(layout);
    return () => observer.disconnect();
  }, [postHeight]);

  // Back from Expanded the content may keep its height: report it for the new mode anyway.
  useEffect(() => {
    postHeight();
  }, [mode, postHeight]);

  // A picked stream shows the session; a hidden panel or a failed attempt shows the start screen.
  useEffect(() => onPageMessage((message) => {
    if (message.id === CONST.CONTEXT_MENU_VTT_WAS_CLICKED) {
      setIsMainscreen(false);
      setError(null);
      return;
    }

    if (START_SCREEN_MESSAGES.includes(message.id)) {
      setIsMainscreen(true);

      const { error: failed } = (message.data ?? {}) as { error?: string };
      if (failed) {
        setError(failed);
      }
    }
  }), [setIsMainscreen]);
  const { children } = props;

  // Back to main ends the session: the injection stops it on VTT_STOP_CALCULATION.
  const handleBackToMain = () => {
    setIsMainscreen(true);
    postToWindow(CONST.VTT_STOP_CALCULATION);
  };

  // Last session (PRD §14.1): the Report of the session that ended, its data is kept in the page.
  const openLastReport = () => {
    setIsMainscreen(false);
    setMode("expanded", "report");
  };

  // __vtt.debug.perf() on the page asks how often the panel renders (PRD §18).
  useEffect(() => onPageMessage((message) => {
    answerPerf(message, isMainscreen);
  }), [isMainscreen]);

  // main.js shows its header's session buttons only outside the start screen, which it draws at the Compact size.
  useEffect(() => {
    postToWindow(CONST.VTT_IS_MAIN_SCREEN, { value: isMainscreen });
  }, [isMainscreen]);

  let content: React.ReactNode;
  if (isMainscreen) {
    content = <StartScreen error={error} onOpenReport={openLastReport} />;
  } else if (mode === "expanded") {
    content = <Expanded />;
  } else {
    content = (
      <>
        {children}
        <SessionFooter fullSize={mode !== "mini"} onBackToMain={handleBackToMain} />
      </>
    );
  }

  return (
    <div
      ref={layoutRef}
      className={`${styles.layout} ${!isMainscreen && mode === "expanded" ? styles.layoutExpanded : ""}`}
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      {content}
    </div>
  );
};

export default Layout;
