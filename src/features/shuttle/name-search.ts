/**
 * 아이 이름 검색 — 글자 일부("민준")나 **초성**("ㄱㅁㅈ", "김ㅁ")으로 찾는다. 띄어쓰기는 무시한다.
 * 🔑 빈 검색어는 모두 맞다(검색칸을 비우면 전원이 보인다).
 */
const CHOSUNG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

/** 완성형 한글이면 그 초성, 아니면 글자 그대로. */
function chosungOf(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code < HANGUL_START || code > HANGUL_END) return ch;
  return CHOSUNG[Math.floor((code - HANGUL_START) / 588)]!;
}

const isChosung = (ch: string) => CHOSUNG.includes(ch);

export function matchesName(name: string, query: string): boolean {
  const q = query.replace(/\s+/g, "").toLowerCase();
  if (!q) return true;
  const n = name.replace(/\s+/g, "").toLowerCase();
  if (n.includes(q)) return true;
  // 초성이 섞인 검색어 — 검색어의 초성 칸은 이름 글자의 초성과, 나머지 칸은 글자 그대로 맞춘다.
  if (![...q].some(isChosung)) return false;
  const chars = [...n];
  const qs = [...q];
  for (let i = 0; i + qs.length <= chars.length; i++) {
    if (qs.every((c, j) => (isChosung(c) ? chosungOf(chars[i + j]!) === c : chars[i + j] === c))) return true;
  }
  return false;
}
