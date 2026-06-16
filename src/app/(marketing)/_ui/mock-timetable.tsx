/**
 * MockTimetable — 요일 × 교시 시간표 그리드 (과목 컬러 블록). BrowserFrame 안에 넣는 제품 목업.
 */
const DAYS = ["월", "화", "수", "목", "금"];
const PERIODS = ["4:00", "5:00", "6:00", "7:00", "8:00"];

type Block = { d: number; p: number; rows: number; subject: string; teacher: string; color: string };

const BLOCKS: Block[] = [
  { d: 0, p: 0, rows: 2, subject: "중2 수학", teacher: "박OO", color: "primary" },
  { d: 0, p: 3, rows: 1, subject: "고1 영어", teacher: "이OO", color: "blue" },
  { d: 1, p: 1, rows: 2, subject: "고2 국어", teacher: "정OO", color: "rose" },
  { d: 2, p: 0, rows: 1, subject: "중3 과학", teacher: "최OO", color: "purple" },
  { d: 2, p: 2, rows: 2, subject: "중2 수학", teacher: "박OO", color: "primary" },
  { d: 3, p: 1, rows: 1, subject: "고1 영어", teacher: "이OO", color: "blue" },
  { d: 3, p: 3, rows: 1, subject: "중3 수학", teacher: "박OO", color: "primary" },
  { d: 4, p: 0, rows: 2, subject: "고2 국어", teacher: "정OO", color: "rose" },
  { d: 4, p: 3, rows: 1, subject: "중3 과학", teacher: "최OO", color: "purple" },
];

const TONE: Record<string, string> = {
  primary: "bg-primary-soft text-primary border-l-primary",
  blue: "bg-blue-soft text-blue border-l-blue",
  rose: "bg-rose-soft text-rose border-l-rose",
  purple: "bg-purple-soft text-purple border-l-purple",
};

export function MockTimetable() {
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-foreground text-[13px] font-extrabold">시간표 · 통합뷰</p>
        <span className="text-text-faint font-mono text-[10px]">6월 3주차</span>
      </div>
      <div
        className="grid gap-1 text-center"
        style={{ gridTemplateColumns: "34px repeat(5, 1fr)", gridAutoRows: "26px" }}
      >
        {/* 헤더 */}
        <span />
        {DAYS.map((d) => (
          <span key={d} className="text-text-dim flex items-center justify-center text-[11px] font-bold">
            {d}
          </span>
        ))}
        {/* 본문 */}
        {PERIODS.map((time, p) => (
          <Row key={time} time={time} p={p} />
        ))}
      </div>
    </div>
  );
}

function Row({ time, p }: { time: string; p: number }) {
  return (
    <>
      <span className="text-text-faint flex items-center justify-end pr-1 font-mono text-[9px]">{time}</span>
      {DAYS.map((_, d) => {
        const block = BLOCKS.find((b) => b.d === d && b.p === p);
        const covered = BLOCKS.some((b) => b.d === d && p > b.p && p < b.p + b.rows);
        // 2행 span 블록이 차지한 칸은 아무것도 렌더하지 않음(빈 span을 두면 auto-flow가 한 칸씩 밀림)
        if (covered) return null;
        if (!block) return <span key={d} className="bg-bg-soft/60 rounded-[4px]" />;
        return (
          <div
            key={d}
            className={`flex flex-col justify-center rounded-[4px] border-l-2 px-1.5 text-left ${TONE[block.color]}`}
            style={{ gridRow: `span ${block.rows}` }}
          >
            <span className="truncate text-[9.5px] leading-tight font-bold">{block.subject}</span>
            <span className="truncate text-[8px] leading-tight opacity-70">{block.teacher}</span>
          </div>
        );
      })}
    </>
  );
}
