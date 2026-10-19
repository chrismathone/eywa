/**
 * AI 분석 섹션 후처리 공용 도구 — 모델이 바뀌어도 **화면에 놓이는 모양은 그대로**가 되게 한다(원장 2026-10-19
 * *"하네스를 강력하게 먹여서 기존과 괴리감이 없도록"*). 순수 함수(Vitest) — 서버·클라 어디서든.
 *
 * 무엇을 맞추나(블라인드 비교에서 실제로 갈린 것만 — 2026-10-19 형식 실측):
 * - 나열 섹션을 산문으로 씀(V4.1 flash 콜&상담 5건 중 7개 섹션 · v4-pro 0) → 문장마다 '- ' 불릿으로.
 * - 다른 불릿 기호(•·* 1. ①) → '- '. 산문 섹션의 불릿 → 문장으로.
 * - 문자열 자리에 배열·숫자·참거짓 → 문자열로. 글자 그대로 들어간 `\n` → 줄바꿈.
 * - 굵게(**) — 금지인 곳은 지우고, 허용인 곳은 짝이 안 맞는 것만 지운다.
 * - 화자 기호 — 금지인 곳은 역할 이름으로, 허용인 곳은 기존 꼴('원장(A)')로.
 * 🔴 **내용은 바꾸지 않는다** — 고치는 것은 모양뿐이다(문장을 지어내거나 지우지 않는다). **애매하면 손대지 않는다** —
 *    모양이 덜 맞는 것은 화면 후보정이 받아 주지만, 바뀐 내용은 아무도 되돌리지 못한다(2026-10-19 적대적 리뷰 2회).
 */

export type BoldRule = "strip" | "balance";
export type SpeakerRule = "strip" | "compact";

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** 영문 식별자 키(owner·task·due) — 원문 키를 화면에 내지 않으려고 값만 쓴다. 대문자 한 글자는 화자('화자 A: …'). */
const CODE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
function keyed(k: string, text: string): string {
  if (/^[A-Z]$/.test(k)) return `화자 ${k}: ${text}`;
  return CODE_KEY.test(k) ? text : `${k}: ${text}`;
}
const oneLine = (t: string) => t.replace(/\s*\n\s*/g, " ").trim();

/** 배열 안의 객체 한 개 = 한 항목 — 칸들을 ' · '로 잇는다(담당·할 일·기한이 따로 떨어지지 않게). */
function objectLine(o: Record<string, unknown>): string {
  return Object.entries(o)
    .map(([k, v]) => {
      const t = oneLine(toText(v));
      return t ? keyed(k, t) : "";
    })
    .filter(Boolean)
    .join(" · ");
}

