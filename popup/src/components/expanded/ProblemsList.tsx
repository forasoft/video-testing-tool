// The Timeline's list of problems under the charts; it scrolls to new problems as they come.
import React, {
  useCallback, useEffect, useRef
} from "react";
import styles from "./ProblemsList.module.css";
import { ProblemMessage } from "../../../../shared/protocol";
import { problemDuration, problemInterval } from "./problems";

// The list follows a new problem unless the tester scrolled it this recently (PRD §11.4).
const USER_SCROLL_PAUSE_MS = 10000;

interface ProblemsListProps {
  problems: ProblemMessage[];
  // Seconds from the session start: a problem that goes on lasts until now.
  now: number;
  onOpen: (id: number) => void;
  // Shown over the rows: the stream is gone (PRD §14.3).
  banner?: React.ReactNode;
}

const Chevron = () => (
  <svg className={styles.chevron} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

interface RowProps {
  problem: ProblemMessage;
  // `9.7 s`: of a problem that goes on it grows every second, of the others it stays.
  duration: string;
  onOpen: (id: number) => void;
}

// A row is drawn again only when its problem or duration changed: a long session has up to 200 of them (PRD §18).
const ProblemRow = React.memo(({ problem, duration, onOpen }: RowProps) => (
  <button
    type="button"
    className={styles.row}
    onClick={() => onOpen(problem.id)}
    data-problem-id={problem.id}
  >
    <span className={`${styles.dot} ${styles[problem.severity]}`} aria-hidden="true" />
    <span className={styles.interval}>{problemInterval(problem)}</span>
    <span className={styles.name}>{problem.title}</span>
    <span className={styles.duration}>{duration}</span>
    <span className={styles.category}>{problem.category}</span>
    <Chevron />
  </button>
));
ProblemRow.displayName = "ProblemRow";

// Problems of the Timeline, PRD §11.4: a 32 px row per problem in time order, new ones at the
// bottom; a click opens its card, as a click on its band does.
export const ProblemsList: React.FC<ProblemsListProps> = ({
  problems, now, onOpen, banner,
}) => {
  const rows = useRef<HTMLDivElement>(null);
  const known = useRef(new Set<number>());
  const scrolledAt = useRef(-Infinity);
  // The next scroll event is the list's own scroll to a new problem.
  const ownScroll = useRef(false);
  const sorted = [...problems].sort((a, b) => a.tStart - b.tStart || a.id - b.id);
  // The same function on every render, so that the rows need not be drawn again for it.
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const open = useCallback((id: number) => openRef.current(id), []);

  useEffect(() => {
    const fresh = problems.filter((p) => !known.current.has(p.id));
    fresh.forEach((p) => known.current.add(p.id));
    const list = rows.current;
    if (!fresh.length || !list || Date.now() - scrolledAt.current < USER_SCROLL_PAUSE_MS) {
      return;
    }
    const row = list.querySelector<HTMLElement>(`[data-problem-id="${fresh[fresh.length - 1].id}"]`);
    if (!row) {
      return;
    }
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    let scrollTop = list.scrollTop;
    if (top < scrollTop) {
      scrollTop = top;
    } else if (bottom > scrollTop + list.clientHeight) {
      scrollTop = bottom - list.clientHeight;
    }
    if (scrollTop !== list.scrollTop) {
      ownScroll.current = true;
      list.scrollTop = scrollTop;
    }
  }, [problems]);

  const onScroll = () => {
    if (ownScroll.current) {
      ownScroll.current = false;
      return;
    }
    scrolledAt.current = Date.now();
  };

  return (
    <section className={styles.card} data-problems-list>
      <h3 className={styles.title}>{`Problems (${problems.length})`}</h3>
      {banner}
      {sorted.length ? (
        <div ref={rows} className={styles.rows} onScroll={onScroll}>
          {sorted.map((problem) => (
            <ProblemRow key={problem.id} problem={problem} duration={problemDuration(problem, now)} onOpen={open} />
          ))}
        </div>
      ) : (
        <div className={styles.empty}>No problems yet</div>
      )}
    </section>
  );
};
