import React, { useContext, useEffect, useState } from "react";
import { CONST } from "../../CONST/const";
import { DisplayContext } from "../../context/DisplayContext";
import { BackToPrevIcon } from "../icons/backToPrevIcon";
import { ForaSoftLogo } from "../icons/logo/ForaSoft";
import { ForaSoftSecondary } from "../icons/logo/ForaSoftSecondary";
import { mediaIcons } from "../icons/mediaIcons/allTogether";

import styles from "./index.module.css";
import { MainScreen } from "./mainScreen/MainScreen";
import { SocialLink } from "./mainScreen/SocialLinks";

const Layout: React.FC = (props) => {
  const [isMainscreen, setIsMainscreen] = useState(true);
  const { state: { fullSize } } = useContext(DisplayContext);

  useEffect(() => {
    const callback = (e: MessageEvent) => {
      if (e.data.id === CONST.CONTEXT_MENU_VTT_WAS_CLICKED) {
        setIsMainscreen(false);
        return;
      }

      if (
        [CONST.VTT_WAS_HIDDEN, CONST.VTT_GO_TO_MAIN_SCREEN].includes(e.data.id)
      ) {
        setIsMainscreen(true);

        if (e.data.data?.error) {
          setTimeout(alert, 300, e.data.data.error);
        }
      }
    };

    window.addEventListener("message", callback);

    return () => {
      window.removeEventListener("message", callback);
    };
  }, []);
  const { children } = props;

  const handleBackToMain = () => {
    setIsMainscreen(true);
    window.top?.postMessage({ id: CONST.VTT_STOP_CALCULATION }, "*");
  };

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
      className={styles.layout}
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      {isMainscreen ? (
        <>
          <MainScreen />
          <footer className={styles.mainFooter}>
            <div className={styles.firstRow}>
              <a
                href="https://fora-soft.com/"
                target="_blank"
                rel="noreferrer"
                className={styles.ForaSoftLogo}
              >
                <ForaSoftLogo />
              </a>
              {mediaIcons.map((iconObj) => (
                <span className={styles.linkIcon}>
                  <SocialLink Icon={iconObj.icon} url={iconObj.url} />
                </span>
              ))}
            </div>
            <p className={styles.credo}>
              Creating multimedia products exactly the way you need them
            </p>
          </footer>
        </>
      ) : (
        <>
          {children}
          <footer className={styles.footer}>
            <button
              type="button"
              className={styles.footerBtn}
              onClick={handleBackToMain}
              tabIndex={0}
              onKeyPress={handleBackToMain}
            >
              <BackToPrevIcon />

              {fullSize && (
                <div className={styles.footerText}>Back to main</div>
              )}
            </button>

            <button type="button" className={styles.footerBtnInactive}>
              <div className={styles.footerText}>by</div>

              <a href="https://forasoft.com/" target="_blank" rel="noreferrer">
                <ForaSoftSecondary className={styles.footerIcon} />
              </a>
            </button>
          </footer>
        </>
      )}
    </div>
  );
};

export default Layout;
