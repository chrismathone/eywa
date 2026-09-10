/**
 * AI가 쓴 코멘트에 **학생 이름이 들어 있는가** — 순수 함수(Vitest로 잠금).
 *
 * 영어 보고서 규칙(사용자 2026-09-10): *"AI가 자동 생성 시 학생의 이름을 최소 1번 언급"*.
 * 프롬프트에 적는 것만으로는 "항상"이 성립하지 않는다(모델이 가끔 빼먹는다) — 그래서 생성 뒤
 * 코드가 확인하고, 없으면 호출부가 한 번 다시 만들거나 화면에 경고한다.
 *
 * 부르는 이름으로 인정하는 것:
 *  · 성+이름(`공서연`) — 글 어디에 있든
 *  · 이름만(`서연`) — **낱말로 쓰였을 때만**(뒤에 호칭·조사나 띄어쓰기). 이름이 흔한 낱말이면(`수정`·`하나`)
 *    `수정해`·`하나씩` 같은 글자에 걸려 "이름이 있다"고 잘못 판정하므로 경계를 본다(적대 리뷰 2026-09-10).
 *    두 글자 이상일 때만(한 글자는 어디에나 섞인다).
 *  · 영어 이름(있으면)
 * ⚠️ 동명이인 접미 알파벳(`박서연C`)은 **한글 이름 끝의 대문자 한 자**만 뗀다 — 로마자 이름(`Kevin`)을 통째로
 *    지워 "판정할 이름 없음 = 통과"가 되는 것을 막는다.
 * ⚠️ 두 글자 성: 세 글자 이름(`남궁민`)은 이름만 떼면 한 글자라 성+이름만 인정한다(`궁민`으로 부르지 않게).
 */

/** 두 글자 성 — 이름만 떼어낼 때 한 글자를 더 뗀다(`남궁민수` → `민수`). */
const TWO_CHAR_SURNAMES = ["남궁", "제갈", "선우", "황보", "독고", "사공", "서문"] as const;

/**
 * 이름 뒤에 올 수 있는 호칭·조사(없으면 띄어쓰기·문장부호·끝).
 * ⚠️ 한계: 이름이 흔한 낱말이면(`하나`·`수정`) "하나도"·"수정을"처럼 **낱말+조사**도 이름으로 읽힌다 — 글자만으로는
 *    가를 수 없다. 흔한 낱말 이름은 드물고, 틀려도 결과는 "이름이 있다고 봄"(재생성 1회를 안 할 뿐)이다.
 */
const AFTER_GIVEN =
  "(?:이|아|야|은|는|가|의|을|를|에게|한테|께서|께|과|와|랑|도|만|님|씨|학생|처럼|보다|에서|에|으로|로|까지|부터|[^가-힣]|$)";

/** 동명이인 접미(한글 이름 끝의 대문자 한 자)·공백 제거. */
function baseName(name: string): string {
  return name.replace(/\s+/g, "").replace(/([가-힣])[A-Z]$/, "$1");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 한글 이름에서 이름만(성 뗀 것). 두 글자 이상일 때만, 아니면 null. */
export function givenNameOf(name: string | null | undefined): string | null {
  const base = baseName(name ?? "");
  if (!/^[가-힣]{3,}$/.test(base)) return null;
  const cut = TWO_CHAR_SURNAMES.some((s) => base.startsWith(s)) ? 2 : 1;
  const given = base.slice(cut);
  return given.length >= 2 ? given : null;
}

/** 인정하는 호칭 목록(중복 제거). 판정할 이름이 없으면 빈 배열. */
export function studentNameVariants(name: string | null | undefined, englishName?: string | null): string[] {
  const out = new Set<string>();
  const base = baseName(name ?? "");
  if (base) out.add(base);
  const given = givenNameOf(name);
  if (given) out.add(given);
  const en = (englishName ?? "").trim();
  if (en.length >= 2) out.add(en);
  return [...out];
}

/**
 * 글에 학생 호칭이 하나라도 있는가. 판정할 이름이 없으면 `true`(없는 이름을 요구해 멀쩡한 글을
 * 막지 않는다 — 이름이 비는 건 호출부 버그라 여기서 발송을 막을 일이 아니다).
 */
export function mentionsStudentName(
  text: string | null | undefined,
  name: string | null | undefined,
  englishName?: string | null,
): boolean {
  const base = baseName(name ?? "");
  const given = givenNameOf(name);
  const en = (englishName ?? "").trim();
  if (!base && en.length < 2) return true;
  const body = text ?? "";
  if (base && body.includes(base)) return true;
  if (given && new RegExp(`(?:^|[^가-힣])${escapeRe(given)}${AFTER_GIVEN}`).test(body)) return true;
  if (en.length >= 2 && body.toLowerCase().includes(en.toLowerCase())) return true;
  return false;
}
