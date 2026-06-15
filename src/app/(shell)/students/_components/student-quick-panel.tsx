"use client";

import { useState, type ReactNode } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { StudentQuickInfo } from "@/components/student-quick-popover";
import type { StudentSummary } from "@/features/students/server/queries";
import { StudentSummaryView } from "@/features/students/components/student-summary-view";
import { useIsDesktop } from "@/components/workspace/use-is-desktop";
import { useWindowStore } from "@/components/workspace/window-store";

/**
 * 학생 행 클릭 트리거.
 * - 데스크톱: Stage Manager 플로팅 창 spawn(여러 학생 동시 멀티태스킹).
 * - 모바일/태블릿: 기존 우측 Sheet(Slide Over) 폴백.
 * 둘 다 StudentSummaryView(한 소스)로 동일 요약 UI.
 */
export function StudentQuickPanel({
  student,
  children,
}: {
  student: StudentQuickInfo;
  children: ReactNode;
}) {
  const isDesktop = useIsDesktop();
  const openWindow = useWindowStore((s) => s.open);

  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<StudentSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  function fetchSummary() {
    if (summary || loading) return;
    setLoading(true);
    setError(false);
    fetch(`/api/students/${student.id}/summary`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: StudentSummary) => setSummary(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  function handleClick() {
    if (isDesktop) {
      openWindow("student", {
        id: student.id,
        title: student.name,
        subtitle: [student.grade, student.school].filter(Boolean).join(" · ") || undefined,
      });
      return;
    }
    setOpen(true);
    fetchSummary();
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="flex cursor-pointer items-center gap-2.5 text-left"
      >
        {children}
      </button>

      {!isDesktop ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="right"
            className="bg-background w-full max-w-[400px] overflow-y-auto p-6 sm:max-w-[400px]"
          >
            <StudentSummaryView info={student} summary={summary} loading={loading} error={error} />
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}
