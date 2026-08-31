/**
 * 누적 미수 상위 — 전 기간 잔액 큰 순 미납 명단(이름 클릭=학생 상세 창).
 * 밴드 '이번 달 미수'(당월 총액)와 모집단이 다름 — 제목으로 구분(정합 감사 2026-07-02).
 */
import { WindowLink } from "@/components/workspace/window-link";
import { Pill } from "@/components/atoms/pill";
import { outstandingPeriodLabels } from "@/features/dashboard/outstanding-periods";
import { DashCard, DashEmpty } from "./dash-card";
import type { OutstandingItem } from "@/features/dashboard/server/queries";

function man(amount: number): string {
  if (amount < 10_000) return `${Math.max(0, amount).toLocaleString("ko-KR")}원`;
  return `${(amount / 10_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만`;
}

export function OutstandingCard({
  items,
  canOpenStudents,
}: {
  items: OutstandingItem[];
  canOpenStudents: boolean;
}) {
  return (
    <DashCard
      title="누적 미수 상위"
      count={items.length > 0 ? `${items.length}명` : undefined}
      href="/billing"
      hrefLabel="수납"
    >
      {items.length === 0 ? (
        <DashEmpty>미납 항목이 없습니다</DashEmpty>
      ) : (
        <ul className="divide-border min-h-0 flex-1 divide-y overflow-y-auto">
          {/* 13/12px 한 줄 = baseline 정렬. truncate는 flex 자식에 두면 baseline이 박스 하단으로
              합성돼 어긋남 → 내부 block span으로 이동. Pill(inline-flex+텍스트)도 baseline에 직접
              — self-center로 띄우면 텍스트 그룹과 배지 중심이 ~3px 갈라진다(실측). */}
          {items.map((p) => {
            const { labels, more } = outstandingPeriodLabels(p.periods ?? []);
            const periodLabel = labels.length ? `${labels.join("·")}${more > 0 ? ` 외 ${more}` : ""}` : null;
            // 접힌 달까지 전부는 툴팁으로(칸이 좁아 화면엔 두 개까지만 적는다).
            const periodTitle =
              more > 0 ? outstandingPeriodLabels(p.periods ?? [], (p.periods ?? []).length).labels.join(" · ") : undefined;
            return (
            <li key={p.studentId} className="flex items-baseline justify-between gap-2 py-1.5">
              {canOpenStudents ? (
                <WindowLink
                  href={`/students/${p.studentId}?tab=billing`}
                  title={p.studentName}
                  className="group min-w-0 flex-1"
                >
                  <span className="text-foreground group-hover:text-primary block truncate text-[13px] font-medium">
                    {p.studentName}
                  </span>
                </WindowLink>
              ) : (
                <span className="text-foreground group-hover:text-primary block truncate text-[13px] font-medium">
                  {p.studentName}
                </span>
              )}
              <span className="text-danger num shrink-0 text-[12px] font-bold">
                {man(p.amount)}
              </span>
              {/* 몇 월분 미납인가(원장 2026-08-31) — 이 카드 금액은 **전 기간 합산**이라 달을 안 적으면
                  이번 달치로 읽힌다(실측: 윤나연 81.8만 = 3월+4월). 두 달까지 적고 나머지는 접는다.
                  문구는 [`outstandingPeriodLabels`](src/features/dashboard/outstanding-periods.ts) 한 곳에서만. */}
              {periodLabel ? (
                <span className="text-text-dim num shrink-0 text-[11px]" title={periodTitle}>
                  {periodLabel}
                </span>
              ) : null}
              <Pill color={p.status === "partial" ? "amber" : "danger"}>
                {p.status === "partial" ? "부분" : "미납"}
              </Pill>
            </li>
            );
          })}
        </ul>
      )}
    </DashCard>
  );
}
