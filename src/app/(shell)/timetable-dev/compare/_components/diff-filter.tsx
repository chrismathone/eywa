import Link from "next/link";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import {
  PLAN_DIFF_KIND_LABEL,
  PLAN_DIFF_TONE,
  type PlanDiff,
  type PlanDiffKind,
} from "@/features/timetable-dev/lib/compare";

/** 목록에 무엇을 보일지. 기본은 `diff` — '동일'이 대부분이라 그대로 두면 바뀐 칸이 묻힌다. */
export type DiffScope = "diff" | PlanDiffKind;

export const DIFF_SCOPES: readonly DiffScope[] = ["diff", "added", "removed", "changed", "same"];

export function parseDiffScope(raw: string | undefined): DiffScope {
  return (DIFF_SCOPES as readonly string[]).includes(raw ?? "") ? (raw as DiffScope) : "diff";
}

export function scopeIncludes(scope: DiffScope, kind: PlanDiffKind): boolean {
  return scope === "diff" ? kind !== "same" : scope === kind;
}

const SCOPE_LABEL: Record<DiffScope, string> = {
  diff: "바뀐 것",
  ...PLAN_DIFF_KIND_LABEL,
};

/**
 * 범위 칩 — 링크라 서버에서 그대로 렌더된다(클라 번들 0).
 *
 * 활성 칩은 팔레트 v4의 규약대로 브랜드 네이비, 비활성은 테두리만. 다만 **각 칩의 건수 배지는**
 * 그 구분의 의미색을 쓴다(추가=초록 · 삭제=빨강 · 변경=주황) — 요약 카드와 목록 배지가 이미 같은
 * 색을 쓰므로 여기서만 무채색이면 "이어지는 느낌"이 끊긴다.
 */
export function DiffFilter({
  diff,
  scope,
  hrefFor,
}: {
  diff: PlanDiff;
  scope: DiffScope;
  /** 범위만 바꾼 URL을 만든다(선택한 두 달은 그대로 유지). */
  hrefFor: (scope: DiffScope) => string;
}) {
  const count: Record<DiffScope, number> = {
    diff: diff.addedCount + diff.removedCount + diff.changedCount,
    added: diff.addedCount,
    removed: diff.removedCount,
    changed: diff.changedCount,
    same: diff.sameCount,
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {DIFF_SCOPES.map((s) => {
        const active = s === scope;
        const badge = s === "diff" ? "bg-bg-soft text-text-dim" : TONE_SOFT[PLAN_DIFF_TONE[s]];
        return (
          <Link
            key={s}
            href={hrefFor(s)}
            aria-current={active ? "true" : undefined}
            className={`rounded-pill inline-flex items-center gap-1.5 border px-3 py-1 text-[12px] font-semibold transition-colors ${
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-line text-text-dim hover:bg-bg-soft"
            }`}
          >
            {SCOPE_LABEL[s]}
            <span
              className={`rounded-pill px-1.5 py-px text-[11px] font-bold ${
                active ? "bg-primary-foreground/20 text-primary-foreground" : badge
              }`}
            >
              {count[s]}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
