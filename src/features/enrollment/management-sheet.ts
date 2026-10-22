import type { GroupsOf } from "@/features/dashboard/layout/slices";

/**
 * 통계 보기 **관리현황**(원장 2026-10-22 *"콜&상담 관리현황을 한 눈에 보기 쉽게 … 상담대비 완료율이 표시되지 않는다 · 수학, 영어 과목별
 * 재원생수가 제대로 체크되지 않는다 · 시트처럼 한눈에"* → *"통계뷰를 의미함"*) — 달마다 상담·등록·미등록·진행 중 · 완료율(등록 ÷ 상담),
 * 과목 묶음마다 상담·등록·완료율을 한 장에.
 *
 * 🔑 달 = 상담일(`consulted_at` KST) · 상태 = 칸반과 같은 묶음(등록 = enrolled · 미등록 = declined·no_show · 그 밖 = 진행 중) —
 *    위 헤드라인·'월별 상담·등록'(DB 함수 `consultation_monthly_stats`)과 같은 축이라 달 합계가 같다.
 * 🔑 과목 = 신규 문의 추이와 같은 판정(`intakeGroupsOf`) — 두 과목 문의는 양쪽 묶음에 든다(그래서 묶음 합 ≥ 전체) · 못 읽으면 '과목 모름'.
 * 순수 함수(Vitest).
 */
export type SheetCell = { total: number; enrolled: number; declined: number; open: number };
export type SheetMonth = { month: string; all: SheetCell; groups: Record<string, SheetCell>; unknown: number };
export type ManagementSheet = {
  /** 최신 달이 위(시트처럼 내려 읽는다) — 상담이 있는 달만. */
  months: SheetMonth[];
  /** 기간 합 상담이 많은 순. */
  groups: string[];
  total: { all: SheetCell; groups: Record<string, SheetCell>; unknown: number };
};
export type SheetRow = { month: string; subject: string | null; outcome: string };

const empty = (): SheetCell => ({ total: 0, enrolled: 0, declined: 0, open: 0 });

function add(cell: SheetCell, outcome: string): void {
  cell.total += 1;
  if (outcome === "enrolled") cell.enrolled += 1;
  else if (outcome === "declined" || outcome === "no_show") cell.declined += 1;
  else cell.open += 1;
}

/** 완료율(%) = 등록 ÷ 상담 — 헤드라인 '등록 전환율'과 같은 산식. 상담이 없으면 null(0%로 그리면 "다 놓쳤다"로 읽힌다). */
export function completionRate(cell: SheetCell): number | null {
  return cell.total > 0 ? Math.round((cell.enrolled / cell.total) * 100) : null;
}

export function buildManagementSheet(rows: readonly SheetRow[], groupsOf: GroupsOf): ManagementSheet {
  const byMonth = new Map<string, SheetMonth>();
  const total = { all: empty(), groups: {} as Record<string, SheetCell>, unknown: 0 };
  for (const row of rows) {
    const m = byMonth.get(row.month) ?? { month: row.month, all: empty(), groups: {}, unknown: 0 };
    byMonth.set(row.month, m);
    add(m.all, row.outcome);
    add(total.all, row.outcome);
    const groups = [...new Set(groupsOf(row.subject))];
    if (groups.length === 0) {
      m.unknown += 1;
      total.unknown += 1;
    }
    for (const g of groups) {
      add((m.groups[g] ??= empty()), row.outcome);
      add((total.groups[g] ??= empty()), row.outcome);
    }
  }
  const groups = Object.keys(total.groups).sort((a, b) => total.groups[b]!.total - total.groups[a]!.total || a.localeCompare(b));
  const months = [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
  return { months, groups, total };
}
