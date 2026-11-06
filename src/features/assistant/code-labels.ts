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
type Cell = string | number | boolean | null;
type Row = Record<string, Cell>;

/** `minDistinct` — 다른 표에도 같은 낱말이 다른 뜻으로 있는 묶음은 서로 다른 코드가 이만큼 보일 때만 바꾼다. */
type Family = { codes: Readonly<Record<string, string>>; minDistinct: number };

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
];

const HANGUL = /[가-힣]/;

/**
 * 한 칸의 글자 값들이 모두 한 묶음 코드면 그 바꿈표, 아니면 null.
 * 이미 한국어인 값(AI가 CASE로 바꾸다 `else status`로 남긴 칸의 '출석' 등)은 건너뛰고 나머지 코드로 판정한다.
 */
export function codeMapFor(values: Iterable<Cell>): Readonly<Record<string, string>> | null {
  const strings = new Set<string>();
  for (const v of values) {
    if (typeof v !== "string" || HANGUL.test(v)) continue;
    strings.add(v);
    if (strings.size > 40) return null;
  }
  if (!strings.size) return null;
  const fits = FAMILIES.filter((f) => strings.size >= f.minDistinct && [...strings].every((s) => Object.hasOwn(f.codes, s))).map((f) => f.codes);
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
    const map = codeMapFor(rows.map((r) => r[c] ?? null));
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
