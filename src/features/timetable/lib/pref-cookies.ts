// 시간표 표시 선호(기기 기억) 쿠키 이름 — ⚠️ 반드시 이 **일반 모듈**에서 import할 것.
//
// 원래 "use client" 모듈(prefs-sync.tsx)이 export하던 상수를 서버 컴포넌트(page.tsx)가 import했는데,
// 클라이언트 모듈의 비컴포넌트 export는 서버 그래프에서 **클라이언트 참조 프록시**가 되어 문자열이
// 런타임 undefined로 평가됐다(2026-07-19 실측 — `cookieStore.get(undefined)`가 항상 미적중 → 쿠키
// 기본값이 조용히 죽고 URL 파라미터 경로만 동작). 타입체크는 통과하는 침묵 버그라, 클라·서버가 함께
// 쓰는 상수는 이렇게 지시어 없는 공용 모듈에 둔다. 쓰기(prefs-sync)와 읽기(page)가 둘 다 여기서 읽는다.

/** 강사뷰 '미사용 요일' 선호 — "hide" | "show". */
export const EMPTY_DAYS_COOKIE = "eywa-tt-emptydays";

/** 기본뷰 '빈 교시 접기' 선호 — "collapse" | "expand". */
export const EMPTY_PERIODS_COOKIE = "eywa-tt-emptyperiods";

/** '학생 명단 접기' 선호 — "hide" | "show". 계정(ui_prefs)이 진실이고 이건 이관용 폴백(위 둘과 같은 규약). */
export const STUDENTS_COOKIE = "eywa-tt-students";

/**
 * 통합뷰 '1시간 단위'(섹션별 압축) 선호 — **과목별**로 기억한다.
 *
 * 값 형식: `english:540.600~math:480` (레코드 `~`, 과목:목록 `:`, 섹션키 `.`).
 * ⚠️ 구분자로 `,`·`;`·공백을 쓰지 않는 이유: 쿠키 값 문법(RFC 6265 cookie-octet)이 그 셋을 빼서,
 * 인코딩 없이 서버·클라가 같은 문자열을 읽으려면 안전한 문자만 써야 한다.
 *
 * 과목별인 이유: 섹션키 = 시작 교시(자정 기준 분)라 **과목마다 섹션 구성이 다르다**. 하나로 합치면
 * 영어에서 접어둔 섹션이 수학에서 엉뚱한 줄을 접는다(그래서 원래도 과목 전환 시 초기화했다).
 */
export const COMPACT1H_COOKIE = "eywa-tt-compact1h";

/**
 * URL 파라미터에서 '전부 펼침'을 **명시**하는 센티널(`?compact1h=none`).
 * 빈 값을 그냥 생략하면 "파라미터 없음 = 쿠키 참조"와 구분이 안 돼 해제가 되살아난다.
 */
export const COMPACT1H_NONE = "none";

/** 쿠키 원문 → `{ 과목키: 섹션키[] }`. 깨진 조각은 조용히 버린다(옛 형식·수기 편집 방어). */
export function parseCompact1hCookie(raw: string | undefined | null): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!raw) return out;
  for (const rec of raw.split("~")) {
    const idx = rec.indexOf(":");
    if (idx <= 0) continue;
    const subject = rec.slice(0, idx);
    const sections = rec
      .slice(idx + 1)
      .split(".")
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (sections.length) out[subject] = [...new Set(sections)].sort((a, b) => a - b);
  }
  return out;
}

/** `{ 과목키: 섹션키[] }` → 쿠키 원문. 빈 목록인 과목은 아예 안 적는다(= 그 과목은 '전부 펼침'). */
export function serializeCompact1hCookie(map: Record<string, number[]>): string {
  return Object.entries(map)
    .filter(([subject, sections]) => subject && !subject.includes(":") && !subject.includes("~") && sections.length)
    .map(([subject, sections]) => `${subject}:${[...new Set(sections)].sort((a, b) => a - b).join(".")}`)
    .join("~");
}

/** 그 과목의 압축 섹션만 꺼낸다(없으면 빈 배열 = 전부 펼침). */
export function readCompact1hFor(raw: string | undefined | null, subject: string): number[] {
  return parseCompact1hCookie(raw)[subject] ?? [];
}

/**
 * 그 과목의 값만 갈아끼운 쿠키 원문을 만든다 — **다른 과목 설정은 보존**(과목을 오갈 때마다 서로를
 * 지우면 "체크가 풀린다"가 그대로 재현된다).
 */
export function writeCompact1hFor(
  raw: string | undefined | null,
  subject: string,
  sections: number[],
): string {
  const map = parseCompact1hCookie(raw);
  if (sections.length) map[subject] = sections;
  else delete map[subject];
  return serializeCompact1hCookie(map);
}
