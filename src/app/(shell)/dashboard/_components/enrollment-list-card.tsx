/**
 * 등록상담 목록 — 활성 상담(대기·예약·상담완료·AI완료)을 최근 순으로 간략히.
 * (구 파이프라인 퍼널 대체 — 단계 분포 대신 "누가·어느 단계·언제"를 바로 보여준다.)
 */
import { Pill, type PillColor } from "@/components/atoms/pill";
import { WindowLink } from "@/components/workspace/window-link";
import { DashCard, DashEmpty } from "./dash-card";
import type { DashEnrollmentList, DashEnrollmentRow } from "@/features/dashboard/server/queries";

// 라벨은 등록상담 칸반(OUTCOME_LABEL)과 동일 표기, 색은 대시보드 Pill 팔레트로.
const OUTCOME: Record<DashEnrollmentRow["outcome"], { label: string; color: PillColor }> = {
  pending: { label: "대기", color: "amber" },
  scheduled: { label: "예약", color: "blue" },
  consulted: { label: "상담완료", color: "primary" },
  ai_done: { label: "AI 완료", color: "gold" },
};

export function EnrollmentListCard({ list }: { list: DashEnrollmentList }) {
  return (
    <DashCard
      title="등록상담"
      count={list.total > 0 ? `${list.total}건` : undefined}
      href="/enrollment"
      hrefLabel="전체"
    >
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
