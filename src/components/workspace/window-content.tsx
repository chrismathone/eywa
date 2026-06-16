"use client";

import { useQuery } from "@tanstack/react-query";
import type { StudentSummary } from "@/features/students/server/queries";
import { StudentSummaryView } from "@/features/students/components/student-summary-view";
import { RouteWindow } from "./route-window";
import { useWindowStore, windowId, type Win } from "./window-store";

/** kind → 창 본문. student=요약 peek, route=메뉴 풀화면(크롬리스 iframe). */
export function WindowContent({ win }: { win: Win }) {
  if (win.kind === "student") return <StudentWindow win={win} />;
  if (win.kind === "route") return <RouteWindow win={win} />;
  return null;
}

function StudentWindow({ win }: { win: Win }) {
  const id = win.params.id;
  const open = useWindowStore((s) => s.open);
  const close = useWindowStore((s) => s.close);
  const enterSpotlight = useWindowStore((s) => s.enterSpotlight);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["student-summary", id],
    queryFn: () =>
      fetch(`/api/students/${id}/summary`).then((r) =>
        r.ok ? (r.json() as Promise<StudentSummary>) : Promise.reject(new Error(String(r.status))),
      ),
  });

  // "상세 전체보기": 상세를 라우트 창(크롬리스 iframe)으로 열어 스포트라이트 상단에 크게,
  // 요약 창은 닫음(중복 제거) → 배경이 가려지던 문제 해소.
  function openDetail() {
    const routeId = `student/${id}`;
    open("route", {
      id: routeId,
      title: data?.name ?? win.params.title,
      subtitle: win.params.subtitle,
      href: `/students/${id}`,
    });
    close(win.id);
    enterSpotlight(windowId("route", routeId));
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <StudentSummaryView
        info={{ id, name: win.params.title }}
        summary={data ?? null}
        loading={isLoading}
        error={isError}
        onOpenDetail={openDetail}
      />
    </div>
  );
}
