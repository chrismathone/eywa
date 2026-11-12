/**
 * 강사 시트(ECS) **칸 편집 감사로그** — 판정·모양 검증·자르기의 단일 소스(순수 · Vitest).
 *
 * 원장 결정(2026-09-14): **칸 입력을 마칠 때 한 줄** — 타이핑 중 자동저장은 기록하지 않고, 칸을 떠날 때
 * 마지막 값(이전 값 → 새 값)을 한 줄 남긴다. 뿌리는 원장 원칙(2026-09-09) *"기능이 추가되거나 변동되는건
 * 모두 감사로그에 남도록"* — 목표·학생 기록·메모 자동저장(LWW)이 감사로그를 한 줄도 안 남기고 있었다.
 * 같은 날 범위 확대: **계획 줄 칸(교재·진도·과제) · 수학 시트 학생 월간 목표 · 자리 PIN 문 JJ 칸**.
 *
 * 🔑 흐름(세 조각이 이 모듈을 함께 쓴다):
 *   ① 저장 핸들러가 칸을 **처음** 건드릴 때 그 칸의 지금 값(`before`)을 잡는다 — `useSheetEditAudit().touch`
 *   ② 칸을 떠나면(blur) 남은 디바운스 저장을 **먼저 비우고** — 훅의 `commit`
 *   ③ 서버(문마다 하나: `commitSheetEdits`·`commitSeatPlanEdits`·`commitMathGoalEdits`·`commitSeatJjEdits`)가
 *      **DB에서 지금 값을 다시 읽어** `after`로 삼고, 뜻이 같으면 0줄 · 다르면 1줄.
 * ⚠️ `before`는 **화면이 보던 값**(클라이언트)이다 — 서버엔 "편집을 시작하던 순간의 값"을 믿고 꺼낼 곳이
 *    없다(행에는 마지막 값만 남는다). 그래서 서버는 모양만 검증하고, `after`만은 DB에서 읽어 로그의 새 값이
 *    DB와 어긋나지 않게 한다. 다른 강사가 그 사이 같은 칸을 고쳤다면 before가 한 박자 낡을 수 있다.
 * 🔴 **누름이 곧 결심인 토글**(Shouting 체크 · MP e-book 열/휴강)은 이 흐름이 아니다 — 그 저장 액션이
 *    직접 한 줄 남긴다(`mpStructuralChange` · `setSlotShouting`).
 * 🔴 **문마다 받는 칸 종류가 정해져 있다**(`*_EDIT_KINDS`) — 한 문에 다른 문의 칸을 실어 보내 그 문의 게이트를
 *    우회하지 못하게 서버가 종류째 거절한다.
 * server-only 금지([[#61]]) — 서버 액션과 클라 훅이 함께 import한다.
 */
import { HHMM_RE, YMD_RE } from "./week";
import { PLAN_PATCH_FIELDS, SKILL_AREA_SLUG_RE, type PlanPatchField } from "./plan-codec";
import { MONTH_RE } from "./month";
import { MP_ALL_COLUMNS, MP_COLUMN_LABEL } from "./month-plan";
import { ROSTER_FIXED_LABEL, ROSTER_TEXT_COLS } from "./roster-form";
import { isRecord } from "@/lib/guards";

/** 한 번에 기록할 칸 수 상한 — 한 번 떠날 때 모이는 칸은 보통 1~2개다(넉넉히, 무한은 아니게). */
export const SHEET_EDIT_BATCH_MAX = 20;
/** 감사로그에 싣는 값 길이 상한 — 메모는 2000자까지 저장되지만 감사로그 행은 내용 사본이 아니다. */
export const AUDIT_VALUE_MAX = 200;
/** `before` 원문 상한 — 어떤 저장 칸보다도 크면 모양부터 틀린 요청이다. */
const BEFORE_RAW_MAX = 10_000;

/** 메모 위치키 — 저장 액션(`saveMemo`)과 **같은 규약**이다(여기가 단일 소스, 액션이 import한다). */
export const MEMO_KEY_RE = /^(week|panel|day:\d{4}-\d{2}-\d{2}|slot:\d{4}-\d{2}-\d{2}:\d{2}:\d{2})$/;

export const MARK_EDIT_FIELDS = ["status", "progressNote", "score", "listeningLevel", "memorizedWords"] as const;
export type MarkEditField = (typeof MARK_EDIT_FIELDS)[number];
export const GOAL_EDIT_FIELDS = ["textbook", "targetProgress"] as const;
export type GoalEditField = (typeof GOAL_EDIT_FIELDS)[number];
/** MP에서 **글로 적는** 칸 — `off`(휴강 표식)는 칸이 아니라 토글이라 여기 없다. */
export const MP_TEXT_KINDS = [...MP_ALL_COLUMNS, "footer", "title"] as const;
export type MpTextKind = (typeof MP_TEXT_KINDS)[number];
/**
 * 자리(JJ) 출석부 칸 — 영어 시트 학생 기록과 **같은 행·같은 컬럼**이라 칸 이름도 학생 기록 칸 이름을 쓴다
 * (화면 키 `attitude` = 저장 컬럼 `status`, `seatJjEditFieldOf`). 시험 점수는 그 화면에 없다.
 */
