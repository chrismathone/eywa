// 시간표 '뷰 설정'(계정 귀속) — 순수 모듈. 저장은 users.ui_prefs jsonb(0146a).
//
// ⚠️ 학제/학년 필터는 **학생 단위**로 건다. 반 단위로 걸면 안 된다 —
// 실측(2026-07-23): 활성 반 106개 중 **9개가 학제 혼합**이다(개별반은 학년이 섞인다:
// '고등M 개별 TP4E' 10명이 중·고 혼재, '초등M 개별 CR1D' 8명이 초·중 혼재…).
// 반을 통째로 켜고 끄면 그 9개 반이 사라지거나, 반은 남고 남은 학생이 조용히 증발한다.
//
// 규칙 3줄:
//  ① 학생을 학년으로 거른다.
//  ② 보이는 학생이 **1명이라도 있으면 반은 남긴다**(혼합 반 보존).
//  ③ 원래 학생이 0명인 반은 필터와 무관하게 유지 — 필터는 '학생을 숨기는 것'이지 '빈 반을 숨기는
//     것'이 아니다. 안 그러면 명단 없는 반이 필터를 켜는 순간 시간표에서 사라져 구멍이 난다.
//
// ⚠️ 학년을 모르는 학생(grade null)은 **항상 보인다**(fail-open). 필터에 안 걸린다고 숨기면
// 학년 미입력 학생이 시간표에서 통째로 증발한다 — 조용한 소실보다 한 명 더 보이는 쪽이 안전하다.

/** 학년 목록은 학원설정(operations.gradeLevels)이 단일 소스 — 여기에 학년을 하드코딩하지 말 것. */
export type TimetableViewPrefs = {
  /**
   * 보이는 학년 목록. `null` = 전체(필터 없음).
   * 빈 배열도 전체로 취급한다 — 전부 끄면 빈 화면이라 설정으로서 의미가 없고, 사용자가 스스로를
   * 가둘 수 있는 상태를 만들지 않는다.
   */
  grades: string[] | null;
  /** 강사뷰 '미사용 요일' 숨김. null = 미설정(기존 쿠키/기본값 폴백). */
  hideEmptyDays: boolean | null;
  /** 기본뷰 '빈 교시 접기'. null = 미설정(기존 쿠키/기본값 폴백). */
  collapseEmptyPeriods: boolean | null;
};

export const EMPTY_VIEW_PREFS: TimetableViewPrefs = {
  grades: null,
  hideEmptyDays: null,
  collapseEmptyPeriods: null,
};

/**
 * 학년 문자열 → 학제 버킷 라벨("초"·"중"·"고").
 * 설정 학년이 '초1'·'중2'·'고3' 꼴이라 **첫 글자**로 가른다. 그 밖(미래에 '유아'·'N수' 같은 걸
 * 추가하면)은 첫 글자를 그대로 버킷으로 쓴다 — 하드코딩 목록으로 막지 않는다.
 */
export function gradeBucket(grade: string | null | undefined): string | null {
  const g = grade?.trim();
  if (!g) return null;
  return g[0]!;
}

/** 학년 목록에서 학제 버킷을 등장 순서대로 유일화. ["초1","초2","중1"] → ["초","중"] */
export function bucketsOf(grades: readonly string[]): string[] {
  const out: string[] = [];
  for (const g of grades) {
    const b = gradeBucket(g);
    if (b && !out.includes(b)) out.push(b);
  }
  return out;
}

/** 그 버킷에 속하는 학년만. */
export function gradesInBucket(allGrades: readonly string[], bucket: string): string[] {
  return allGrades.filter((g) => gradeBucket(g) === bucket);
}

/** 필터가 실제로 뭔가를 숨기고 있는지(= 배지를 띄워야 하는지). */
export function isGradeFilterActive(
  grades: string[] | null,
  allGrades: readonly string[],
): boolean {
  if (!grades || grades.length === 0) return false;
  // 설정에 없는 학년이 섞여 있어도(학년 이름 변경 등) 남은 교집합 기준으로 판단한다.
  const sel = allGrades.filter((g) => grades.includes(g));
  return sel.length > 0 && sel.length < allGrades.length;
}

/**
 * 툴바 배지 문구. 필터가 아무것도 숨기지 않으면 null.
 *
 * ⚠️ 계정에 저장된 필터는 **조용히 숨기면 안 된다** — "왜 학생이 안 보이지"가 된다.
 * 필터가 걸린 동안엔 이 문구가 툴바에 항상 떠 있어야 한다.
 */
