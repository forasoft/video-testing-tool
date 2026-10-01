import React, {
  useContext, useEffect, useRef, useState
} from "react";
import styles from "./Report.module.css";
import { MESSAGES, SummaryTextMessage } from "../../../../shared/protocol";
import { SessionContext } from "../../context/SessionContext";
import { postToWindow } from "../../utils/postToWindow";
import { VerdictChip } from "../expanded/VerdictChip";

// The button says `Copied` this long after a copy (PRD §13.1).
const COPIED_MS = 1000;

// Copy summary, PRD §15.3, §16 F9: the injection makes the text as of the click (VTT_COPY_SUMMARY →
// VTT_SUMMARY_TEXT), the popup puts it on the clipboard. Without the clipboard (the page is not focused, the
// site does not allow it) the text is shown selected, to be copied by hand.
const useCopySummary = () => {
  // When the text was last copied: every copy says `Copied` for its own second, a failed one at once stops it.
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.id !== MESSAGES.VTT_SUMMARY_TEXT || !asked.current) {
        return;
      }
      asked.current = false;
      const { text } = e.data.data as SummaryTextMessage;
      const written = navigator.clipboard?.writeText
        ? navigator.clipboard.writeText(text)
        : Promise.reject(new Error("No clipboard"));
      written.then(() => {
        setManual(null);
        setCopiedAt(Date.now());
      }, () => {
        setCopiedAt(null);
        setManual(text);
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (copiedAt === null) {
      return undefined;
    }
    const timer = setTimeout(() => setCopiedAt(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copiedAt]);

  const copy = () => {
    asked.current = true;
    postToWindow(MESSAGES.VTT_COPY_SUMMARY, {});
  };

  return { copied: copiedAt !== null, manual, copy };
};

// Verdict card of the Report, PRD §13.1: the chip of §11.1 with Copy summary, the text for a ticket (§12.5) and the
// comparison with the previous run on this site. The chip and the text come with VTT_SAMPLE, so they change
// together once a second; the previous run — with VTT_REPORT.
export const VerdictCard: React.FC = () => {
  const { session, sample, report } = useContext(SessionContext);
  const verdict = sample?.verdict;
  const { copied, manual, copy } = useCopySummary();
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (manual !== null) {
      area.current?.focus();
      area.current?.select();
    }
  }, [manual]);

  return (
    <section className={styles.card} data-verdict-card>
      <div className={styles.verdictHead}>
        <VerdictChip verdict={verdict} state={session?.state} />
        <span className={styles.spacer} />
        <button type="button" className={styles.copy} onClick={copy} data-copy={copied ? "copied" : "copy"}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 3.5v-.25A1.25 1.25 0 0 0 9.25 2h-5A1.25 1.25 0 0 0 3 3.25v5A1.25 1.25 0 0 0 4.25 9.5h.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {copied ? "Copied" : "Copy summary"}
        </button>
      </div>
      <p className={styles.verdictText} data-verdict-report>{verdict?.report ?? ""}</p>
      {/* Previous run on this site (PRD §13.1): values that got better green, worse red — ready in VTT_REPORT. */}
      {report && (
        <p className={styles.previousRun} data-previous-run>
          {report.previousRun
            ? report.previousRun.map(({ text, change }, i) => (
              // The pieces are fixed by their place in the line.
              <span key={i} className={change ? styles[change] : undefined} data-change={change}>{text}</span>
            ))
            : <span className={styles.firstRun}>First run on this site</span>}
        </p>
      )}
      {manual !== null && (
        <label className={styles.manual}>
          <span className={styles.manualLabel}>Select and copy</span>
          <textarea
            ref={area}
            className={styles.manualText}
            readOnly
            value={manual}
            rows={manual.split("\n").length}
            data-summary-text
          />
        </label>
      )}
    </section>
  );
};