export const SEAT_JJ_EDIT_FIELDS = ["status", "listeningLevel", "memorizedWords", "progressNote"] as const;
export type SeatJjEditField = (typeof SEAT_JJ_EDIT_FIELDS)[number];

/** 감사로그를 남기는 칸 하나 — 저장 경로(액션)와 1:1이다. */
export type SheetEditCell =
  | {
      kind: "goal";
      scope: "month" | "week";
      periodStart: string;
      role: "homeroom" | "assistant";
      skillArea: string;
      field: GoalEditField;
    }
  | { kind: "mark"; studentId: string; date: string; slotStart: string; field: MarkEditField }
  | { kind: "memo"; weekStart: string; memoKey: string }
  | { kind: "monthMemo"; month: string }
  | { kind: "mpCell"; date: string; colKind: MpTextKind }
  /** 계획 줄 칸(CAS) — 줄 id가 반·날짜·교시를 품는다(서버가 행에서 다시 읽는다). */
  | { kind: "plan"; lineId: string; field: PlanPatchField }
  /** 수학 시트 학생 월간 목표(0237a). */
  | { kind: "mathGoal"; studentId: string; month: string; field: GoalEditField }
  /** 자리(JJ) 출석부 칸 — 한 화면에 여러 반이 서므로 반 id를 칸이 든다. */
  | {
      kind: "seatJj";
      classId: string;
      studentId: string;
      date: string;
      slotStart: string;
      field: SeatJjEditField;
    };

export type SheetEditKind = SheetEditCell["kind"];
export type SheetEdit = { cell: SheetEditCell; before: string | null };

/** 문마다 받는 칸 종류 — 서버가 요청을 검증할 때 **자기 문의 종류만** 통과시킨다. */
export const ECS_EDIT_KINDS = ["goal", "mark", "memo", "monthMemo", "mpCell", "plan"] as const;
export const SEAT_PLAN_EDIT_KINDS = ["plan"] as const;
export const MATH_EDIT_KINDS = ["mathGoal"] as const;
export const SEAT_JJ_EDIT_KINDS = ["seatJj"] as const;

/** 칸의 고유 이름 — 같은 칸을 여러 번 건드려도 편집 시작 값은 한 번만 잡는다. */
export function sheetEditCellId(cell: SheetEditCell): string {
  switch (cell.kind) {
    case "goal":
      return `goal|${cell.scope}|${cell.periodStart}|${cell.role}|${cell.skillArea}|${cell.field}`;
    case "mark":
      return `mark|${cell.studentId}|${cell.date}|${cell.slotStart}|${cell.field}`;
    case "memo":
      return `memo|${cell.weekStart}|${cell.memoKey}`;
    case "monthMemo":
      return `monthMemo|${cell.month}`;
    case "mpCell":
      return `mp|${cell.date}|${cell.colKind}`;
    case "plan":
      return `plan|${cell.lineId}|${cell.field}`;
    case "mathGoal":
      return `mathGoal|${cell.studentId}|${cell.month}|${cell.field}`;
    case "seatJj":
      return `seatJj|${cell.classId}|${cell.studentId}|${cell.date}|${cell.slotStart}|${cell.field}`;
  }
}

/**
 * 비교용 정규화 — 저장 codec(`normalizePlanText`: trim, "" → NULL)과 같은 뜻.
 * 🔑 그래서 "빈칸 ↔ 행 없음"·"끝 공백만 다름"은 **변동이 아니다**(0줄).
 */
export function normalizeAuditValue(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s;
}

export function auditValueChanged(before: unknown, after: unknown): boolean {
  return normalizeAuditValue(before) !== normalizeAuditValue(after);
}

