/**
 * 미수 상위 — 잔액 큰 순 미납 명단(이름 클릭=학생 상세 창). 밴드의 '미수 N건'에 '누구·얼마'를 붙임.
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
      title="미수 상위"
      count={items.length > 0 ? `${items.length}명` : undefined}
      href="/billing"
      hrefLabel="수납 →"
    >
      {items.length === 0 ? (
        <DashEmpty>미납 항목이 없습니다</DashEmpty>
      ) : (
        <ul className="divide-border min-h-0 flex-1 divide-y overflow-y-auto">
          {items.map((p) => (
            <li key={p.studentId} className="flex items-center justify-between gap-2 py-1.5">
              <WindowLink
                href={`/students/${p.studentId}?tab=billing`}
                title={p.studentName}
                className="group min-w-0 flex-1 truncate"
              >
                <span className="text-foreground group-hover:text-primary text-[13px] font-medium">
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
