/**
 * 코드값 → 한국어 이름 안전망 — 원장 2026-11-06 *"이런 과정에서 나오는 status도 풀이해서" · "과목도 한글화 시키고 다 사용자 입장에서"*.
 * 프롬프트가 SQL에서 CASE로 바꾸라고 시키지만(prompt.ts '원장이 읽는 말'), 빠뜨린 칸이 화면에 `math`·`present`로 나가지 않게
 * 보고서를 확정할 때(report.ts settleReport) 표·차트 자료에서 한 번 더 바꾼다.
 *
 * 🔴 **칸 단위로만** — 한 칸의 글자 값이 **모두** 한 묶음의 코드일 때만 바꾼다(한 칸에 다른 글자가 섞이면 그 칸은 그대로).
 *    `active`·`manual`·`done`처럼 여러 표에서 뜻이 갈리는 흔한 낱말은 묶음에 넣지 않는다 — 엉뚱한 이름이 붙는 것보다 영어가 낫다.
 *    여러 묶음에 다 맞으면(예: 값이 `teacher` 하나) 이름이 모두 같을 때만 바꾼다.
 * 🔴 AI가 보는 조회 결과는 바꾸지 않는다 — 바뀐 이름을 보고 다음 조회 조건에 `'수학'`을 쓰면 0행이 된다. 화면·저장용 자료에만.
 * 과목 이름의 정답은 학원 설정(tenant_settings data->'operations'->'subjects' key→label)이다 — 여기 넷은 지금 쓰는 키(2026-11-06 운영 확인).
 */
import { REASON_ALIAS, REASON_LABEL } from "@/features/withdrawals/types";

type Cell = string | number | boolean | null;
type Row = Record<string, Cell>;

/**
 * `minDistinct` — 다른 표에도 같은 낱말이 다른 뜻으로 있는 묶음은 서로 다른 코드가 이만큼 보일 때만 바꾼다.
 * `weak` — 흔한 낱말(other·schedule 등)이라 **그것들만** 있는 칸은 바꾸지 않는다(그 묶음의 다른 코드가 함께 보이거나 서로 다른 코드가 둘 이상일 때만).
 */
type Family = { codes: Readonly<Record<string, string>>; minDistinct: number; weak?: readonly string[]; column?: RegExp };

/** 퇴원 사유 — 표준 키 + 옛 자료 표기 흔들림(dissatisfied·moved…)까지 같은 이름(퇴원관리 reasonDisplay와 같은 단일 소스). */
const REASON_CODES: Record<string, string> = { ...REASON_LABEL };
for (const [alias, key] of Object.entries(REASON_ALIAS)) REASON_CODES[alias] = REASON_LABEL[key];

