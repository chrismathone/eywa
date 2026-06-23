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
    // 단일 full-width 바: [통계 4셀] | 구분선 | 오늘 수업 칩(남는 폭 채움). 위 상단바와 폭 일치 → 떠 있는 빈공간 없음.
    <div className="bg-card border-line shadow-card flex flex-col rounded-md border px-2 py-1.5 lg:flex-row lg:items-stretch lg:gap-0">
      {/* 통계 — 4셀(내용폭) */}
      <div className="divide-line/70 grid grid-cols-4 divide-x lg:shrink-0">
        {STAT_DEFS.map((d) => {
          const v = stats[d.key];
          const denom = d.key === "students" ? null : stats.students;
          return (
            <div key={d.key} className="px-3 py-1 text-center sm:px-5">
              <p className="micro text-text-faint whitespace-nowrap">{d.label}</p>
              <p className={`tabular text-[19px] font-extrabold leading-tight ${d.tone}`}>
                {v}
                {denom != null ? (
                  <span className="text-text-faint text-[12px] font-semibold">/{denom}</span>
                ) : null}
              </p>
            </div>
          );
        })}
      </div>

      <div className="bg-line/70 mx-3 my-1 hidden w-px lg:block" />

      {/* 오늘 수업 — 칩이 남는 폭을 채움(좌측 패킹). stretch/grid 안 함 → 셀 사이 듬성한 공간 없음. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 px-2 py-1 lg:px-0">
        <span className="micro text-text-faint mr-1 shrink-0">오늘 수업 {todayClasses.length}</span>
        {todayClasses.length === 0 ? (
          <span className="text-text-faint text-[13px]">예정된 수업 없음</span>
        ) : (
          todayClasses.map((c) => (
            <span
              key={c.id}
              className="border-line inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[12.5px]"
            >
              <span className="text-primary font-mono text-[11px] font-semibold">
                {c.startTime ?? "—"}
              </span>
              <span className="text-foreground font-semibold">{c.name}</span>
              <span className="text-text-faint">{c.studentCount}명</span>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
