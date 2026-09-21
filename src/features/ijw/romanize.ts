/**
 * 인재원 로그인 아이디 ↔ 한글 이름 **머리글자 추정** — 순수 함수(Vitest로 잠금).
 *
 * 인재원 영어 학생은 대부분 표시 이름이 따로 없어 `name`이 로그인 아이디(`ijwgsy`)다(anki 세션 확인 2026-09-10).
 * 아이디는 `ijw` + 이름 음절의 로마자 머리글자로 보인다(`ijwgsy` = 공 Gong · 서 Seo · 연 Yeon). 그래서 이름이 같은지로는
 * 거의 못 잇는다 — 대신 머리글자가 맞는 aywa 학생을 **후보로 보여 준다**.
 *
 * 🔴 **후보일 뿐이다** — 김서윤·공서연은 둘 다 `gsy`다. 잇는 것은 관리자가 확인하고 누른다(자동 연결·일괄 연결 금지).
 * ⚠️ 로마자 표기가 사람마다 달라(김 Gim/Kim · 이 Lee/Yi · 박 Park) 음절마다 흔한 첫 글자를 여럿 허용한다.
 */

/** 초성 19자 → 로마자 첫 글자 후보(ㅇ은 모음으로 정한다 — 빈 배열). */
const CHO_FIRST: readonly (readonly string[])[] = [
  ["g", "k"], // ㄱ
  ["k", "g"], // ㄲ
  ["n"], // ㄴ
  ["d", "t"], // ㄷ
  ["t", "d"], // ㄸ
  ["r", "l", "y", "n"], // ㄹ (류 Ryu/Yu · 라 Ra/La · 노/로 혼용)
  ["m"], // ㅁ
  ["b", "p"], // ㅂ (박 Bak/Park)
  ["p", "b"], // ㅃ
  ["s"], // ㅅ
  ["s"], // ㅆ
  [], // ㅇ
  ["j", "c"], // ㅈ (조 Jo/Cho)
  ["j"], // ㅉ
  ["c"], // ㅊ
  ["k"], // ㅋ
  ["t"], // ㅌ
  ["p"], // ㅍ
  ["h"], // ㅎ
];

/** 초성이 ㅇ일 때 중성 21자 → 첫 글자 후보. */
const JUNG_FIRST: readonly (readonly string[])[] = [
  ["a"], // ㅏ
  ["a"], // ㅐ
  ["y"], // ㅑ
  ["y"], // ㅒ
  ["e"], // ㅓ (eo)
  ["e"], // ㅔ
  ["y"], // ㅕ
  ["y"], // ㅖ
  ["o"], // ㅗ
  ["w"], // ㅘ
  ["w"], // ㅙ
  ["o", "w"], // ㅚ
  ["y"], // ㅛ
  ["u", "w"], // ㅜ (우 Woo)
  ["w"], // ㅝ
  ["w"], // ㅞ
  ["w"], // ㅟ
  ["y"], // ㅠ
  ["e"], // ㅡ (eu)
  ["u", "e"], // ㅢ
  ["i", "y", "l"], // ㅣ (이 I/Yi/Lee · 임 Im/Lim)
];

const SYLLABLE_MIN = 0xac00;
const SYLLABLE_MAX = 0xd7a3;

/** 한글 이름 → 가능한 머리글자 문자열들(소문자, 중복 제거). 한글 음절이 없거나 5자를 넘으면 빈 배열. */
export function romanInitialSets(name: string): string[] {
  const syllables = [...(name ?? "").replace(/\s+/g, "")].filter((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return c >= SYLLABLE_MIN && c <= SYLLABLE_MAX;
  });
  if (syllables.length === 0 || syllables.length > 5) return [];
  let acc = [""];
  for (const ch of syllables) {
    const code = (ch.codePointAt(0) ?? SYLLABLE_MIN) - SYLLABLE_MIN;
    const cho = Math.floor(code / 588);
    const jung = Math.floor((code % 588) / 28);
    const opts = cho === 11 ? JUNG_FIRST[jung] ?? [] : CHO_FIRST[cho] ?? [];
    if (opts.length === 0) return [];
    acc = acc.flatMap((a) => opts.map((o) => a + o));
  }
  return [...new Set(acc)];
}

/** 아이디의 이름 부분 — `ijw` 접두·숫자·기호를 뗀 소문자(`ijwgsy2` → `gsy`). */
export function ijwIdCore(ijwId: string): string {
  return (ijwId ?? "").toLowerCase().replace(/^ijw/, "").replace(/[^a-z]/g, "");
}

/** 인재원 아이디가 이 이름의 머리글자 꼴인가(후보 표시용 — 확정 아님). */
export function ijwIdMatchesName(ijwId: string, name: string): boolean {
  const core = ijwIdCore(ijwId);
  if (core.length < 2) return false;
  return romanInitialSets(name).includes(core);
}