/** 요일 — `to_char(날짜,'dy')`·시간표 요일 칸(mon…sun). 'Dy'·'DY' 꼴도 같은 이름으로. */
const WEEKDAY_CODES: Record<string, string> = {};
for (const [code, name] of Object.entries({ mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" })) {
  for (const form of [code, code[0]!.toUpperCase() + code.slice(1), code.toUpperCase()]) WEEKDAY_CODES[form] = name;
}

const FAMILIES: readonly Family[] = [
  // 출결 상태(attendance_records.status) — excused는 앱 출석부가 '공결'로 보인다(units-master · 적대 리뷰 2026-11-06)
  { codes: { present: "출석", late: "지각", absent: "결석", excused: "공결", early_leave: "조퇴", makeup: "보강" }, minDistinct: 1 },
  // 원생 상태(students.status) — 🔴 on_hold(보강 건 '보류')·enrolled(상담 결과·재등록 '등록')는 다른 표에서 뜻이 달라
  //    코드 하나만 있는 칸(조건으로 거른 결과)은 바꾸지 않는다 — 둘 이상 섞여 있을 때만(적대 리뷰 2026-11-06).
  { codes: { prospect: "예비", consulted: "상담완료", enrolled: "재원", on_hold: "휴원", withdrawn: "퇴원" }, minDistinct: 2 },
  // 과목 키(classes.subject 등)
  { codes: { math: "수학", english: "영어", korean: "국어", science: "과학" }, minDistinct: 1 },
  // 직원 역할(users.system_role) — viewer·student는 흔한 낱말이라 뺀다
  { codes: { master: "원장", admin: "관리자", manager: "매니저", teacher: "강사", counselor: "상담사", accountant: "회계", parttime: "아르바이트" }, minDistinct: 1 },
  // 출결 입력 주체(attendance_records.recorded_via)
  { codes: { teacher: "강사", desk: "데스크", seat: "자리", kiosk: "키오스크" }, minDistinct: 1 },
  // 퇴원 사유(onto_students·onto_enrollments.withdrawal_reason · 퇴원 정보 reason) — 이름은 퇴원관리와 같은 단일 소스(REASON_LABEL).
  // 멘트 시험 2026-11-11: graduated·dissatisfaction이 표에 그대로 나갔다. 흔한 낱말은 다른 사유 코드와 섞일 때만.
  // 🔴 칸 이름이 사유일 때만 — 지식 기록의 competitor(경쟁 학원 '언급')가 '타 학원으로 이동'이 되면 뜻이 바뀐다(Codex 리뷰 2026-11-11).
  // 칸 이름에 '이유'도 · 상담 태그 칸은 뺀다(상담 평점 태그 schedule이 '시간/일정'이 되면 뜻이 바뀐다 — 최종 리뷰 2026-11-11).
  { codes: REASON_CODES, minDistinct: 1, column: /^(?!.*(상담|태그|tag|consult))(?=.*(사유|이유|reason))/i },
  // 요일(멘트 시험 2026-11-11: 'mon'이 표에 나갔다) — 🔴 칸 이름이 요일일 때만(시험 이름 SAT · 이름 Sun이 '토'·'일'이 되지 않게).
  { codes: WEEKDAY_CODES, minDistinct: 1, column: /요일|weekday|dow|^day(_of_week)?$/i },
  // 직원 재직 상태(users.status) — 원장 2026-11-11 *"여전히 날것이 출력되는 문제도 해결해 active 이런거"*. active는 반·수강에서 뜻이 달라 칸 이름이 재직일 때만.
  { codes: { active: "재직", inactive: "퇴사", pending: "대기" }, minDistinct: 1, column: /재직|근무 ?상태|직원 ?상태/ },
  // 자료 출처(student_history_monthly.source 등) — 화면 제품 이름은 에이와(CLAUDE.md 'UI 제품명').
  { codes: { aywa: "에이와", makeedu: "메이크에듀" }, minDistinct: 1, column: /출처|source|기록 ?방식/i },
  // 글로 바뀐 참·거짓(SQL에서 ::text 한 칸 — 화면이 'true'로 보였다 · 진짜 참·거짓 값은 표가 이미 예·아니오로 그린다).
  { codes: { true: "예", false: "아니오", t: "예", f: "아니오" }, minDistinct: 1, weak: ["t", "f"] },
];

const HANGUL = /[가-힣]/;

/**
 * 한 칸의 글자 값들이 모두 한 묶음 코드면 그 바꿈표, 아니면 null.
 * 이미 한국어인 값(AI가 CASE로 바꾸다 `else status`로 남긴 칸의 '출석' 등)은 건너뛰고 나머지 코드로 판정한다.
 * `column` = 칸 이름 — 칸 이름을 보는 묶음(퇴원 사유 · 요일)은 이름이 맞을 때만 쓴다(이름을 모르면 그 묶음은 건너뛴다).
 */
export function codeMapFor(values: Iterable<Cell>, column?: string): Readonly<Record<string, string>> | null {
  const strings = new Set<string>();
  for (const v of values) {
    if (typeof v !== "string" || HANGUL.test(v)) continue;
    strings.add(v);
    if (strings.size > 40) return null;
  }
  if (!strings.size) return null;
  const fits = FAMILIES.filter(
    (f) =>
      (!f.column || (column !== undefined && f.column.test(column))) &&
      strings.size >= f.minDistinct &&
      [...strings].every((s) => Object.hasOwn(f.codes, s)) &&
      // 흔한 낱말만 있는 칸은 바꾸지 않는다 — 칸 이름으로 이미 좁힌 묶음은 그 걱정이 없다(재리뷰 2026-11-11).
      (!f.weak || !!f.column || strings.size >= 2 || [...strings].some((s) => !f.weak!.includes(s))),
  ).map((f) => f.codes);
  if (!fits.length) return null;
  const map: Record<string, string> = {};
  for (const s of strings) {
    const names = new Set(fits.map((f) => f[s]));
    if (names.size !== 1) return null;
    map[s] = fits[0][s];
  }
  return map;
}

/** 저장된 보고서 자료 묶음 전체 — 이 안전망 전에 저장된 답을 다시 열 때도 같은 이름으로(store.threadDetail). */
export function labelDatasets<D extends { columns: string[]; rows: Row[] }>(sets: Readonly<Record<string, D>>): Record<string, D> {
  const out: Record<string, D> = {};
  for (const [key, d] of Object.entries(sets)) {
    const rows = Array.isArray(d?.columns) && Array.isArray(d?.rows) ? labelCodeColumns(d.columns, d.rows) : null;
    out[key] = rows && rows !== d.rows ? { ...d, rows } : d;
  }
  return out;
}

/** 표·차트 자료의 코드 칸을 한국어 이름으로 — 바꿀 칸이 없으면 받은 배열을 그대로 돌려준다. */
export function labelCodeColumns<T extends Row>(columns: readonly string[], rows: readonly T[]): T[] {
  const maps = new Map<string, Readonly<Record<string, string>>>();
  for (const c of columns) {
    const map = codeMapFor(rows.map((r) => r[c] ?? null), c);
    if (map) maps.set(c, map);
  }
  if (!maps.size) return rows as T[];
  return rows.map((r) => {
    const out: Row = { ...r };
    for (const [c, map] of maps) {
      const v = out[c];
      if (typeof v === "string" && Object.hasOwn(map, v)) out[c] = map[v];
    }
    return out as T;
  });
}