export function gradeFilterLabel(
  grades: string[] | null,
  allGrades: readonly string[],
): string | null {
  if (!isGradeFilterActive(grades, allGrades)) return null;
  const sel = allGrades.filter((g) => grades!.includes(g));
  // 버킷이 통째로 선택됐으면 학제로 줄여 말한다("초1~초6" 대신 "초등만").
  const selBuckets = bucketsOf(sel);
  const bucketComplete = selBuckets.every((b) =>
    gradesInBucket(allGrades, b).every((g) => sel.includes(g)),
  );
  if (bucketComplete) return `${selBuckets.join("·")}만`;
  if (sel.length <= 3) return `${sel.join("·")}만`;
  return `${sel.length}개 학년만`;
}

type StudentLike = { grade?: string | null };
type SlotLike<S extends StudentLike> = { students: S[] };

/**
 * 슬롯의 학생 명단을 학년 필터로 좁힌다. 위 규칙 ①②③ 구현.
 * 필터가 없으면 **원본 배열을 그대로 반환**한다(불필요한 복사로 참조 동일성을 깨지 않는다).
 */
export function applyGradeFilter<S extends StudentLike, T extends SlotLike<S>>(
  slots: readonly T[],
  grades: string[] | null,
): T[] {
  if (!grades || grades.length === 0) return slots as T[];
  const allow = new Set(grades);
  const out: T[] = [];
  for (const slot of slots) {
    // ③ 원래 명단이 없는 반은 손대지 않는다.
    if (slot.students.length === 0) {
      out.push(slot);
      continue;
    }
    const students = slot.students.filter(
      // 학년 미상은 fail-open으로 항상 통과.
      (st) => st.grade == null || st.grade === "" || allow.has(st.grade),
    );
    // ② 다 걸러졌으면 그 반은 이 필터에서 볼 게 없다.
    if (students.length === 0) continue;
    out.push(students.length === slot.students.length ? slot : { ...slot, students });
  }
  return out;
}

/** users.ui_prefs jsonb → 타입 안전한 prefs. 모양이 깨져 있어도 절대 throw하지 않는다. */
export function parseViewPrefs(raw: unknown): TimetableViewPrefs {
  if (!raw || typeof raw !== "object") return EMPTY_VIEW_PREFS;
  const tt = (raw as Record<string, unknown>).timetable;
  if (!tt || typeof tt !== "object") return EMPTY_VIEW_PREFS;
  const o = tt as Record<string, unknown>;
  const grades = Array.isArray(o.grades)
    ? o.grades.filter((g): g is string => typeof g === "string" && g.trim() !== "")
    : null;
  return {
    grades: grades && grades.length > 0 ? grades : null,
    hideEmptyDays: typeof o.hideEmptyDays === "boolean" ? o.hideEmptyDays : null,
    collapseEmptyPeriods:
      typeof o.collapseEmptyPeriods === "boolean" ? o.collapseEmptyPeriods : null,
  };
}

/**
 * 저장용 jsonb 조각. 기존 ui_prefs의 **다른 키를 보존**하도록 병합해서 쓴다
 * (tenant_settings 섹션 머지와 같은 규약 — 한 화면 저장이 다른 화면 설정을 지우면 안 된다).
 */
export function serializeViewPrefs(prefs: TimetableViewPrefs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // 전체 선택(=필터 없음)은 키를 지운다 — "전부 켬"과 "미설정"을 굳이 구분할 이유가 없다.
  if (prefs.grades && prefs.grades.length > 0) out.grades = prefs.grades;
  if (prefs.hideEmptyDays !== null) out.hideEmptyDays = prefs.hideEmptyDays;
  if (prefs.collapseEmptyPeriods !== null) out.collapseEmptyPeriods = prefs.collapseEmptyPeriods;
  return out;
}

/**
 * 선택된 학년이 설정 학년 전체를 덮으면 null(=필터 없음)로 정규화.
 * 저장·비교 양쪽에서 "전부 켠 상태"가 필터로 오인되지 않게 한다.
 */
export function normalizeGradeSelection(
  grades: readonly string[] | null,
  allGrades: readonly string[],
): string[] | null {
  if (!grades) return null;
  const sel = allGrades.filter((g) => grades.includes(g));
  if (sel.length === 0 || sel.length === allGrades.length) return null;
  return sel;
}