/** 문자열 자리에 온 값을 문자열로 — 배열은 원소마다 한 줄, 객체는 칸마다 한 줄('키: 값' · 영문 키는 값만). */
export function toText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    return v
      .map((x) => (isPlainObject(x) ? objectLine(x) : toText(x)))
      .filter((s) => s.trim())
      .join("\n");
  }
  if (isPlainObject(v)) {
    return Object.entries(v)
      .map(([k, x]) => {
        const t = oneLine(isPlainObject(x) ? objectLine(x) : toText(x));
        return t ? keyed(k, t) : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** 값 전체가 '빈 칸' 표시인 것 — 나열 섹션에 '- -'·'- null' 불릿이 서지 않게. ('없음'은 말한 사실일 수 있어 남긴다.) */
const EMPTY_MARK = /^(?:[-–—]|null|undefined|n\/?a)$/i;

/** 모양 기초 정리 — 글자 `\n` · 코드 펜스 · 머리말(#) · 줄 끝 공백 · 빈 줄 겹침 · 빈 칸 표시. */
export function baseClean(text: string): string {
  const t = text
    .replace(/\r\n?/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/^```[a-z]*\s*$/gim, "")
    .replace(/^#{1,6}\s+/gm, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return EMPTY_MARK.test(t) ? "" : t;
}

export function applyBold(text: string, rule: BoldRule): string {
  if (rule === "strip") return text.replace(/\*\*/g, "");
  // 짝이 안 맞는 줄만 — 그 줄의 마지막 ** 하나를 지운다(남은 짝은 그대로).
  return text
    .split("\n")
    .map((line) => {
      const n = (line.match(/\*\*/g) ?? []).length;
      if (n % 2 === 0) return line;
      const i = line.lastIndexOf("**");
      return line.slice(0, i) + line.slice(i + 2);
    })
    .join("\n");
}

/** 마지막 글자의 받침 번호(없으면 0 · 한글 음절이 아니면 0). ㄹ = 8. */
function jong(word: string): number {
  const c = word.charCodeAt(word.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : 0;
}
/** [받침 있을 때, 없을 때] — 화자 글자(에이·비)에 붙어 있던 조사를 바꾼 낱말에 맞춘다('학생 A가' → '학생이'). */
const JOSA_PAIRS: readonly [string, string][] = [["은", "는"], ["이", "가"], ["을", "를"], ["과", "와"], ["이랑", "랑"]];
function withJosa(word: string, josa: string | undefined): string {
  if (!josa) return word;
  const j = jong(word);
  if (josa === "로" || josa === "으로") return word + (j !== 0 && j !== 8 ? "으로" : "로");
  const pair = JOSA_PAIRS.find((p) => p.includes(josa));
  return word + (pair ? (j !== 0 ? pair[0] : pair[1]) : josa);
}
const ROLE_WORDS = "상담자|상담사|학부모|학생|어머니|아버지|어머님|아버님|엄마|아빠|보호자|선생님|원장님|원장";
// 화자 글자 뒤 = 끝·줄바꿈·문장 부호·조사 첫 글자만. 'A반'·'B등급'·'B+'·'Q&A'·'O/X'·'A 등급'은 화자 글자가 아니다(2026-10-19 리뷰).
const AFTER_LETTER = "(?![A-Za-z0-9])(?=$|\\s*\\n|\\s*[,.!?)\\]·:;]|[은는이가을를와과의도만에한께랑로으])";
// 조사 — '로/으로'·'랑/이랑'은 뒤에 말이 붙어도('로부터') 바꾸고, 나머지는 홀로 선 것만('이다'·'가요'는 건드리지 않는다).
const JOSA = "(?:(으로|로|이랑|랑)|(은|는|이|가|을|를|과|와)(?![가-힣]))?";
const ROLE_LETTER = new RegExp(`(${ROLE_WORDS})\\s?[A-Z]${AFTER_LETTER}${JOSA}`, "g");
const ROLE_PAREN = new RegExp(`(${ROLE_WORDS})\\s*\\(\\s*(?:화자\\s*)?[A-Z]\\s*\\)${JOSA}`, "g");
const SPEAKER_PAREN = new RegExp(`([가-힣])\\s*\\(\\s*화자\\s*[A-Z]\\s*\\)${JOSA}`, "g");
const SPEAKER_LETTER = new RegExp(`화자\\s*([A-Z])${AFTER_LETTER}${JOSA}`, "g");
// compact가 앞으로 옮기는 괄호 = 이름·직책 꼴만(낱말 한두 개 · 숫자·콜론 없음). '화자 B(추정: 실장)'·'화자 A(약 5분 지각)'는 그대로.
const NAME_IN_PAREN = "([^()\\n:：\\d\\s]{1,12}(?:\\s[^()\\n:：\\d\\s]{1,12})?)";
const COMPACT_MOVE = new RegExp(`화자\\s*([A-Z])\\s*\\(${NAME_IN_PAREN}\\)`, "g");

export type SpeakerOptions = { roles?: Record<string, string> | null; multi?: boolean };

/**
 * 화자 기호.
 * - strip(콜&상담 — 프롬프트가 금지): 역할 낱말 바로 뒤의 '(A)'·'(화자 A)' 지움('어머니(B)는' → '어머니는') ·
 *   '학부모 B가' → '학부모가' · '화자 A' → 그 화자의 역할. 조사는 바뀐 낱말에 맞춘다.
 *   '화자 A'를 역할로 바꾸지 않는 때: 역할을 모름 · 역할이 '기타' · **녹음이 여럿**(화자 글자는 녹음마다 따로라
 *   최근 녹음 기준 역할로 앞 녹음의 화자를 바꾸면 사람이 뒤바뀐다).
 *   🔴 역할 낱말이 아닌 말 뒤의 '(A)'('심화(A)반')와 'A반'·'B+' 같은 말은 건드리지 않는다(2026-10-19 리뷰).
 * - compact(회의록 — 기존 저장본 꼴 '노원장(A)'): '원장(화자 A)' → '원장(A)' · '화자 A(원장)' → '원장(A)'.
 */
export function applySpeakers(text: string, rule: SpeakerRule, opts: SpeakerOptions = {}): string {
  if (rule === "compact") {
    return text.replace(COMPACT_MOVE, "$2($1)").replace(/\(\s*화자\s*([A-Z])\s*\)/g, "($1)");
  }
  const roleOf = (x: string) => {
    const r = opts.roles && typeof opts.roles[x] === "string" ? opts.roles[x].trim() : "";
    return r && r !== "기타" && !opts.multi ? r : "";
  };
  return text
    .replace(ROLE_PAREN, (_m: string, role: string, j1?: string, j2?: string) => withJosa(role, j1 ?? j2))
    .replace(SPEAKER_PAREN, (_m: string, prev: string, j1?: string, j2?: string) => withJosa(prev, j1 ?? j2))
    .replace(ROLE_LETTER, (_m: string, role: string, j1?: string, j2?: string) => withJosa(role, j1 ?? j2))
    .replace(SPEAKER_LETTER, (m: string, x: string, j1?: string, j2?: string) => (roleOf(x) ? withJosa(roleOf(x), j1 ?? j2) : m))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.)!?])/g, "$1")
    .trim();
}

// '-'·'*'는 뒤에 빈칸이 있어야 불릿이다 — 줄 머리의 '**굵게**'·'-5점'을 불릿으로 먹지 않게(테스트가 잡음 2026-10-19).
// 번호 '1.'은 뒤가 날짜 꼴('10. 25.')이면 번호가 아니다(월을 지우지 않게) · 원 숫자는 바로 뒤에 한글이 붙으면('①번') 번호가 아니다.
const OTHER_BULLET = /^(?:[-–—*](?=\s)|[•·●▪◦‣]|\d{1,2}\.(?=\s)(?!\s*\d{1,2}\.)|\d{1,2}\)(?=\s)|[①-⑳](?![가-힣]))\s*/;

/**
 * 문장 끝에서 자른다 — 한글(또는 닫는 괄호·따옴표·%) 바로 뒤의 . ! ? 와 '(미답변)' 뒤만 문장 끝이다.
 * 소수점(3.5)·'Mr. Kim'·'10. 25.' 같은 숫자·영문 뒤의 마침표는 자르지 않는다.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[가-힣)\]"'”’%][.!?]|\(미답변\))\s+(?=\S)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** '→'로 시작하는 조각은 앞 조각(질문)에 붙인다 — 질문과 답이 다른 항목으로 떨어지지 않게. */
function joinAnswers(parts: string[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (p.startsWith("→") && out.length > 0) out[out.length - 1] = `${out[out.length - 1]} ${p}`;
    else out.push(p);
  }
  return out;
}

/** 통째로 한 항목인 줄 — '발언자: 내용'(굵게 머리 · 화자 표기가 든 머리). '주요 논거:'·'4:00'·'1:1'은 아니다. */
const SPEAKER_HEAD = /^(?:\*\*[^*\n]{1,25}\*\*|[^:：\n]{0,20}(?:\([A-Z]\)|화자\s?[A-Z]))\s*[:：]/;

/**
 * 나열 섹션 — 줄마다 '- '. 불릿이 하나도 없으면(산문으로 씀) 문장마다 한 줄(질문→답변은 한 항목 · 발언자 줄은 통째로).
 * 일부만 불릿이면 나머지 줄에도 붙인다. `keepPlain`에 든 문장(예: '확인된 위험 신호 없음')은 기존처럼 불릿 없이 둔다.
 */
export function asBulletList(text: string, keepPlain: readonly string[] = []): string {
  const t = text.trim();
  if (!t) return "";
  if (keepPlain.some((p) => t === p || t === `${p}.`)) return t;
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const marked = lines.map((l) => (OTHER_BULLET.test(l) ? `- ${l.replace(OTHER_BULLET, "").trim()}` : l));
  const hasBullet = marked.some((l) => l.startsWith("- "));
  const items = hasBullet
    ? marked
    : marked.flatMap((l) => (SPEAKER_HEAD.test(l) ? [l] : joinAnswers(splitSentences(l)))).map((s) => `- ${s}`);
  return items
    .map((l) => (l.startsWith("- ") ? l : `- ${l}`))
    .filter((l) => l.replace(/^- /, "").trim())
    .join("\n");
}

/**
 * 산문 섹션 — 불릿 기호를 뗀다. 불릿만 있던 덩어리는, 조각이 모두 문장으로 끝나면 한 문단으로 잇고
 * 아니면('외동' · '어머니 직장인') 줄을 그대로 둔다(이어 붙이면 뜻이 섞인다). 이미 산문이면 그대로(문단 줄바꿈 유지).
 */
export function asProse(text: string): string {
  const t = text.trim();
  if (!t) return "";
  const lines = t.split("\n").map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);
  if (!nonEmpty.some((l) => OTHER_BULLET.test(l))) return t;
  if (nonEmpty.every((l) => OTHER_BULLET.test(l))) {
    const parts = nonEmpty.map((l) => l.replace(OTHER_BULLET, "").trim()).filter(Boolean);
    return parts.join(parts.every((p) => /[.!?。]$/.test(p)) ? " " : "\n");
  }
  return lines.map((l) => l.replace(OTHER_BULLET, "").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type SectionRules = { bold: BoldRule; speakers: SpeakerRule } & SpeakerOptions;

/** 한 섹션 값 → 기존 모양의 문자열. */
export function normalizeSection(
  value: unknown,
  kind: "list" | "prose",
  rules: SectionRules,
  keepPlain: readonly string[] = [],
): string {
  let t = baseClean(toText(value));
  t = applyBold(t, rules.bold);
  t = applySpeakers(t, rules.speakers, { roles: rules.roles, multi: rules.multi });
  return kind === "list" ? asBulletList(t, keepPlain) : asProse(t);
}

/** 화자 → 이름표(문자열만, 빈 값 제외). */
export function cleanRoleMap(v: unknown, mapValue: (s: string) => string = (s) => s): Record<string, string> {
  if (!isPlainObject(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v)) {
    const label = toText(raw).trim();
    if (k.trim() && label) out[k.trim()] = mapValue(label);
  }
  return out;
}

const hasKey = (o: Record<string, unknown>, keys: readonly string[]) => {
  const lower = new Set(Object.keys(o).map((k) => k.toLowerCase()));
  return keys.some((k) => lower.has(k.toLowerCase()));
};

/**
 * AI 응답 객체에서 섹션을 꺼내는 도우미 — 키 대소문자가 달라도(`Summary`) 찾는다. 바깥에 섹션 키가 하나도 없고
 * 섹션 키를 가진 객체 칸이 하나뿐이면(`{"report": {…}, "speakerRoles": {…}}`처럼 한 겹 싸서 보냄) 그 안을 보고,
 * 바깥의 부가 칸(`extraKeys` — speakerRoles 등)은 합친다. `hasSections` = 섹션 키가 하나라도 있었나(없으면 모양 실패).
 */
export function sectionSource(
  raw: unknown,
  sectionKeys: readonly string[],
  extraKeys: readonly string[] = [],
): { source: Record<string, unknown>; hasSections: boolean } {
  let r = isPlainObject(raw) ? raw : {};
  if (!hasKey(r, sectionKeys)) {
    const inner = Object.values(r).filter((v): v is Record<string, unknown> => isPlainObject(v) && hasKey(v, sectionKeys));
    if (inner.length === 1) {
      const outerExtras = Object.fromEntries(Object.entries(r).filter(([k]) => hasKey({ [k]: true }, extraKeys)));
      r = { ...outerExtras, ...inner[0] };
    }
  }
  const known = [...sectionKeys, ...extraKeys];
  const source: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    const canon = known.find((x) => x.toLowerCase() === k.toLowerCase()) ?? k;
    if (!(canon in source) || k === canon) source[canon] = v;
  }
  return { source, hasSections: sectionKeys.some((k) => k in source) };
}
