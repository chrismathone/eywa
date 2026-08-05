"use client";

import { ChevronRight } from "@/components/icons/eywa-icon-compat";
import { useGridCollapse } from "./grid-context";

/**
 * 강사 전체 보기의 **반 덩어리** — 머리행을 누르면 그 반이 접힌다(구 출석부 D:\attendance의 그룹 접기).
 *
 * 🔴 접기는 **표시**일 뿐이다: 합계(시수·출석률·상단 스탯)는 접어도 그대로다. 접힌 반의 행은 격자
 *    좌표에서만 빠져서 방향키가 안 보이는 칸으로 들어가지 않는다.
 * ⚠️ 접힘 상태는 계정에 저장된다(`users.ui_prefs.attendance`) — 다른 PC에서 열어도 같은 모양.
 */
export function ClassGroupBody({
  classId,
  colSpan,
  summary,
  children,
}: {
  classId: string;
  colSpan: number;
  /** 머리행에 띄울 내용(반 이름·과목·인원·시수) — 서버가 그린 그대로 받는다. */
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  const ctx = useGridCollapse();
  const collapsed = ctx?.collapsed.has(classId) ?? false;
  return (
    <tbody>
      <tr className="bg-bg-soft">
        <td colSpan={colSpan} className="border-line border-y p-0">
          {/* 가로 스크롤 중에도 반 이름이 보이도록 sticky left(구 출석부 그룹 헤더 관행). */}
          <button
            type="button"
            onClick={() => ctx?.toggleCollapsed(classId)}
            aria-expanded={!collapsed}
            className="hover:bg-line/40 sticky left-0 flex w-fit max-w-[calc(100vw-40px)] items-center gap-2 px-3 py-1.5 text-left transition"
          >
            <ChevronRight
              className={`text-text-faint size-3 shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
              aria-hidden
            />
            {summary}
          </button>
        </td>
      </tr>
      {collapsed ? null : children}
    </tbody>
  );
}

/**
 * 표 머리(이름 칸)의 전체 접기/펼치기 — 반이 10개쯤 되면 하나씩 누르는 건 일이다.
 * 별도 줄을 만들지 않고 이름 열 머리에 얹어 세로 공간을 쓰지 않는다(공간활용 극대화).
 */
export function CollapseAllButton({ classIds }: { classIds: string[] }) {
  const ctx = useGridCollapse();
  if (!ctx) return null;
  const allCollapsed = classIds.length > 0 && classIds.every((id) => ctx.collapsed.has(id));
  return (
    <button
      type="button"
      onClick={() => ctx.setAllCollapsed(!allCollapsed)}
      title={allCollapsed ? "모든 반 펼치기" : "모든 반 접기"}
      aria-label={allCollapsed ? "모든 반 펼치기" : "모든 반 접기"}
      className="hover:bg-line/60 text-text-faint hover:text-foreground -ml-1 mr-0.5 inline-flex size-4 items-center justify-center rounded transition"
    >
      <ChevronRight className={`size-3 transition-transform ${allCollapsed ? "" : "rotate-90"}`} aria-hidden />
    </button>
  );
}
