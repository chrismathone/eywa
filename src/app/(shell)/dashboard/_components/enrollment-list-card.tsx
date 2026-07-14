/**
 * 등록상담 목록 — 활성 상담(대기·예약·상담완료·AI완료)을 최근 순으로 간략히.
 * (구 파이프라인 퍼널 대체 — 단계 분포 대신 "누가·어느 단계·언제"를 바로 보여준다.)
 */
import { Pill, type PillColor } from "@/components/atoms/pill";
import { WindowLink } from "@/components/workspace/window-link";
import { DashCard, DashEmpty } from "./dash-card";
import type {
  DashEnrollmentList,
  DashEnrollmentRow,
  UnassignedEnrolled,
} from "@/features/dashboard/server/queries";

// 라벨은 등록상담 칸반(OUTCOME_LABEL)과 동일 표기, 색은 대시보드 Pill 팔레트로.
const OUTCOME: Record<DashEnrollmentRow["outcome"], { label: string; color: PillColor }> = {
  pending: { label: "대기", color: "amber" },
  scheduled: { label: "예약", color: "blue" },
  consulted: { label: "상담완료", color: "primary" },
  ai_done: { label: "AI 완료", color: "gold" },
};

export function EnrollmentListCard({
  list,
  unassigned = [],
}: {
  list: DashEnrollmentList;
  unassigned?: UnassignedEnrolled[];
}) {
  return (
    <DashCard
      title="등록상담"
      count={list.total > 0 ? `${list.total}건` : undefined}
      href="/enrollment"
      hrefLabel="전체"
    >
      {/* 등록했지만 반 미배정 = 후속조치 필요 → 활성 상담 목록 위 호박색 강조 밴드(고정·컴팩트: 이름 인라인). */}
      {unassigned.length > 0 ? (
        <div className="border-amber/30 bg-amber-soft mb-2 shrink-0 rounded-lg border px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Pill color="amber">배정 필요 {unassigned.length}</Pill>
            <span className="text-text-dim text-[11px]">등록 완료 · 반 미배정</span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed break-keep">
            {unassigned.slice(0, 4).map((u, i) => (
              <span key={u.studentId}>
                {i > 0 ? <span className="text-text-faint"> · </span> : null}
                <WindowLink
                  href={`/students/${u.studentId}`}
                  title={u.name}
                  className="text-foreground hover:text-amber font-medium hover:underline"
                >
                  {u.name}
                </WindowLink>
              </span>
            ))}
            {unassigned.length > 4 ? (
              <span className="text-text-faint"> 외 {unassigned.length - 4}명</span>
            ) : null}
          </p>
        </div>
      ) : null}

      {list.rows.length === 0 ? (
        <DashEmpty>진행 중인 등록상담이 없습니다</DashEmpty>
      ) : (
        <ul className="divide-border min-h-0 flex-1 divide-y overflow-y-auto">
          {list.rows.map((c) => {
            const o = OUTCOME[c.outcome];
            return (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <WindowLink
                    href={`/enrollment/${c.id}`}
                    title={c.name}
                    className="text-foreground truncate text-[13px] font-medium hover:underline"
                  >
                    {c.name}
                  </WindowLink>
                  {c.meta ? <p className="text-text-faint truncate text-[11px]">{c.meta}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Pill color={o.color}>{o.label}</Pill>
                  {c.date ? (
                    <span className="text-text-faint num text-[10px]">{c.date.slice(5)}</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DashCard>
  );
}