/** 감사로그에 싣는 값 — 정규화 후 상한을 넘으면 **글자 단위로** 잘라 말줄임(이모지·한글이 반쪽 나지 않게). */
export function clipAuditValue(v: unknown, max: number = AUDIT_VALUE_MAX): string | null {
  const s = normalizeAuditValue(v);
  if (s === null) return null;
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : s;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 계획 줄 id — 모양만 좁힌다(소유·범위는 서버가 행을 읽어 다시 본다). */
const LINE_ID_RE = /^[0-9A-Za-z_-]{1,64}$/;


function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

function isText(v: unknown, re: RegExp): v is string {
  return typeof v === "string" && re.test(v);
}

/** 칸 하나의 모양 검증 — 모르는 키는 버리고 **알려진 키만** 새로 담는다(요청에 섞인 군더더기가 로그로 새지 않게). */
export function parseSheetEditCell(raw: unknown): SheetEditCell | null {
  if (!isRecord(raw)) return null;
  switch (raw.kind) {
    case "goal": {
      const { scope, periodStart, role, skillArea, field } = raw;
      if (!oneOf(["month", "week"] as const, scope) || !isText(periodStart, YMD_RE)) return null;
      if (!oneOf(["homeroom", "assistant"] as const, role) || !isText(skillArea, SKILL_AREA_SLUG_RE)) return null;
      if (!oneOf(GOAL_EDIT_FIELDS, field)) return null;
      return { kind: "goal", scope, periodStart, role, skillArea, field };
    }
    case "mark": {
      const { studentId, date, slotStart, field } = raw;
      if (!isText(studentId, UUID_RE) || !isText(date, YMD_RE) || !isText(slotStart, HHMM_RE)) return null;
      if (!oneOf(MARK_EDIT_FIELDS, field)) return null;
      // 교시는 "HH:MM"으로 굳힌다 — DB `time`은 "HH:MM:SS"로 돌아와 같은 칸이 두 이름을 갖지 않게.
      return { kind: "mark", studentId, date, slotStart: slotStart.slice(0, 5), field };
    }
    case "memo": {
      const { weekStart, memoKey } = raw;
      if (!isText(weekStart, YMD_RE) || !isText(memoKey, MEMO_KEY_RE)) return null;
      return { kind: "memo", weekStart, memoKey };
    }
    case "monthMemo": {
      const { month } = raw;
      if (!isText(month, MONTH_RE)) return null;
      return { kind: "monthMemo", month };
    }
    case "mpCell": {
      const { date, colKind } = raw;
      if (!isText(date, YMD_RE) || !oneOf(MP_TEXT_KINDS, colKind)) return null;
      return { kind: "mpCell", date, colKind };
    }
    case "plan": {
      const { lineId, field } = raw;
      if (!isText(lineId, LINE_ID_RE) || !oneOf(PLAN_PATCH_FIELDS, field)) return null;
      return { kind: "plan", lineId, field };
    }
    case "mathGoal": {
      const { studentId, month, field } = raw;
      if (!isText(studentId, UUID_RE) || !isText(month, MONTH_RE) || !oneOf(GOAL_EDIT_FIELDS, field)) return null;
      return { kind: "mathGoal", studentId, month, field };
    }
    case "seatJj": {
      const { classId, studentId, date, slotStart, field } = raw;
      if (!isText(classId, UUID_RE) || !isText(studentId, UUID_RE)) return null;
      if (!isText(date, YMD_RE) || !isText(slotStart, HHMM_RE) || !oneOf(SEAT_JJ_EDIT_FIELDS, field)) return null;
      return { kind: "seatJj", classId, studentId, date, slotStart: slotStart.slice(0, 5), field };
    }
    default:
      return null;
  }
}

/**
 * 요청 전체 검증 — 하나라도 모양이 틀리면 **통째로 거절**(null). 같은 칸이 두 번 오면 첫 값만 쓴다
 * (먼저 잡힌 값이 편집 시작 값이다).
 * 🔴 `allowed`를 넘기면 그 종류 밖의 칸이 하나라도 섞인 요청을 통째로 거절한다(문마다 자기 칸만).
 */
export function parseSheetEdits(raw: unknown, allowed?: readonly SheetEditKind[]): SheetEdit[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > SHEET_EDIT_BATCH_MAX) return null;
  const out: SheetEdit[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const cell = parseSheetEditCell(item.cell);
    if (!cell) return null;
    if (allowed && !allowed.includes(cell.kind)) return null;
    const before = item.before;
    if (before !== null && (typeof before !== "string" || before.length > BEFORE_RAW_MAX)) return null;
    const id = sheetEditCellId(cell);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ cell, before });
  }
  return out;
}

/**
 * 학생 기록 저장 한 번이 **실제로 바꾸는 칸**과 그 칸의 직전 값.
 * 🔑 저장 핸들러는 행 전체(태도·특이사항 + 자유 칸)를 한꺼번에 보내므로, 안 바뀐 칸까지 건드린 것으로
 *    치면 칸마다 헛줄 후보가 생긴다. `next`에 **없는 칸은 이번 저장이 손대지 않는 칸**이다.
 */
export function markEditTouches(
  prev: Readonly<Partial<Record<MarkEditField, string | null>>> | null | undefined,
  next: Readonly<Partial<Record<MarkEditField, string | null>>>,
): Array<{ field: MarkEditField; before: string | null }> {
  const out: Array<{ field: MarkEditField; before: string | null }> = [];
  for (const field of MARK_EDIT_FIELDS) {
    if (!(field in next)) continue;
    const before = prev?.[field] ?? null;
    if ((next[field] ?? null) !== before) out.push({ field, before });
  }
  return out;
}

