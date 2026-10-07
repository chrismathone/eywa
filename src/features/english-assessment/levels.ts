/**
 * 영어 평가 **수준 축** — L1~L9(유치~초2 … 고3). 원장 2026-10-07 레퍼런스(NELT 성적표)의 축을 그대로 쓴다.
 * 모든 수준 판정·동학년 비교·문장이 이 표 한 벌을 본다(화면마다 라벨을 새로 적지 말 것).
 * ⚠️ 순수 모듈 — 클라(성적표 화면)도 import한다. `server-only`·`@/` 별칭 금지(시안 스크립트가 그대로 번들한다).
 */

export type Level = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const LEVELS: readonly { level: Level; short: string; label: string }[] = [
  { level: 1, short: "유치~초2", label: "유치~초등학교 2학년" },
  { level: 2, short: "초3~4", label: "초등학교 3~4학년" },
  { level: 3, short: "초5~6", label: "초등학교 5~6학년" },
  { level: 4, short: "중1", label: "중학교 1학년" },
  { level: 5, short: "중2", label: "중학교 2학년" },
  { level: 6, short: "중3", label: "중학교 3학년" },
  { level: 7, short: "고1", label: "고등학교 1학년" },
  { level: 8, short: "고2", label: "고등학교 2학년" },
  { level: 9, short: "고3", label: "고등학교 3학년" },
];

export function isLevel(v: unknown): v is Level {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 9;
}

export function levelShort(l: Level): string {
  return LEVELS[l - 1]!.short;
}

export function levelLabel(l: Level): string {
  return LEVELS[l - 1]!.label;
}

/**
 * 학생 학년 문자열 → 그 학년의 **기대 수준**. "중1"·"중학교 1학년"·"초4"·"고2"·"7세" 같은 흔한 꼴만 읽는다.
 * 모르면 null(지어내지 않는다 — 학년 대비 문장·동학년 비교를 그리지 않는다).
 */
export function gradeToLevel(grade: string | null | undefined): Level | null {
  const g = (grade ?? "").replace(/\s|학년|등학교|학교/g, "");
  const m = /^(초|중|고)(\d)/.exec(g);
  if (m) {
    const n = Number(m[2]);
    if (m[1] === "초") return n <= 2 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : null;
    if (m[1] === "중") return n >= 1 && n <= 3 ? ((3 + n) as Level) : null;
    if (m[1] === "고") return n >= 1 && n <= 3 ? ((6 + n) as Level) : null;
  }
  if (/^[4-7]세$|^유치/.test(g)) return 1;
  return null;
}
