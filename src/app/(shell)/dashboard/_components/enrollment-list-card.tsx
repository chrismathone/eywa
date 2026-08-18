/**
 * 등록상담 목록 — 활성 상담(대기·예약·상담완료·AI완료)을 최근 순으로 간략히.
 * (구 파이프라인 퍼널 대체 — 단계 분포 대신 "누가·어느 단계·언제"를 바로 보여준다.)
 * 범위는 **최근 30일**(쿼리 `getActiveEnrollmentConsultations`) — 건수도 그 범위라 헤더에 명시한다
 * (전체 기간 283건은 누적 재고라 대시보드 지표로 무의미했음). 전체는 헤더 '전체 →' 링크로.
 */
import { Pill, type PillColor } from "@/components/atoms/pill";
import { WindowLink } from "@/components/workspace/window-link";
import { DashCard, DashEmpty } from "./dash-card";
import { outcomePill } from "@/features/enrollment/outcome-meta";
import type { DashEnrollmentList, DashEnrollmentRow } from "@/features/dashboard/server/queries";

/**
 * 라벨·색 모두 등록상담 단일 소스([outcomePill](src/features/enrollment/outcome-meta.ts)).
 * ⚠️ 종전엔 "색은 대시보드 팔레트로"라며 따로 골라서, 같은 'AI 완료'가 칸반=보라·상세=초록·
 *    대시보드=골드로 **세 색**이었다(코드베이스에서 가장 심하게 갈린 축).
 */
const OUTCOME: Record<DashEnrollmentRow["outcome"], { label: string; color: PillColor }> = {
  pending: outcomePill("pending"),
  scheduled: outcomePill("scheduled"),
  consulted: outcomePill("consulted"),
  ai_done: outcomePill("ai_done"),
};

export function EnrollmentListCard({
  list,
  // 조회 실패 — '상담 없음'(사실 주장)과 구분해야 한다. 페이지의 dashboardQuery 래퍼가 이미 계산해
  // 두고도 카드가 안 읽어, 실패를 "오늘 상담이 없었다"로 위장하고 있었다(2026-07-22 전수검사).
  unavailable = false,
}: {
  list: DashEnrollmentList;
  unavailable?: boolean;
}) {
  return (
    <DashCard
      title="등록상담"
      count={!unavailable && list.total > 0 ? `최근 30일 ${list.total}건` : undefined}
      href="/enrollment"
      hrefLabel="전체"
    >
      {unavailable ? (
        <DashEmpty>등록상담을 불러오지 못했습니다. 등록상담 화면에서 확인해 주세요.</DashEmpty>
      ) : list.rows.length === 0 ? (
        <DashEmpty>최근 30일 진행 중인 등록상담이 없습니다</DashEmpty>
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
