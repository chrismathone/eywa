/**
 * 퇴원관리 **분석 축** — 과목 · 강사 · 학년 · 학교(원장 2026-10-15 *"과목별을 기본으로 강사별, 학년별, 학교별 통계 데이터가
 * 매우 필요함. 올해 수학을 118명 그만두었는데 강사는 누구지, 몇학년이지(내신때문인지 관리 때문인지 파악) 어느 학교가 많이
 * 그만두지"*) + **사유 묶음**(같은 날 *"퇴원사유 대부분이 기타이니 … 눌러서 들어가 볼 수 있게"*). 순수 함수(Vitest).
 *
 * 🔑 한 줄 = 이탈 한 건(`exit-rows.ts`) — 퇴원은 학생 한 줄, 수강종료는 학생 × 과목 한 줄. 축마다 그 줄을 한 번 센다
 *    (과목 · 강사는 한 줄이 여럿에 걸리면 각각 센다).
 * 🔑 칸을 누르면 명단이 그 값으로 걸러진다 — 주소 값은 여기서 정한다(`grade=` · `school=` · `teacher=` · `reason=`).
 * 🔴 강사 = 강사평가 퇴원율이 그 퇴원을 센 선생님(판정 한 벌 `server/exit-teacher-judge.ts` — 시간표 X와 같다).
 *    강사 탓이 아닌 사유 · 반 이동 · 같은 과목 계속 다님 · 지난달 절반 미만 담당 · 장부 정리는 선생님에 안 붙는다('담당 미반영').
 */
import { REASON_LABEL, type WithdrawalReason } from "./types";
import { REASON_DETAILS, reasonDetailOf } from "./reason-detail";
import { reasonKeyOf } from "./reason-key";

export type BreakdownAxis = "subject" | "teacher" | "grade" | "school";

/** 화면 순서 — 과목이 기본(원장 *"과목별을 기본으로"*). */
export const BREAKDOWN_AXES: readonly { key: BreakdownAxis; label: string }[] = [
  { key: "subject", label: "과목" },
  { key: "teacher", label: "강사" },
  { key: "grade", label: "학년" },
  { key: "school", label: "학교" },
];

export function parseBreakdownAxis(raw: unknown): BreakdownAxis {
  return raw === "teacher" || raw === "grade" || raw === "school" ? raw : "subject";
}

/** 값이 없는 줄(학년·학교 미기재 · 담당 미반영)을 고르는 주소 값. */
export const FACET_NONE = "none";

/** 주소 값 정리 — 빈 값은 필터 없음. 지나치게 긴 값은 버린다(주소를 손으로 고친 것 — 사유 글은 길 수 있어 넉넉히). */
export function parseFacet(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v && v.length <= 300 ? v : null;
}

export type BreakdownItem = { value: string; label: string; count: number };

const byCount = (a: BreakdownItem, b: BreakdownItem) => b.count - a.count || a.label.localeCompare(b.label, "ko");

type Row = { subjects: readonly string[]; grade: string | null; school: string | null };

const clean = (v: string | null | undefined) => v?.trim() || null;

/** 과목 — 한 줄이 과목 여럿이면(수학·영어를 함께 끊은 퇴원) **과목마다** 센다. 라벨은 학원설정(`labelOf`). */
export function subjectItems(rows: readonly Pick<Row, "subjects">[], labelOf: (key: string) => string): BreakdownItem[] {
  const counts = new Map<string, number>();
  for (const r of rows) for (const s of r.subjects.length ? r.subjects : [FACET_NONE]) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts]
    .map(([value, count]) => ({ value, label: value === FACET_NONE ? "과목 미상" : labelOf(value), count }))
    .sort((a, b) => Number(a.value === FACET_NONE) - Number(b.value === FACET_NONE) || byCount(a, b));
}