/** 자리 JJ 화면의 칸 키 → 감사로그 칸 이름(같은 컬럼) — 화면의 `attitude`는 저장 컬럼 `status`다. */
export function seatJjEditFieldOf(
  field: "attitude" | "listeningLevel" | "memorizedWords" | "progressNote",
): SeatJjEditField {
  return field === "attitude" ? "status" : field;
}

// ── 감사로그 화면용 라벨 — 기록할 때 **스냅샷**으로 싣는다(뷰어가 학원설정·폼 정의를 몰라도 한글이 뜬다) ──

/** 계획 패널 열 머리(`교재명 / 목표 진도`)와 같은 말. 수학 시트 목표도 같은 두 칸이다. */
export const GOAL_FIELD_LABEL: Record<GoalEditField, string> = {
  textbook: "교재명",
  targetProgress: "목표 진도",
};

/** 계획 표 열 머리와 같은 말 — 사전 `plan.col.*`의 한국어(가드 테스트가 글자까지 맞춘다). */
export const PLAN_FIELD_LABEL: Record<PlanPatchField, string> = {
  skill_area: "구분",
  textbook: "교재 / 내신교과서",
  page_range: "페이지/시간",
  progress: "진도",
  homework: "과제",
};

/** 학생 기록 칸 이름 — 로스터 폼 정의(`roster-form.ts`)가 단일 소스. */
export function markFieldLabel(field: MarkEditField): string {
  if (field === "status") return ROSTER_FIXED_LABEL.attitude;
  if (field === "progressNote") return ROSTER_FIXED_LABEL.progressNote;
  for (const cols of Object.values(ROSTER_TEXT_COLS)) {
    const col = cols.find((c) => c.field === field);
    if (col) return col.label;
  }
  return "기록";
}

/** 주간 메모 위치키 → 사람이 읽는 이름(raw 키 노출 금지). */
export function memoKeyLabel(memoKey: string): string {
  if (memoKey === "panel" || memoKey === "week") return "주간 메모";
  const day = /^day:(\d{4}-\d{2}-\d{2})$/.exec(memoKey);
  if (day) return `${day[1]} 메모`;
  const slot = /^slot:(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2})$/.exec(memoKey);
  if (slot) return `${slot[1]} ${slot[2]} 메모`;
  return "메모";
}

/** 월간 특이사항 메모(0246a) — 칸이 달마다 하나뿐이라 이름도 하나. */
export const MONTH_MEMO_LABEL = "특이사항 메모";

/** MP 칸 이름 — 값 칸은 원본 문서 표기(`MP_COLUMN_LABEL`), 문서 아래 한 덩어리는 '하단 문구'. */
export function mpCellLabel(colKind: MpTextKind): string {
  return colKind === "footer" ? "하단 문구" : colKind === "title" ? "제목" : MP_COLUMN_LABEL[colKind];
}

// ── MP 토글(누름이 곧 결심) ─────────────────────────────────────────────────

/** MP 저장이 **무엇을 하려는지** — 클라가 말하지만 서버는 패치 모양과 맞을 때만 믿는다. */
export type MpSaveIntent = { kind: "ebookColumn"; show: boolean } | { kind: "dayOff"; off: boolean };

/**
 * MP 토글 저장의 감사로그 재료 — e-book 열 세우기/내리기 · 휴강 표시.
 * 🔴 의도가 패치와 **안 맞으면 null**(기록 없음) — 칸 글쓰기에 의도를 붙여 보내도 토글로 둔갑하지 않는다
 *    (글쓰기는 `commitSheetEdits`가 칸을 떠날 때 한 줄).
 */
export function mpStructuralChange(
  intent: MpSaveIntent | null | undefined,
  patches: ReadonlyArray<{ date: string; colKind: string; body: string | null }>,
): Record<string, string | number | boolean> | null {
  if (!intent || typeof intent !== "object" || patches.length === 0) return null;
  if (intent.kind === "ebookColumn" && typeof intent.show === "boolean") {
    const want = intent.show ? "" : null;
    if (!patches.every((p) => p.colKind === "ebook" && p.body === want)) return null;
    const dates = patches.map((p) => p.date).sort();
    return {
      change: "ebookColumn",
      show: intent.show,
      days: dates.length,
      from: dates[0]!,
      to: dates[dates.length - 1]!,
    };
  }
  if (intent.kind === "dayOff" && typeof intent.off === "boolean") {
    const only = patches[0]!;
    if (patches.length !== 1 || only.colKind !== "off") return null;
    return { change: "dayOff", date: only.date, off: intent.off };
  }
  return null;
}
