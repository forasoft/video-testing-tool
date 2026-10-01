import React, {
  useCallback, useContext, useEffect, useRef, useState
} from "react";
import { CONST } from "../../CONST/const";
import { DisplayContext } from "../../context/DisplayContext";
import { answerPerf } from "../../utils/perf";
import { postToWindow } from "../../utils/postToWindow";
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

const Layout: React.FC<React.PropsWithChildren> = (props) => {
  const {
    state: { mode }, setMode, mainScreen: isMainscreen, setMainScreen: setIsMainscreen,
  } = useContext(DisplayContext);
  // Why the last attempt to pick a stream failed (PRD §14.2): shown until the next attempt.
  const [error, setError] = useState<string | null>(null);
  const fullSize = mode !== "mini";
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

  useEffect(() => {
    const callback = (e: MessageEvent) => {
      if (e.data?.id === CONST.CONTEXT_MENU_VTT_WAS_CLICKED) {
        setIsMainscreen(false);
        setError(null);
        return;
      }

      if (
        [CONST.VTT_WAS_HIDDEN, CONST.VTT_GO_TO_MAIN_SCREEN].includes(e.data?.id)
      ) {
        setIsMainscreen(true);

        if (e.data.data?.error) {
          setError(e.data.data.error);
        }
      }
    };

    window.addEventListener("message", callback);

    return () => {
      window.removeEventListener("message", callback);
    };
  }, [setIsMainscreen]);
  const { children } = props;

  const handleBackToMain = () => {
    setIsMainscreen(true);
    window.top?.postMessage({ id: CONST.VTT_STOP_CALCULATION }, "*");
  };

  // Last session (PRD §14.1): the Report of the session that ended, its data is kept in the page.
  const openLastReport = () => {
    setIsMainscreen(false);
    setMode("expanded", "report");
  };

  // __vtt.debug.perf() on the page asks how often the panel renders (PRD §18).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => answerPerf(e, isMainscreen);
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [isMainscreen]);

  useEffect(() => {
    window.top?.postMessage(
      {
        id: CONST.VTT_IS_MAIN_SCREEN,
        value: isMainscreen
      },
      "*"
    );
  }, [isMainscreen]);

  return (
    <div
      ref={layoutRef}
      className={`${styles.layout} ${!isMainscreen && mode === "expanded" ? styles.layoutExpanded : ""}`}
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      {isMainscreen ? (
        <>
          <MainScreen error={error} onOpenReport={openLastReport} />
          <footer className={styles.mainFooter}>
            <div className={styles.firstRow}>
              <a
                href="https://www.forasoft.com/"
                target="_blank"
                rel="noreferrer"
                className={styles.ForaSoftLogo}
                aria-label="ForaSoft"
              >
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
      ) : mode === "expanded" ? (
        <Expanded />
      ) : (
        <>
          {children}
          <footer className={styles.footer}>
            <button
              type="button"
              className={styles.footerBtn}
              onClick={handleBackToMain}
              aria-label="Back to main"
            >
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

              <a href="https://www.forasoft.com/" target="_blank" rel="noreferrer" aria-label="ForaSoft">
                <ForaSoftSecondary className={styles.footerIcon} />
              </a>
            </div>
          </footer>
        </>
      )}
    </div>
  );
};

export default Layout;