/**
 * **과목을 고른 뒤의 과목 칸** — 고른 과목이 든 줄만, **함께 끊은 과목 묶음**으로 한 번씩 센다(원장 2026-10-15 *"수학 카테고리인데
 * 영어가 나오면 이상하니까 … 수학+영어 로"* + *"필터링 영향 받게 움직여야지"*). 수학을 고르면 '수학'(수학만) · '수학+영어'.
 * 🔑 묶음 이름의 순서 = 학원설정 과목 순서(`order`) — 수학을 고르든 영어를 고르든 같은 '수학+영어'. 설정에 없는 키는 그 뒤 라벨 순.
 * 🔑 한 줄 = 한 칸이라 칸 합 = 줄 수(비중 합 100%). 고른 과목만 끊은 칸이 맨 앞, 나머지는 많은 순.
 * 값(`value`)은 묶음 키(`math+english`) — 이 칸으로 거르는 주소는 없다(과목 필터는 과목 키 하나만 받는다).
 */
export function subjectComboItems(
  rows: readonly Pick<Row, "subjects">[],
  picked: string,
  order: readonly string[],
  labelOf: (key: string) => string,
): BreakdownItem[] {
  const rank = new Map(order.map((k, i) => [k, i]));
  const sortKeys = (a: string, b: string) =>
    (rank.get(a) ?? order.length) - (rank.get(b) ?? order.length) || labelOf(a).localeCompare(labelOf(b), "ko");
  const counts = new Map<string, BreakdownItem>();
  for (const r of rows) {
    if (!r.subjects.includes(picked)) continue;
    const keys = [...new Set(r.subjects)].sort(sortKeys);
    const value = keys.join("+");
    const cur = counts.get(value);
    if (cur) cur.count += 1;
    else counts.set(value, { value, label: keys.map(labelOf).join("+"), count: 1 });
  }
  return [...counts.values()].sort((a, b) => Number(b.value === picked) - Number(a.value === picked) || byCount(a, b));
}

export function gradeOf(row: Pick<Row, "grade">): string {
  return clean(row.grade) ?? FACET_NONE;
}

/**
 * 학년 — 학원설정 학년 순서(`operations.gradeLevels`)대로 세운다(학년은 차례가 있는 값이라 많은 순보다 읽기 쉽다 — 중3·고1이
 * 튀는지 한눈에). 설정에 없는 학년은 그 뒤 많은 순, 미기재는 맨 끝. 값은 학생 기록의 학년(그만둔 뒤 진급하지 않는다).
 */
export function gradeItems(rows: readonly Pick<Row, "grade">[], gradeLevels: readonly string[]): BreakdownItem[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(gradeOf(r), (counts.get(gradeOf(r)) ?? 0) + 1);
  const order = new Map(gradeLevels.map((g, i) => [g, i]));
  const rank = (v: string) => (v === FACET_NONE ? 2 : order.has(v) ? 0 : 1);
  return [...counts]
    .map(([value, count]) => ({ value, label: value === FACET_NONE ? "학년 미기재" : value, count }))
    .sort((a, b) => rank(a.value) - rank(b.value) || (order.get(a.value) ?? 0) - (order.get(b.value) ?? 0) || byCount(a, b));
}

export function schoolOf(row: Pick<Row, "school">): string {
  return clean(row.school) ?? FACET_NONE;
}

/** 학교 — 많은 순(같으면 가나다) · 미기재는 맨 끝. 학교 이름은 저장할 때 통일된다(`~초등학교`→`~초`). */
export function schoolItems(rows: readonly Pick<Row, "school">[]): BreakdownItem[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(schoolOf(r), (counts.get(schoolOf(r)) ?? 0) + 1);
  return [...counts]
    .map(([value, count]) => ({ value, label: value === FACET_NONE ? "학교 미기재" : value, count }))
    .sort((a, b) => Number(a.value === FACET_NONE) - Number(b.value === FACET_NONE) || byCount(a, b));
}

