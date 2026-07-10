import { UserCheck } from "lucide-react";
import type { PillColor } from "@/components/atoms/pill";
import { SUBJECT_SOLID } from "@/features/owner/subjects";

export type SubjectStat = { key: string; label: string; color: PillColor; count: number };

/**
 * 학생목록 상단 히어로 카드 — 재원 총원(큰 숫자) + 과목별 재원생 비중 미니바.
 * 과목이 늘어도 카드가 아니라 **행만** 늘어난다(레이아웃 불변). 바 길이 = 재원 대비 수강 비율,
 * 색은 학원설정 과목 색(SUBJECT_SOLID) — 라벨·숫자는 텍스트 토큰(데이터 색 금지).
 */
export function EnrolledStatCard({
  enrolled,
  subjects,
}: {
  enrolled: number;
  subjects: SubjectStat[]; // count>0만, 정렬은 호출부(내림차순)
}) {
  return (
    <section className="bg-card border-line shadow-card rounded-md border p-5">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
        {/* 재원 총원 */}
        <div className="flex shrink-0 items-center gap-3.5">
          <span className="bg-primary-soft text-primary flex size-10 items-center justify-center rounded-sm">
            <UserCheck size={17} strokeWidth={2} />
          </span>
          <div>
            <p className="micro">재원</p>
            <p className="mt-0.5 flex items-baseline gap-1">
              <span className="tabular text-foreground text-[34px] leading-none font-bold">
                {enrolled}
              </span>
              <span className="text-text-dim text-xs">명</span>
            </p>
          </div>
        </div>

        <div className="border-line hidden self-stretch border-l sm:block" />

        {/* 과목별 재원생 — 행 그리드(라벨·바·숫자 열이 행 간 정렬).
            그리드에 self-center 금지 — column(좁은 창)에서 내용폭으로 수축해 1fr 바가 0이 된다(수직 정렬은 부모 sm:items-center). */}
        {subjects.length === 0 ? (
          <p className="text-text-faint self-center text-xs">과목별 수강 데이터가 없습니다.</p>
        ) : (
          <div className="grid flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-2.5">
            {subjects.map((s) => {
              const pct = enrolled > 0 ? Math.round((s.count / enrolled) * 100) : 0;
              return (
                <SubjectRow key={s.key} label={s.label} color={s.color} count={s.count} pct={pct} />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function SubjectRow({
  label,
  color,
  count,
  pct,
}: {
  label: string;
  color: PillColor;
  count: number;
  pct: number;
}) {
  return (
    <>
      <span className="text-foreground text-xs font-medium">{label}</span>
      <div className="bg-bg-soft h-1.5 overflow-hidden rounded-full">
        <div
          className={`h-full rounded-r-full ${SUBJECT_SOLID[color]}`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      <span className="num text-text-dim text-right text-xs">
        <span className="text-foreground text-sm font-bold">{count}</span>명
        <span className="text-text-faint"> · {pct}%</span>
      </span>
    </>
  );
}
