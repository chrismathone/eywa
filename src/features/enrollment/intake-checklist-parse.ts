/**
 * 사전 체크리스트 — FormData → `IntakeChecklist` 파싱/검증(순수, server-only 미의존 → Vitest).
 *
 * ⚠️ 공개 접수(비인증 POST)라 **클라 가드는 없는 셈** 치고 여기서 전부 재검증한다:
 * ① 값은 카탈로그 화이트리스트 밖이면 조용히 버림 ② 최대 선택 개수 초과분 절단 ③ 자유입력 clip
 * ④ 숫자는 범위 강제. 저장 전 마지막 관문이므로 여기서 통과한 것만 jsonb에 들어간다.
 */
import {
  CHANGE_OPTIONS,
  ENGLISH_STATE_OPTIONS,
  GOAL_OPTIONS,
  HABIT_ITEMS,
  HABIT_SCALE_MAX,
  HABIT_SCALE_MIN,
  LEVEL_BASIS_OPTIONS,
  MATH_STATE_OPTIONS,
  MAX_CHANGES,
  MAX_GOALS,
  MAX_SUBJECT_STATES,
  MAX_WANTS,
  MAX_WORRIES,
  PRIOR_REASON_OPTIONS,
  PRIOR_SIDE_EFFECT_OPTIONS,
  PRIOR_STATUS_OPTIONS,
  PROTECT_OPTIONS,
  WANT_OPTIONS,
  WORRY_OPTIONS,
  type ChoiceOption,
  type IntakeChecklist,
  type SubjectChecklist,
} from "./intake-checklist";

/** FormData 최소 인터페이스 — 테스트에서 실제 FormData 없이도 쓰도록. */
export type FormLike = {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
};

function clip(v: FormDataEntryValue | null, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** 화이트리스트 통과 값만, 중복 제거, 최대 n개까지(초과분 절단). */
function pickMany(form: FormLike, name: string, options: ChoiceOption[], max: number): string[] {
  const allowed = new Set(options.map((o) => o.value));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of form.getAll(name)) {
    const v = typeof raw === "string" ? raw : "";
    if (!allowed.has(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function pickOne(form: FormLike, name: string, options: ChoiceOption[]): string | null {
  const v = clip(form.get(name), 40);
  return options.some((o) => o.value === v) ? v : null;
}

function text(form: FormLike, name: string, max = 200): string | null {
  return clip(form.get(name), max) || null;
}

/** 0 이상 정수만(상한 초과·음수·비숫자는 null) — 주당 시간·예산 오입력 방어. */
function num(form: FormLike, name: string, max: number): number | null {
  const raw = clip(form.get(name), 20).replace(/[,\s]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return Math.round(n);
}

function subjectPart(form: FormLike, prefix: "math" | "english", options: ChoiceOption[]): SubjectChecklist | null {
  const states = pickMany(form, `${prefix}States`, options, MAX_SUBJECT_STATES);
  const course = text(form, `${prefix}Course`, 100);
  return states.length > 0 || course ? { states, course } : null;
}

/** 7번 1~5점 — 범위 밖·미응답은 제외(빈 객체면 미응답으로 취급). */
function habits(form: FormLike): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of HABIT_ITEMS) {
    const n = Number(clip(form.get(`habit_${item.value}`), 4));
    if (Number.isInteger(n) && n >= HABIT_SCALE_MIN && n <= HABIT_SCALE_MAX) out[item.value] = n;
  }
  return out;
}

/**
 * 전부 비어 있으면 null 반환 = "체크리스트 미작성"(핵심만 필수라 스텝2를 통째로 건너뛸 수 있다).
 * 호출부는 null이면 컬럼을 비운다 — 빈 껍데기 jsonb를 저장해 상세화면이 빈 섹션을 그리지 않게.
 */
export function parseIntakeChecklist(form: FormLike): IntakeChecklist | null {
  const result: IntakeChecklist = {
    version: 1,
    goals: pickMany(form, "goals", GOAL_OPTIONS, MAX_GOALS),
    goalsEtc: text(form, "goalsEtc", 100),
    worries: pickMany(form, "worries", WORRY_OPTIONS, MAX_WORRIES),
    worriesEtc: text(form, "worriesEtc", 100),
    worryOutcome: text(form, "worryOutcome", 500),
    levelBasis: pickMany(form, "levelBasis", LEVEL_BASIS_OPTIONS, LEVEL_BASIS_OPTIONS.length),
    levelBasisEtc: text(form, "levelBasisEtc", 100),
    math: subjectPart(form, "math", MATH_STATE_OPTIONS),
    english: subjectPart(form, "english", ENGLISH_STATE_OPTIONS),
    habits: habits(form),
    priorStatus: pickOne(form, "priorStatus", PRIOR_STATUS_OPTIONS),
    priorReason: pickOne(form, "priorReason", PRIOR_REASON_OPTIONS),
    priorSideEffect: pickOne(form, "priorSideEffect", PRIOR_SIDE_EFFECT_OPTIONS),
    changes: pickMany(form, "changes", CHANGE_OPTIONS, MAX_CHANGES),
    changesEtc: text(form, "changesEtc", 100),
    weeklyHours: num(form, "weeklyHours", 168), // 주 168시간 초과 = 오입력
    budget: num(form, "budget", 100_000_000),
    protect: pickMany(form, "protect", PROTECT_OPTIONS, PROTECT_OPTIONS.length),
    protectEtc: text(form, "protectEtc", 100),
    wants: pickMany(form, "wants", WANT_OPTIONS, MAX_WANTS),
    wantsEtc: text(form, "wantsEtc", 100),
    strengths: text(form, "strengths", 500),
    extra: text(form, "extra", 1000),
  };
  return isEmptyChecklist(result) ? null : result;
}

/** version 외에 아무 응답도 없으면 빈 것으로 본다. */
export function isEmptyChecklist(c: IntakeChecklist): boolean {
  return (
    c.goals.length === 0 &&
    c.worries.length === 0 &&
    c.levelBasis.length === 0 &&
    c.changes.length === 0 &&
    c.protect.length === 0 &&
    c.wants.length === 0 &&
    Object.keys(c.habits).length === 0 &&
    !c.math &&
    !c.english &&
    !c.goalsEtc &&
    !c.worriesEtc &&
    !c.worryOutcome &&
    !c.levelBasisEtc &&
    !c.changesEtc &&
    !c.protectEtc &&
    !c.wantsEtc &&
    !c.priorStatus &&
    !c.priorReason &&
    !c.priorSideEffect &&
    c.weeklyHours === null &&
    c.budget === null &&
    !c.strengths &&
    !c.extra
  );
}
