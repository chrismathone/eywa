import type { TodayClass } from "../server/roster";

export type HubStats = {
  students: number;
  progressDone: number;
  testDone: number;
  reportDone: number;
};

const STAT_DEFS = [
  { key: "students", label: "오늘 학생", tone: "text-foreground" },
  { key: "progressDone", label: "진도 확정", tone: "text-primary" },
  { key: "testDone", label: "테스트 입력", tone: "text-blue" },
  { key: "reportDone", label: "보고서 발송", tone: "text-gold" },
] as const;

/**
 * 원스크린 허브 바(B2) — 강사 일상 컨텍스트: 오늘 마감 통계 4카드 + 오늘 수업(반·시각·인원).
 * 강사가 진도 입력 전에 "오늘 누구를, 몇 반을, 언제" 보는지 한눈에. 통계는 클라이언트 state에서 도출.
 */
export function OneScreenHubBar({
  stats,
  todayClasses,
}: {
  stats: HubStats;
  todayClasses: TodayClass[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_minmax(0,400px)]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STAT_DEFS.map((d) => {
          const v = stats[d.key];
          const denom = d.key === "students" ? null : stats.students;
          return (
            <div key={d.key} className="bg-card border-line shadow-card rounded-md border px-3 py-2.5">
              <p className="micro text-text-faint">{d.label}</p>
              <p className={`tabular mt-0.5 text-[22px] font-extrabold ${d.tone}`}>
                {v}
                {denom != null ? (
                  <span className="text-text-faint text-[13px] font-semibold">/{denom}</span>
                ) : null}
              </p>
            </div>
          );
        })}
      </div>

      <div className="bg-card border-line shadow-card rounded-md border px-4 py-3">
        <p className="micro text-text-faint mb-2">오늘 수업 {todayClasses.length}개</p>
        {todayClasses.length === 0 ? (
          <p className="text-text-faint text-[13px]">오늘 예정된 수업이 없습니다.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {todayClasses.map((c) => (
              <span
                key={c.id}
                className="border-line inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[12px] whitespace-nowrap"
              >
                {c.startTime ? (
                  <span className="text-primary font-mono font-semibold">{c.startTime}</span>
                ) : null}
                <span className="text-foreground font-semibold">{c.name}</span>
                <span className="text-text-faint">{c.studentCount}명</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