/** 강사 칸 값의 이름 — 강사 카드 · 명단 '담당강사' 칸 · 담당강사 필터가 같은 말을 쓴다(원장 2026-10-15 *"모든 곳에서 담당이 일치하게"*). */
export function teacherFacetLabel(id: string, nameOf: (id: string) => string | null): string {
  return id === FACET_NONE ? "담당 미반영" : (nameOf(id) ?? "이름 없는 계정");
}

/**
 * 명단 한 줄의 '담당강사' 글 — 그 줄의 강사 칸 값(`teacherFacetsIn` — 강사 카드가 세는 값 그대로)을 이름으로. 판정 폭 밖이거나 걸린
 * 과목·프로그램 밖이라 어느 칸에도 안 서는 줄(null)은 '—'.
 */
export function teacherCellText(facets: readonly string[] | null, nameOf: (id: string) => string | null): string {
  return facets === null ? "—" : facets.map((id) => teacherFacetLabel(id, nameOf)).join(" · ");
}

/** 담당강사 필터의 선택지 — 강사 카드 칸과 같은 값 · 이름 순(담당 미반영은 맨 끝). 고른 값은 모집단에 없어도 남긴다(선택이 사라지지 않게). */
export function teacherFilterOptions(
  facets: Iterable<readonly string[] | null>,
  picked: string | null,
  nameOf: (id: string) => string | null,
): { value: string; label: string }[] {
  const ids = new Set<string>();
  for (const f of facets) for (const id of f ?? []) ids.add(id);
  if (picked) ids.add(picked);
  return [...ids]
    .map((value) => ({ value, label: teacherFacetLabel(value, nameOf) }))
    .sort((a, b) => Number(a.value === FACET_NONE) - Number(b.value === FACET_NONE) || a.label.localeCompare(b.label, "ko"));
}

/**
 * 강사 — 줄의 강사 칸 값(`teacherFacetsIn`)마다 한 건: 그 줄을 퇴원율에 센 선생님(함께 맡은 담임·교시 담당이면 둘 다) ·
 * 아무도 안 센 과목이 있으면 '담당 미반영'(맨 끝). `facetsOf`가 null인 줄(걸린 범위 밖)은 어느 칸에도 세지 않는다.
 * 이름을 모르는 id는 '이름 없는 계정'.
 */
export function teacherItems<R>(rows: readonly R[], facetsOf: (row: R) => readonly string[] | null, nameOf: (id: string) => string | null): BreakdownItem[] {
  const counts = new Map<string, number>();
  for (const r of rows) for (const id of new Set(facetsOf(r) ?? [])) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts]
    .map(([value, count]) => ({ value, label: teacherFacetLabel(value, nameOf), count }))
    .sort((a, b) => Number(a.value === FACET_NONE) - Number(b.value === FACET_NONE) || byCount(a, b));
}

/**
 * 강사 판정에 넣을 과목 — 줄의 과목 중 걸린 과목 필터·프로그램에 드는 것만(수학만 보는데 함께 끊은 영어 선생님이 서지 않게).
 * `groupOf`는 과목 → 묶음(수학 · 영어 — `subjectGroupOf`), `programGroup`은 고른 프로그램의 묶음.
 * 과목이 있는데 하나도 안 들면 null — 어느 강사 칸에도 서지 않는다('담당 미반영'으로 세면 그 과목 선생님이 센 줄까지 미반영이 된다).
 * 과목을 모르는 줄은 빈 배열('담당 미반영').
 */
export function judgeSubjects(
  row: Pick<Row, "subjects">,
  filter: { subject: string | null; programGroup: string | null },
  groupOf: (subject: string) => string | null,
): string[] | null {
  const picked = row.subjects.filter((s) => (!filter.subject || s === filter.subject) && (!filter.programGroup || groupOf(s) === filter.programGroup));
  return row.subjects.length && !picked.length ? null : picked;
}

// ─────────────────────────────── 사유 묶음 ───────────────────────────────

