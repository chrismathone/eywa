/**
 * 누적 미수 상위 — 전 기간 잔액 큰 순 미납 명단(이름 클릭=학생 상세 창).
 * 밴드 '이번 달 미수'(당월 총액)와 모집단이 다름 — 제목으로 구분(정합 감사 2026-07-02).
 */
import { WindowLink } from "@/components/workspace/window-link";
import { Pill } from "@/components/atoms/pill";
import { DashCard, DashEmpty } from "./dash-card";
import type { OutstandingItem } from "@/features/dashboard/server/queries";

function man(amount: number): string {
  return `${Math.round(amount / 10000).toLocaleString()}만`;
}

export function OutstandingCard({ items }: { items: OutstandingItem[] }) {
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
          {items.map((p) => (
            <li key={p.studentId} className="flex items-baseline justify-between gap-2 py-1.5">
              <WindowLink
                href={`/students/${p.studentId}?tab=billing`}
                title={p.studentName}
                className="group min-w-0 flex-1"
              >
                <span className="text-foreground group-hover:text-primary block truncate text-[13px] font-medium">
                  {p.studentName}
                </span>
              </WindowLink>
              <span className="text-danger num shrink-0 text-[12px] font-semibold">
                {man(p.amount)}
              </span>
              <Pill color={p.status === "partial" ? "amber" : "danger"}>
                {p.status === "partial" ? "부분" : "미납"}
              </Pill>
            </li>
          ))}
        </ul>
      )}
    </DashCard>
  );
}
