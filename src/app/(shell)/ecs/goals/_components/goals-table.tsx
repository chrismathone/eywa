"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { WindowLink } from "@/components/workspace/window-link";
import { EditingBadge } from "@/features/presence/editing-badge";
import { ecsPresenceScope } from "@/features/class-sheets/lib/presence-scope";
import { classNameFor } from "@/features/teacher-view/class-name";
import { teacherNameFor, type TeacherEnglishNames } from "@/features/teacher-view/teacher-name";
import { SUBJECT_SOFT } from "@/features/owner/subjects";
import { skillAreaColorOf } from "@/features/owner/skill-areas";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import type {
  DayLine,
  GoalText,
  GoalsBoardRole,
  RoleGoal,
} from "@/features/class-sheets/lib/goals-board";
import { GOAL_STATE_DOT } from "@/features/class-sheets/lib/goals-board";
import type { GoalsBoardRow } from "@/features/class-sheets/server/goals-board";
import { sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";
import { InlineDayEditor } from "./inline-day-editor";
import { InlineGoalEditor } from "./inline-goal-editor";
import { AnchoredEditor } from "./anchored-editor";

/**
 * 영역 열의 바탕 = 그 영역 라벨 알약과 **같은 색**(원장 2026-09-23 *"열 색상을 해당 라벨 색상과 맞춰서 통일"*).
 * 색은 학원설정 영역 색 단일 소스(`skillAreaColorOf`) — 알약의 옅은 채움(`SUBJECT_SOFT`의 bg 조각)만 빌린다.
 * 칸의 상태(교재 다름 등)는 바탕이 아니라 **점·글자색**이 나른다(바탕은 열이 쓴다).
 */
function areaBg(areas: SkillAreaSetting[], key: string): string {
  return SUBJECT_SOFT[skillAreaColorOf(areas, key)].split(" ")[0] ?? "";
}

/** 목표 한 칸 → `교재 · 진도`. 둘 다 비면 null(= '비어 있음' — 세 줄이 같은 말을 쓴다). */
function goalText(g: GoalText | null | undefined): string | null {
  const parts = [g?.textbook?.trim(), g?.targetProgress?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** 일간 첫 줄 `교재 · 진도` + 나머지 줄 수(`외 N`). 전문은 칸 툴팁. */
function dayLineText(lines: DayLine[], lang: SheetLang): string | null {
  const first = lines[0];
  if (!first) return null;
  const head = [first.textbook?.trim(), first.progress?.trim() || first.pageRange?.trim()].filter(Boolean).join(" · ");
  const more = lines.length > 1 ? ` ${sheetTf(lang, "goals.more", { n: lines.length - 1 })}` : "";
  return (head || [first.homework?.trim()].filter(Boolean).join("")) + more;
}

function fullLine(l: DayLine): string {
  return [l.textbook, l.pageRange, l.progress, l.homework].map((v) => v?.trim()).filter(Boolean).join(" · ");
}

/** 한 줄에 놓을 조각 — 전체 보기에서 누가 적었는지(굵기·접두)를 함께 나른다. */
type Piece = { text: string; bold: boolean; prefix: string | null };

/**
 * 월·주 줄의 조각 — 전체 보기(원장 2026-09-23): 담임 = 굵게 · 부담임 = 보통,
 * 두 사람이 **다 적었을 때만** `담)`·`부)`를 붙인다(한 사람뿐이면 굵기만으로 가른다).
 */
function piecesOf(items: RoleGoal[], role: GoalsBoardRole, lang: SheetLang): Piece[] {
  const both = items.length > 1;
  return items.map((it) => ({
    text: goalText(it.goal) ?? "",
    bold: role === "all" && it.role === "homeroom",
    prefix: both
      ? sheetT(lang, it.role === "homeroom" ? "goals.prefix.homeroom" : "goals.prefix.assistant")
      : null,
  }));
}

/**
 * 칸 안 한 줄 — `월/주/일` 라벨 + 값(없으면 '비어 있음'). 세 줄이 같은 모양이다(원장 *"멘트 통일"*).
 * 줄 사이는 **가로선**으로만 가른다(원장 *"월 주 일 구분하게 가로선. 세로선은 필요없어"*) — 라벨 폭 고정으로 정렬.
 */
function GoalLine({
  label,
  pieces,
  blank,
  dot,
  emphasis = false,
  disabled = false,
}: {
  label: string;
  pieces: Piece[];
  blank: string;
  /** 주 줄에만 — 월간 대비 상태 점. */
  dot?: string;
  emphasis?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      data-no-lesson={disabled ? "" : undefined}
      className={`flex min-w-0 items-start gap-1.5 py-1 text-sm ${
        disabled ? "-mx-2.5 bg-slate-200 px-2.5 text-slate-700" : emphasis ? "text-amber" : ""
      }`}
      style={disabled ? {
        backgroundImage: "repeating-linear-gradient(135deg, transparent 0 7px, var(--line-strong) 7px 9px)",
      } : undefined}
    >
      <b className="w-4 shrink-0">{label}</b>
      <div className="flex min-w-0 flex-1 flex-col">
        {pieces.length === 0 ? (
          <span className="text-text-dim truncate">{blank}</span>
        ) : (
          pieces.map((p, i) => (
            <span key={i} className={`truncate ${p.bold || emphasis ? "font-bold" : ""}`}>
              {p.prefix ? `${p.prefix} ` : null}
              {p.text}
            </span>
          ))
        )}
      </div>
      {dot ? <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${dot}`} aria-hidden /> : null}
    </div>
  );
}

function EditableGoalLine({ children, label, hint, active, editor, onOpen }: {
  children: ReactNode;
  label: string;
  hint: string;
  active: boolean;
  editor: ReactNode;
  onOpen: () => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={anchorRef}
      role="button"
      tabIndex={0}
      className="w-full cursor-text text-left hover:bg-white/40 focus-visible:outline-2 focus-visible:outline-primary"
      title={active ? undefined : hint}
      aria-label={label}
      onDoubleClick={() => { if (!active) onOpen(); }}
      onKeyDown={(event) => {
        if (!active && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      {children}
      {active ? <AnchoredEditor anchorRef={anchorRef}>{editor}</AnchoredEditor> : null}
    </div>
  );
}

/**
 * 반 계획 보기 표 — 행 = 반, 열 = 영역. 칸 한 개에 월(월간 목표) · 주(주간 목표) · 일(그 날 계획 줄) 세 줄.
 * ⚠️ 행 헤더(반 이름)는 그 주의 반 시트로 가는 링크. 월·주·일 줄은 더블클릭해 같은 데이터에 저장한다.
 * ⚠️ 칸 전문은 `title`로(좁은 창에서 말줄임이 걸린다).
 */
export function GoalsTable({
  rows,
  areas,
  weekMonday,
  monthStart,
  date,
  lang,
  role,
  showDay,
  canEdit,
  teacherNames,
}: {
  rows: GoalsBoardRow[];
  areas: SkillAreaSetting[];
  weekMonday: string;
  monthStart: string;
  date: string;
  lang: SheetLang;
  role: GoalsBoardRole;
  /** 일간 보기면 세 번째 줄(일)을 그린다 — 주간 보기는 월·주 두 줄. */
  showDay: boolean;
  canEdit: boolean;
  teacherNames: TeacherEnglishNames;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<{
    row: GoalsBoardRow;
    area: string;
    scope: "month" | "week" | "day";
  } | null>(null);
  const t = (k: Parameters<typeof sheetT>[1]) => sheetT(lang, k);
  // 툴팁 줄 — 두 사람 것이면 `담)`·`부)`를 붙여 전부 적는다.
  const line = (label: string, items: RoleGoal[]) =>
    items.length === 0
      ? [`${label} ${t("goals.blank")}`]
      : piecesOf(items, role, lang).map((p) => `${label} ${p.prefix ? `${p.prefix} ` : ""}${p.text}`);
  // 반 열 150 → 195px(+30%). 늘어난 45px는 영역 열에 균등하게 나눠 표 전체 너비를 유지한다.
  const classWidth = 195;
  const areaMinWidth = 170 - (classWidth - 150) / Math.max(areas.length, 1);
  const cols = `${classWidth}px repeat(${areas.length}, minmax(${areaMinWidth}px, 1fr))`;
  const openEditor = (row: GoalsBoardRow, area: string, scope: "month" | "week" | "day") => {
    if (!canEdit || (scope === "day" && row.daySlots.length === 0)) return;
    setEditing({ row, area, scope });
  };
  const closeEditor = (row: GoalsBoardRow, area: string, scope: "month" | "week" | "day") => {
    setEditing((current) => current?.row.classId === row.classId && current.area === area && current.scope === scope
      ? null : current);
  };
  const editableLine = (row: GoalsBoardRow, area: string, scope: "month" | "week" | "day", node: ReactNode) => {
    const active = editing?.row.classId === row.classId && editing.area === area && editing.scope === scope;
    if (!canEdit || (scope === "day" && row.daySlots.length === 0)) return node;
    const editor = active ? scope === "day" ? (
        <InlineDayEditor
          key={`${row.classId}:${area}:${date}`}
          classId={row.classId}
          area={area}
          date={date}
          weekMonday={weekMonday}
          slots={row.daySlots}
          lang={lang}
          onClose={() => closeEditor(row, area, scope)}
          onSaved={() => router.refresh()}
        />
      ) : (
        <InlineGoalEditor
          key={`${row.classId}:${area}:${scope}`}
          classId={row.classId}
          area={area}
          scope={scope}
          periodStart={scope === "month" ? monthStart : weekMonday}
          weekMonday={weekMonday}
          items={row.cells.find((cell) => cell.area === area)![scope]}
          role={role}
          lang={lang}
          onClose={() => closeEditor(row, area, scope)}
          onSaved={() => router.refresh()}
        />
      ) : null;
    return <EditableGoalLine
      label={`${classNameFor(row.className, lang)} · ${areas.find((a) => a.key === area)?.label ?? area} · ${t(scope === "month" ? "goals.month" : scope === "week" ? "goals.week" : "goals.day")} · ${t("goals.editHint")}`}
      hint={t("goals.editHint")}
      active={active}
      editor={editor}
      onOpen={() => openEditor(row, area, scope)}
    >{node}</EditableGoalLine>;
  };
  return (
    <>
    <DragScrollArea className="bg-card shadow-card rounded-2xl">
      <div style={{ minWidth: classWidth + areas.length * areaMinWidth }}>
        <div
          className="bg-bg-soft border-line-strong grid border-b"
          style={{ gridTemplateColumns: cols }}
        >
          <div className="px-3 py-2 text-base font-bold">{t("goals.col.class")}</div>
          {areas.map((a) => (
            <div key={a.key} className={`border-line-strong flex items-center justify-center border-l py-2 ${areaBg(areas, a.key)}`}>
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
          const teacherName = teacherNameFor(r.teacherName, teacherNames, lang);
          const teacher = teacherName ? sheetTf(lang, "goals.homeroomOf", { name: teacherName }) : null;
          return (
            <div
              key={r.classId}
              className="border-line-strong grid border-b last:border-b-0"
              style={{ gridTemplateColumns: cols }}
            >
              <div className="flex min-w-0 flex-col justify-center gap-0.5 px-3 py-2" title={r.className}>
                <WindowLink
                  href={`/ecs/${r.classId}?week=${weekMonday}`}
                  className="text-foreground truncate text-base font-bold hover:underline"
                  title={r.className}
                >
                  {classNameFor(r.className, lang)}
                </WindowLink>
                {teacher ? <span className="truncate text-sm">{teacher}</span> : null}
                <EditingBadge scope={ecsPresenceScope(r.classId, weekMonday)} className="self-start" />
              </div>
              {r.cells.map((c) => {
                const noLesson = !r.hasLessonOnDate && c.day.length === 0;
                const dayText = noLesson
                  ? t("goals.noLesson")
                  : dayLineText(c.day, lang);
                return (
                  <div
                    key={c.area}
                    className={`border-line-strong divide-line flex min-w-0 flex-col justify-center divide-y border-l px-2.5 py-1 ${areaBg(areas, c.area)}`}
                    title={editing?.row.classId === r.classId && editing.area === c.area ? undefined : [
                      ...line(t("goals.month"), c.month),
                      ...line(t("goals.week"), c.week),
                      ...(!showDay
                        ? []
                        : c.day.length > 0
                          ? c.day.map((l) => `${t("goals.day")} ${fullLine(l)}`)
                          : [`${t("goals.day")} ${dayText ?? t("goals.blank")}`]),
                    ].join("\n")}
                  >
                    {editableLine(r, c.area, "month", <GoalLine label={t("goals.month")} pieces={piecesOf(c.month, role, lang)} blank={t("goals.blank")} />)}
                    {editableLine(r, c.area, "week", <GoalLine
                      label={t("goals.week")}
                      pieces={piecesOf(c.week, role, lang)}
                      blank={t("goals.blank")}
                      dot={GOAL_STATE_DOT[c.state]}
                      emphasis={c.state === "diff"}
                    />)}
                    {showDay ? (
                      editableLine(r, c.area, "day", <GoalLine
                        label={t("goals.day")}
                        pieces={dayText ? [{ text: dayText, bold: false, prefix: null }] : []}
                        blank={t("goals.blank")}
                        disabled={noLesson}
                      />)
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </DragScrollArea>
    </>
  );
}