/** 장부 정리(일괄 퇴원 — 실제 사유가 아니다)를 고르는 주소 값. */
export const REASON_CLEANUP = "cleanup";
export const REASON_UNSPECIFIED = "unspecified";
/** 자유 글 사유(수강 종료의 '반 폐지'·'반 이동' 등)를 고르는 주소 값의 머리. */
export const REASON_TEXT_PREFIX = "t:";

/**
 * 줄 → 사유 묶음(사유 카드 막대 · `reason=` 필터가 같은 값을 쓴다 — 막대 '기타 84'를 누르면 명단도 84줄).
 * - 장부 정리(일괄 퇴원 메모) → '장부 정리'(실제 사유 아님 · 사유 통계에서 뺀다)
 * - 표준 사유 → 그 키(퇴원 사유 · 수강 종료 사유가 키든 한글 라벨이든)
 * - 자유 글(‘반 폐지’·‘반 이동’·‘종강’) → 그 글 그대로(`t:` 머리) — 기타로 뭉개지 않는다
 * - 아무것도 없으면 '미기재'
 * 글 → 표준 키는 강사 퇴원율·시간표 X와 **같은 함수**(`reasonKeyOf` — 영문 코드는 대소문자 없이 · 모르는 코드는 기타 · 라벨과 같은 글은 키).
 */
export function reasonFacetOf(row: { cleanup: boolean; reasonKey: string | null; reasonLabel: string | null }): { value: string; label: string } {
  if (row.cleanup) return { value: REASON_CLEANUP, label: "장부 정리" };
  const key = reasonKeyOf(row.reasonKey);
  const text = clean(row.reasonLabel);
  const fromText = reasonKeyOf(text);
  if (key && key !== "other") return { value: key, label: REASON_LABEL[key] };
  if (fromText && fromText !== "other") return { value: fromText, label: REASON_LABEL[fromText] };
  if (text && !fromText) return { value: `${REASON_TEXT_PREFIX}${text}`, label: text };
  if (key === "other" || fromText === "other") return { value: "other", label: REASON_LABEL.other };
  return { value: REASON_UNSPECIFIED, label: "미기재" };
}

/**
 * 세부 사유 칸(2단계 — `reason-detail.ts`) — 대분류 막대를 고른 뒤 그 아래에 선다(`detail=` 필터와 같은 값: 세부 키 · 고르지 않은 줄은 `none`).
 * 순서 = 학원이 고르는 목록 순서(많은 순 아님 — 같은 대분류 안에서 늘 같은 자리) · 세부 미기재는 맨 끝.
 */
export function reasonDetailFacetOf(row: { detail: string | null }): string {
  return row.detail ?? FACET_NONE;
}

export function detailItems(rows: readonly { detail: string | null }[], reason: WithdrawalReason): BreakdownItem[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(reasonDetailFacetOf(r), (counts.get(reasonDetailFacetOf(r)) ?? 0) + 1);
  const order = [...REASON_DETAILS[reason].map((d) => d.key), FACET_NONE];
  return order
    .filter((k) => counts.has(k))
    .map((value) => ({ value, label: value === FACET_NONE ? "세부 미기재" : (reasonDetailOf(value)?.label ?? value), count: counts.get(value)! }));
}

/** 주소의 `detail=` 값 → 라벨. 모르는 값은 null. */
export function detailFacetLabel(value: string): string | null {
  return value === FACET_NONE ? "세부 미기재" : (reasonDetailOf(value)?.label ?? null);
}

/** 주소의 `reason=` 값 → 화면 라벨(범위 문구·드롭다운). 모르는 값은 null. */
export function reasonFacetLabel(value: string): string | null {
  if (value === REASON_CLEANUP) return "장부 정리";
  if (value === REASON_UNSPECIFIED) return "미기재";
  if (value.startsWith(REASON_TEXT_PREFIX)) return value.slice(REASON_TEXT_PREFIX.length) || null;
  return Object.hasOwn(REASON_LABEL, value) ? REASON_LABEL[value as WithdrawalReason] : null;
}

