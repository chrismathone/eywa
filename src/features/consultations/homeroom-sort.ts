/**
 * 담임별 상담 현황 **정렬**(원장 2026-10-27 *"여기 영역 정렬 과목 등등 여러가지 정렬 순으로 볼 수 있게"*) — 순수(서버·클라 공용, Vitest).
 * 열 머리를 누르면 그 열로, 한 번 더 누르면 방향이 뒤집힌다. 고른 정렬은 계정에 남는다(`ui_prefs.consultations.hr_sort/hr_dir`, [[#90]]).
 * 달 열은 **상대 위치**로 저장한다(`m0` = 이번 달, `m1` = 지난 달 …) — 달이 넘어가도 "이번 달 기준"이 그대로 이어진다.
 */
import type { HomeroomTeacher } from "./homeroom-model";

export type HomeroomSortKey = "name" | "subject" | "students" | "prev" | "left" | "unmet" | `m${number}`;
export type SortDir = "asc" | "desc";
export type HomeroomSort = { key: HomeroomSortKey; dir: SortDir };

// stats-model의 `pct`를 쓰지 않는다 — stats-model이 이 파일을 import한다(순환이면 모듈 평가 순서에 따라 상수가 비어 터진다).
const pct = (part: number, whole: number): number | null => (whole > 0 ? (part / whole) * 100 : null);

export const DEFAULT_HOMEROOM_SORT: HomeroomSort = { key: "name", dir: "asc" };
const MAX_MONTH_OFFSET = 11;

export function parseHomeroomSortKey(raw: unknown): HomeroomSortKey | null {
  if (raw === "name" || raw === "subject" || raw === "students" || raw === "prev" || raw === "left" || raw === "unmet") return raw;
  if (typeof raw === "string" && /^m\d{1,2}$/.test(raw) && Number(raw.slice(1)) <= MAX_MONTH_OFFSET) return raw as HomeroomSortKey;
  return null;
}

/** 열을 처음 눌렀을 때 방향 — 글자는 가나다순, 상담률은 **낮은 순**(챙길 담임이 위), 학생·퇴원·미상담은 많은 순. */
export function defaultDirOf(key: HomeroomSortKey): SortDir {
  return key === "name" || key === "subject" || key.startsWith("m") ? "asc" : "desc";
}

/** 같은 열이면 방향만 뒤집고, 다른 열이면 그 열의 기본 방향으로. */
export function nextSort(cur: HomeroomSort, key: HomeroomSortKey): HomeroomSort {
  return cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: defaultDirOf(key) };
}

// '평균' 열은 뺐다(원장 2026-11-02 *"무슨 평균인지 모르겠음"*) — 저장돼 있던 `avg` 정렬은 파서가 버려 이름순으로 돌아간다.
/** 보기 — 게이지(담임 카드 + 계기판, 기본 · 원장 2026-11-02) / 표(달별 줄). 계정에 남는다(`ui_prefs.consultations.hr_view`, 기본값은 저장 안 함). */
export type HomeroomView = "table" | "gauge";
export const parseHomeroomView = (raw: unknown): HomeroomView => (raw === "table" ? "table" : "gauge");

export function sortHomeroomTeachers(
  teachers: readonly HomeroomTeacher[],
  sort: HomeroomSort,
  subjectLabelOf: (key: string) => string,
): HomeroomTeacher[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const byName = (a: HomeroomTeacher, b: HomeroomTeacher) => a.name.localeCompare(b.name, "ko");
  const subjectText = (t: HomeroomTeacher) => t.subjects.map(subjectLabelOf).sort((a, b) => a.localeCompare(b, "ko")).join(",");
  const last = (t: HomeroomTeacher) => t.months.length - 1;
  const value = (t: HomeroomTeacher): number | null => {
    if (sort.key === "students") return t.students.length;
    if (sort.key === "prev") return t.prev.students;
    if (sort.key === "left") return t.prev.withdrawn.length;
    if (sort.key === "unmet") return t.months[last(t)]?.none ?? 0;
    const m = t.months[last(t) - Number(sort.key.slice(1))];
    return m ? pct(m.self, m.target) : null;
  };
  return [...teachers].sort((a, b) => {
    if (sort.key === "name") return sign * byName(a, b);
    if (sort.key === "subject") return sign * subjectText(a).localeCompare(subjectText(b), "ko") || byName(a, b);
    const va = value(a);
    const vb = value(b);
    // 값이 없는 담임(그 달 대상 0명)은 방향과 무관하게 맨 아래 — 0%와 섞이면 "안 했다"로 읽힌다.
    if (va === null || vb === null) return va === vb ? byName(a, b) : va === null ? 1 : -1;
    return sign * (va - vb) || byName(a, b);
  });
}

