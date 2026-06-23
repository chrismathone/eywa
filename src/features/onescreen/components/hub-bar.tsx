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
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
      {/* 통계 — 컴팩트 단일 카드(4셀, 내용폭). stretch 안 함 → 빈 공간 없음. */}
      <div className="bg-card border-line shadow-card grid grid-cols-4 divide-x divide-line/70 rounded-md border lg:shrink-0">
        {STAT_DEFS.map((d) => {
          const v = stats[d.key];
          const denom = d.key === "students" ? null : stats.students;
          return (
            <div key={d.key} className="px-3.5 py-2 text-center sm:px-5">
              <p className="micro text-text-faint whitespace-nowrap">{d.label}</p>
              <p className={`tabular mt-0.5 text-[19px] font-extrabold leading-tight ${d.tone}`}>
                {v}
                {denom != null ? (
                  <span className="text-text-faint text-[12px] font-semibold">/{denom}</span>
                ) : null}
              </p>
            </div>
          );
        })}
      </div>

      {/* 오늘 수업 — 남는 폭을 채우는 시각순 그리드(시각 강조). */}
      <div className="bg-card border-line shadow-card min-w-0 flex-1 rounded-md border px-4 py-2.5">
        <p className="micro text-text-faint mb-1.5">오늘 수업 {todayClasses.length}개</p>
        {todayClasses.length === 0 ? (
          <p className="text-text-faint py-1 text-[13px]">오늘 예정된 수업이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            {todayClasses.map((c) => (
              <div
                key={c.id}
                className="border-line/60 flex items-center gap-2 border-b py-1 last:border-b-0"
              >
                <span className="text-primary bg-primary-soft shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-semibold">
                  {c.startTime ?? "—"}
                </span>
                <span className="text-foreground min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                  {c.name}
                </span>
                <span className="text-text-faint shrink-0 text-[11px]">{c.studentCount}명</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
