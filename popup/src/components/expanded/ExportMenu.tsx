import React, {
  useEffect, useRef, useState
} from "react";
import styles from "./ExportMenu.module.css";
import { ExportFormat, useExport } from "../../utils/useExport";

const ITEMS: { format: ExportFormat; label: string }[] = [
  { format: "json", label: "JSON — full session" },
  { format: "csv", label: "CSV — per-second samples" },
];

// Export ▾ of the Expanded header, PRD §8.3: a menu of the two files (§15). The injection makes the
// file and downloads it; until it says so (VTT_EXPORT_READY) the button reads `Preparing…`.
export const ExportMenu: React.FC = () => {
  const [open, setOpen] = useState(false);
  const { preparing: format, start } = useExport();
  const preparing = format !== null;
  const wrapper = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);

  // The menu takes the focus; a click outside it or Escape closes it.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    first.current?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!(e.target instanceof Node && wrapper.current?.contains(e.target))) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (chosen: ExportFormat) => {
    setOpen(false);
    start(chosen);
  };

  return (
    <div ref={wrapper} className={styles.wrapper}>
      <button
        type="button"
        className={styles.button}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={preparing}
        onClick={() => setOpen((value) => !value)}
        data-export={preparing ? "preparing" : "idle"}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 2.5v8m0 0L4.75 7.25M8 10.5l3.25-3.25M3 13.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {preparing ? "Preparing…" : "Export"}
        {!preparing && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M2.5 4 5 6.5 7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {ITEMS.map(({ format: item, label }, i) => (
            <button
              key={item}
              ref={i === 0 ? first : undefined}
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => choose(item)}
              data-export-format={item}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
