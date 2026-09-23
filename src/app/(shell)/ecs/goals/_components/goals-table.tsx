import Link from "next/link";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { SUBJECT_SOFT } from "@/features/owner/subjects";
import { skillAreaColorOf } from "@/features/owner/skill-areas";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import type { GoalCellState } from "@/features/class-sheets/lib/goals-board";
import type { GoalsBoardRow } from "@/features/class-sheets/server/goals-board";
import { sheetT, type SheetLang } from "@/features/teacher-view/i18n";

/** 칸 상태 → 점 색 · 칸 바탕. 뜻은 의미색 캐논 그대로(같음 = 초록 · 어긋남 = 앰버 · 비어 있음 = 중립). */
export const GOAL_STATE_DOT: Record<GoalCellState, string> = {
  same: "bg-green",
  diff: "bg-amber",
  weekEmpty: "bg-neutral-fill",
  none: "",
};
const CELL_BG: Record<GoalCellState, string> = {
  same: "",
  diff: "bg-amber-soft",
  weekEmpty: "",
  none: "bg-bg-soft",
};

/**
 * 반 계획 보기 표 — 행 = 반, 열 = 영역. 칸 한 개에 교재(월간) · 월 목표 · 주 목표 세 줄.
 * ⚠️ 행 헤더(반 이름)는 그 주의 반 시트로 가는 링크 — 고치는 곳은 거기 하나다(이 화면은 읽기 전용).
 * ⚠️ 칸 전문은 `title`로(좁은 창에서 말줄임이 걸린다).
 */
export function GoalsTable({
  rows,
  areas,
  weekMonday,
  lang,
  classLabel,
  teacherLabel,
}: {
  rows: GoalsBoardRow[];
  areas: SkillAreaSetting[];
  weekMonday: string;
  lang: SheetLang;
  /** 화면 언어에 맞춘 반 이름·강사 이름 — 서버 페이지가 표를 갖고 있어 미리 풀어 넘긴다. */
  classLabel: (name: string) => string;
  teacherLabel: (name: string | null) => string | null;
}) {
  const t = (k: Parameters<typeof sheetT>[1]) => sheetT(lang, k);
  const cols = `minmax(190px, 1.1fr) repeat(${areas.length}, minmax(170px, 1fr))`;
  return (
    <DragScrollArea className="bg-card shadow-card rounded-2xl">
      <div style={{ minWidth: 190 + areas.length * 170 }}>
        <div
          className="bg-bg-soft border-line-strong grid border-b"
          style={{ gridTemplateColumns: cols }}
        >
          <div className="px-3 py-2 text-base font-bold">{t("goals.col.class")}</div>
          {areas.map((a) => (
            <div key={a.key} className="border-line flex items-center justify-center border-l py-2">
              <span
                className={`inline-flex h-6 items-center rounded-full px-2.5 text-sm font-bold ${
                  SUBJECT_SOFT[skillAreaColorOf(areas, a.key)]
                }`}
              >
                {a.label}
              </span>
            </div>
          ))}
        </div>
        {rows.map((r) => {
          const teacher = teacherLabel(r.teacherName);
          return (
            <div
              key={r.classId}
              className="border-line grid border-b last:border-b-0"
              style={{ gridTemplateColumns: cols }}
            >
              <div className="flex min-w-0 flex-col justify-center gap-0.5 px-3 py-2">
                <Link
                  href={`/ecs/${r.classId}?week=${weekMonday}`}
                  className="text-foreground truncate text-base font-bold hover:underline"
                  title={r.className}
                >
                  {classLabel(r.className)}
                </Link>
                {teacher ? <span className="truncate text-sm">{teacher}</span> : null}
              </div>
              {r.cells.map((c) => (
                <div
                  key={c.area}
                  className={`border-line flex min-w-0 flex-col justify-center gap-0.5 border-l px-2.5 py-2 ${CELL_BG[c.state]}`}
                  title={[
                    c.month?.textbook,
                    c.month?.targetProgress ? `${t("goals.month")} ${c.month.targetProgress}` : null,
                    c.week ? `${t("goals.week")} ${[c.week.textbook, c.week.targetProgress].filter(Boolean).join(" · ")}` : null,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                >
                  {c.state === "none" ? (
                    <>
                      <span className="text-sm">{t("goals.stat.none")}</span>
                      {/* 월간 없이 주간만 적은 칸 — 적힌 사실을 감추지 않는다. */}
                      {c.week ? (
                        <span className="flex min-w-0 gap-1.5 text-sm">
                          <b className="shrink-0">{t("goals.week")}</b>
                          <span className="truncate">
                            {[c.week.textbook, c.week.targetProgress].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className={`size-2.5 shrink-0 rounded-full ${GOAL_STATE_DOT[c.state]}`} aria-hidden />
                        <span className="truncate text-sm font-bold">{c.month?.textbook || "—"}</span>
                      </span>
                      <span className="flex min-w-0 gap-1.5 text-sm">
                        <b className="shrink-0">{t("goals.month")}</b>
                        <span className="truncate">{c.month?.targetProgress || "—"}</span>
                      </span>
                      <span className={`flex min-w-0 gap-1.5 text-sm ${c.state === "diff" ? "text-amber font-bold" : ""}`}>
                        <b className="shrink-0">{t("goals.week")}</b>
                        <span className="truncate">
                          {c.state === "weekEmpty"
                            ? t("goals.weekBlank")
                            : c.state === "diff"
                              ? [c.week?.textbook, c.week?.targetProgress].filter(Boolean).join(" · ")
                              : c.week?.targetProgress || c.week?.textbook || "—"}
                        </span>
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </DragScrollArea>
  );
}
