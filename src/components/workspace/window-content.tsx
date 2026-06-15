"use client";

import { useQuery } from "@tanstack/react-query";
import type { StudentSummary } from "@/features/students/server/queries";
import { StudentSummaryView } from "@/features/students/components/student-summary-view";
import type { Win } from "./window-store";

/** kind → 창 본문. Phase 1은 student(요약)만. 무거운 화면은 요약+풀페이지 링크. */
export function WindowContent({ win }: { win: Win }) {
  if (win.kind === "student") return <StudentWindow win={win} />;
  return null;
}

function StudentWindow({ win }: { win: Win }) {
  const id = win.params.id;
  const { data, isLoading, isError } = useQuery({
    queryKey: ["student-summary", id],
    queryFn: () =>
      fetch(`/api/students/${id}/summary`).then((r) =>
        r.ok ? (r.json() as Promise<StudentSummary>) : Promise.reject(new Error(String(r.status))),
      ),
  });

  return (
    <div className="h-full overflow-y-auto p-5">
      <StudentSummaryView
        info={{ id, name: win.params.title }}
        summary={data ?? null}
        loading={isLoading}
        error={isError}
      />
    </div>
  );
}
