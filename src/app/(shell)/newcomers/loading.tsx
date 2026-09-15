import styles from "./_components/newcomer-board.module.css";

export default function Loading() {
  return <div className={`${styles.board} edge-to-edge`} aria-busy="true" aria-label="신규생 관리 불러오는 중">
    <p className={styles.muted} role="status">신규생 관리 기록을 불러오고 있습니다…</p>
    <div className={styles.metrics}>{Array.from({ length: 5 }, (_, i) => <div key={i} className={`${styles.metric} animate-pulse`} style={{ height: 86 }}><div className="h-8 w-3/4 rounded bg-slate-100" /></div>)}</div>
    <div className={`${styles.priority} animate-pulse`}><div className="h-4 w-1/2 rounded bg-slate-100" /></div>
    <div className={styles.panel}><div className="h-20 shrink-0 bg-slate-50" />{Array.from({ length: 14 }, (_, i) => <div key={i} className="h-9 shrink-0 animate-pulse border-b border-slate-100 px-4 py-2"><div className="h-3 w-3/4 rounded bg-slate-100" /></div>)}</div>
  </div>;
}
