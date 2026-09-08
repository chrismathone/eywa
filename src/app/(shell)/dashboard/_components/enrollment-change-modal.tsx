"use client";

import { WindowLink } from "@/components/workspace/window-link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { EnrollmentChangeStudent } from "@/features/dashboard/server/queries";

/** 히어로 KPI "재원생" 변동 드릴다운 — 이번 달 신규/퇴원 명단 모달(라이트 KPI 카드 sub 라인). */
export function EnrollmentChangeModal({
  deltaText,
  newCount,
  withdrawnCount,
  newStudents,
  withdrawn,
}: {
  deltaText: string;
  newCount: number;
  withdrawnCount: number;
  newStudents: EnrollmentChangeStudent[];
  withdrawn: EnrollmentChangeStudent[];
}) {
  const total = newCount + withdrawnCount;

  if (total === 0) {
    return <span className="text-text-faint text-xs">이번 달 {deltaText}</span>;
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className="text-text-dim hover:text-foreground text-xs underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        }
      >
        이번 달 {deltaText} ›
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold">이번 달 재원 변동</DialogTitle>
        </DialogHeader>
        <div>
          <Section title="신규 등록" tone="primary" items={newStudents} totalCount={newCount} />
          <Section title="퇴원" tone="rose" items={withdrawn} totalCount={withdrawnCount} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  tone,
  items,
  totalCount,
}: {
  title: string;
  tone: "primary" | "rose";
  items: EnrollmentChangeStudent[];
  totalCount: number;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <p className={`micro mb-1.5 ${tone === "rose" ? "text-rose" : "text-primary"}`}>
        {title} <span className="num">{totalCount}</span>
      </p>
      {items.length === 0 ? (
        <p className="text-text-faint text-xs">없음</p>
      ) : (
        <>
          <ul className="divide-line divide-y">
            {items.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                <WindowLink
                  href={`/students/${s.id}`}
                  title={s.name}
                  className="text-foreground shrink-0 font-medium hover:underline"
                >
                  {s.name}
                </WindowLink>
                <span className="text-text-dim truncate text-right">
                  {[s.grade, s.school].filter(Boolean).join(" · ")}
                  {s.date ? <span className="num"> · {s.date.slice(0, 10)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          {totalCount > items.length ? (
            <p className="text-text-dim mt-2 text-xs">최근 {items.length}명만 표시합니다.</p>
          ) : null}
        </>
      )}
    </div>
  );
}
