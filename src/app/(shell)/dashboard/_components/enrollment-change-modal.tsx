"use client";

import { useState } from "react";
import { X } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import type { EnrollmentChangeStudent } from "@/features/dashboard/server/queries";

/** 커맨드밴드 "재원" 변동 드릴다운 — 이번 달 신규/퇴원 명단 모달(다크 밴드 위 클릭). */
export function EnrollmentChangeModal({
  deltaText,
  newStudents,
  withdrawn,
}: {
  deltaText: string;
  newStudents: EnrollmentChangeStudent[];
  withdrawn: EnrollmentChangeStudent[];
}) {
  const [open, setOpen] = useState(false);
  const total = newStudents.length + withdrawn.length;

  return (
    <>
      <button
        type="button"
        onClick={() => total > 0 && setOpen(true)}
        className={`mt-1 block text-[10px] text-white/40 ${
          total > 0 ? "cursor-pointer underline-offset-2 hover:text-white/70 hover:underline" : "cursor-default"
        }`}
      >
        이번 달 {deltaText}
        {total > 0 ? " ›" : ""}
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-card border-line text-foreground max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold">이번 달 재원 변동</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="닫기"
                className="text-text-dim hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </header>
            <Section title="신규 등록" tone="primary" items={newStudents} />
            <Section title="퇴원" tone="rose" items={withdrawn} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function Section({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "primary" | "rose";
  items: EnrollmentChangeStudent[];
}) {
  return (
    <div className="mb-4 last:mb-0">
      <p className={`micro mb-1.5 ${tone === "rose" ? "text-rose" : "text-primary"}`}>
        {title} <span className="num">{items.length}</span>
      </p>
      {items.length === 0 ? (
        <p className="text-text-faint text-xs">없음</p>
      ) : (
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
      )}
    </div>
  );
}
