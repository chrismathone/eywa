"use client";

import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF } from "@/components/toolbar-controls";
import { ChevronRight } from "@/components/icons/aywa-icon-compat";
import { useOptionalCollapse } from "./collapse-source";
import { useGridCollapse } from "./grid-context";
import { useClassMatched, useSearchActive } from "./search-context";
// 라벨은 사전 키로 다다 — 두 버튼(화살표·칩)이 같은 판정과 같은 낟말을 쓴다.
import { useSheetT } from "@/features/teacher-view/lang-context";
import { AttendanceColSpan } from "./columns";

function useCollapse() {
  const optional = useOptionalCollapse();
  const grid = useGridCollapse();
  return optional ?? grid;
}

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
  rowKeys,
  children,
}: {
  classId: string;
  colSpan: number;
  /** 머리행에 띄울 내용(반 이름·과목·인원·시수) — 서버가 그린 그대로 받는다. */
  summary: React.ReactNode;
  /**
   * 이 반의 격자 행 키들 — **학생 검색**이 걸렸을 때 이 반을 통째로 지울지 판정한다(2026-08-19).
   * 없으면 검색과 무관한 표(판정 자체를 안 한다).
   */
  rowKeys?: readonly string[];
  children: React.ReactNode;
}) {
  const ctx = useCollapse();
  // 🔴 매칭 학생이 하나도 없는 반은 **머리행까지** 안 그린다 — 반 이름만 남으면 "여기 있나?" 하고
  //    펼쳐 보게 되고, 접기 토글이 붙어 있어 조작 대상처럼 보인다.
  const { active: searching, count: matchedCount } = useClassMatched(rowKeys);
  // 🔴 검색 중엔 접힘을 무시한다(접기 상태는 그대로 두고 **표시만**) — 접힌 반 안에 걸린 학생이 있는데
  //    안 보이면 "검색했는데 없다"가 된다. 격자 좌표(grid-context `visibleRows`)도 같은 판정이라
  //    한쪽만 고치면 안 그린 행이 좌표에 남는다.
  const collapsed = !searching && (ctx?.collapsed.has(classId) ?? false);
  if (searching && matchedCount === 0) return null;
  return (
    <tbody>
      <tr className="bg-bg-soft">
        <AttendanceColSpan colSpan={colSpan} className="border-line border-y p-0">
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
        </AttendanceColSpan>
      </tr>
      {collapsed ? null : children}
    </tbody>
  );
}

/**
 * 접힌 반 수 → 다음 동작. **하나라도 접혀 있으면 '펼치기'다.**
 *
 * 🔴 예전엔 `every`(전부 접혔을 때만 펼치기)라, 10개 중 3개만 접은 흔한 상태에서 버튼이 '접기'였다.
 *    그래서 되돌리려면 **전부 접었다가 다시 펼치는 두 번**을 눌러야 했다 — 원장 제보 *"반을 접고나서
 *    전체 펼치기 기능이 없네"* 가 정확히 이 상태다. 접기는 되돌리기가 한 번에 돼야 한다.
 */
export function nextCollapseAction(classIds: readonly string[], collapsed: ReadonlySet<string>) {
  const collapsedCount = classIds.filter((id) => collapsed.has(id)).length;
  const expand = collapsedCount > 0;
  return { collapsedCount, expand, labelKey: expand ? "att.expandAll" : "att.collapseAll" } as const;
}

/**
 * 표 머리(이름 칸)의 전체 접기/펼치기 — 반이 10개쯤 되면 하나씩 누르는 건 일이다.
 * 별도 줄을 만들지 않고 이름 열 머리에 얹어 세로 공간을 쓰지 않는다(공간활용 극대화).
 *
 * ⚠️ 이건 **아이콘뿐**이라 있는 줄 모르고 지나친다 → 글자 달린 짝(`CollapseAllChip`)이 툴바에 함께 선다.
 *    둘은 같은 판정(`nextCollapseAction`)을 쓴다 — 한쪽만 고치면 두 버튼이 다른 말을 한다.
 */
export function CollapseAllButton({ classIds }: { classIds: string[] }) {
  const t = useSheetT();
  const ctx = useCollapse();
  // 검색 중엔 접힘을 무시해 그리므로(위 ClassGroupBody 주석) 이 버튼은 눌러도 아무 일이 안 난다 — 감춘다.
  const searching = useSearchActive();
  if (!ctx || searching) return null;
  const { expand, labelKey } = nextCollapseAction(classIds, ctx.collapsed);
  const label = t(labelKey);
  return (
    <button
      type="button"
      onClick={() => ctx.setAllCollapsed(!expand)}
      title={label}
      aria-label={label}
      className="hover:bg-line/60 text-text-faint hover:text-foreground -ml-1 mr-0.5 inline-flex size-4 items-center justify-center rounded transition"
    >
      <ChevronRight className={`size-3 transition-transform ${expand ? "" : "rotate-90"}`} aria-hidden />
    </button>
  );
}

/**
 * 툴바의 **글자 달린** 전체 접기/펼치기 — 이름 칸의 12px 화살표는 눈에 안 띈다.
 *
 * 접힌 게 있으면 개수까지 적는다(`전체 펼치기 3`) — 몇 개가 숨어 있는지 모르면 접기가 아니라 은폐다
 * (교실뷰 '경고 N'과 같은 규칙). 반 머리행이 없는 보기에선 아예 안 그린다.
 */
export function CollapseAllChip({ classIds }: { classIds: string[] }) {
  const t = useSheetT();
  const ctx = useCollapse();
  // 같은 이유로 검색 중엔 물러난다(짝인 CollapseAllButton과 판정을 맞춘다).
  const searching = useSearchActive();
  if (!ctx || classIds.length === 0 || searching) return null;
  const { collapsedCount, expand, labelKey } = nextCollapseAction(classIds, ctx.collapsed);
  return (
    <button
      type="button"
      onClick={() => ctx.setAllCollapsed(!expand)}
      className={`${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF}`}
    >
      {t(labelKey)}
      {collapsedCount > 0 ? <span className="text-text-faint ml-1 num">{collapsedCount}</span> : null}
    </button>
  );
}