// ─────────────────────────────── 강사 가리기 ───────────────────────────────

/** 판정 한 벌(`server/exit-teacher-judge.ts`)에서 쓰는 것 — 순수 함수로 시험할 수 있게 모양만 받는다. */
export type TeacherJudge = {
  /** 그만둘 때 다니던 반의 그날 담임(`exit-homeroom.ts` — 퇴원생 관리 차트의 '담당선생님'과 같은 기준). */
  homeroomOf(studentId: string, subject: string, date: string): string[];
};

type JudgeRow = { key: string; studentId: string; date: string | null; subjects: readonly string[]; systemBulk: boolean; cleanup: boolean };

/** 줄 하나의 판정 — 과목 → 그 과목 퇴원을 퇴원율에 센 선생님 id(빈 배열 = 그 과목은 담당 미반영). */
export type RowTeachers = ReadonlyMap<string, readonly string[]>;

/**
 * 줄 → 과목마다 그 과목을 그만둘 때 다니던 반의 그날 담임 id(시간표 X와 같은 판정 `homeroomOf`). 🔴 강사평가 퇴원율이 센 선생님이
 * 아니다(원장 2026-11-11 — 퇴원율은 지난달 담당·교시 담당까지 붙어 퇴원생 관리 차트와 어긋났다). 🔑 줄의 **모든 과목**을 판정해 둔다 — 걸린 과목 필터는 읽는 쪽이
 * 고른다(`teacherFacetsIn` — 과목 카드가 과목마다 다시 물어도 같은 판정이라 칸 숫자 = 눌러 거른 명단 수).
 * - 장부 정리 · 날짜 미상(시스템 정리) · 날짜 없는 줄 = 모든 과목 빈 배열('담당 미반영' — X도 이 줄을 세지 않는다)
 * - `from`(가장 이른 날)보다 앞 · 오늘 뒤 줄 = 판정하지 않는다(결과에 없음 — 화면이 '강사를 가리지 않은 줄'로 따로 센다)
 */
export function attributeTeachers<R extends JudgeRow>(
  rows: readonly R[],
  judge: TeacherJudge,
  opts: { from: string; today: string },
): Map<string, RowTeachers> {
  const out = new Map<string, RowTeachers>();
  for (const r of rows) {
    if (r.cleanup || r.systemBulk || !r.date) {
      out.set(r.key, new Map(r.subjects.map((s) => [s, []])));
      continue;
    }
    if (r.date < opts.from || r.date > opts.today) continue;
    const date = r.date;
    out.set(r.key, new Map(r.subjects.map((s) => [s, judge.homeroomOf(r.studentId, s, date)])));
  }
  return out;
}

/**
 * 판정한 줄의 강사 칸 값(고른 과목들 — `judgeSubjects`) — 과목마다 센 선생님(겹치면 한 번) + 아무도 안 센 과목이 하나라도 있으면
 * '담당 미반영'(수학은 김선생이 세고 영어는 아무도 안 셌으면 김선생 · 담당 미반영 둘 다).
 * 🔑 강사 칸 숫자(`teacherItems`)와 강사 칸 필터가 이 한 함수를 쓴다 — 칸 숫자 = 눌러 거른 명단 수 · 과목 카드가 과목마다 물어도
 * 합친 답과 어긋나지 않는다(적대 리뷰 2026-10-15). 과목 미상(빈 배열) = '담당 미반영' · null(걸린 범위 밖) = null.
 */
export function teacherFacetsIn(row: RowTeachers, subjects: readonly string[] | null): string[] | null {
  if (!subjects) return null;
  const ids = new Set<string>();
  let none = subjects.length === 0;
  for (const s of subjects) {
    const t = row.get(s) ?? [];
    if (!t.length) none = true;
    for (const id of t) ids.add(id);
  }
  return none ? [...ids, FACET_NONE] : [...ids];
}