/**
 * 골라 보기(원장 2026-10-27 *"정렬 말고도 제외해서 볼 수도 있으면 — 해당 부분만 본다던지 수학만 본다던지"*). 정렬과 같이 계정에 남는다.
 * - `subject` = 그 과목 담임 반이 있는 담임만(null = 전체)
 * - `teachers` = 고른 담임만(빈 배열 = 전체 · 사라진 id는 조용히 무시)
 * - `unmetOnly` = 이번 달 미상담이 있는 담임만 · `unmetStudentsOnly` = 펼친 학생 표에서 이번 달 미상담 학생만
 */
export type HomeroomFilter = { subject: string | null; teachers: string[]; unmetOnly: boolean; unmetStudentsOnly: boolean };
export const DEFAULT_HOMEROOM_FILTER: HomeroomFilter = { subject: null, teachers: [], unmetOnly: false, unmetStudentsOnly: false };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseHomeroomFilter(raw: unknown): HomeroomFilter {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    subject: typeof o.subject === "string" && o.subject.length > 0 && o.subject.length <= 40 ? o.subject : null,
    teachers: Array.isArray(o.teachers) ? o.teachers.filter((v): v is string => typeof v === "string" && UUID_RE.test(v)).slice(0, 100) : [],
    unmetOnly: o.unmetOnly === true,
    unmetStudentsOnly: o.unmetStudentsOnly === true,
  };
}

export function isDefaultHomeroomFilter(f: HomeroomFilter): boolean {
  return !f.subject && f.teachers.length === 0 && !f.unmetOnly && !f.unmetStudentsOnly;
}

/**
 * 위 상담 통계(지표·추이)를 담임별 현황의 고르기에 잇는다(원장 2026-10-28 *"주석처리된거 말고 리스트 보이고있는애랑 연결해줘"*).
 * 통계는 주소의 상담사(한 명)·과목으로 걸리므로 — 담임을 **정확히 한 명** 골랐을 때만 그 사람, 여럿·전체면 상담사 조건을 비운다.
 */
export function statsLinkOf(f: HomeroomFilter): { who: string; subject: string } {
  return { who: f.teachers.length === 1 ? f.teachers[0]! : "", subject: f.subject ?? "" };
}

/**
 * 주소(통계 조건)에 현황 고르기를 맞춘다 — 두 카드가 다른 조건을 가리키지 않게(위 드롭다운으로 바꿔도, 저장된 고르기로 열어도).
 * 여러 명 고른 상태는 주소에 상담사가 없을 때만 남는다(통계는 그때 전체라 어긋나지 않는다). 같으면 같은 객체를 돌려준다.
 */
export function alignHomeroomFilter(f: HomeroomFilter, who: string, subject: string): HomeroomFilter {
  const teachers = who ? [who] : f.teachers.length > 1 ? f.teachers : [];
  const s = subject || null;
  if (s === f.subject && teachers.length === f.teachers.length && teachers.every((t, i) => t === f.teachers[i])) return f;
  return { ...f, subject: s, teachers };
}

export function filterHomeroomTeachers(teachers: readonly HomeroomTeacher[], f: HomeroomFilter): HomeroomTeacher[] {
  const picked = f.teachers.length ? new Set(f.teachers) : null;
  const last = (t: HomeroomTeacher) => t.months[t.months.length - 1];
  return teachers.filter(
    (t) =>
      (!f.subject || t.subjects.includes(f.subject)) &&
      (!picked || picked.has(t.id)) &&
      (!f.unmetOnly || (last(t)?.none ?? 0) > 0),
  );
}
