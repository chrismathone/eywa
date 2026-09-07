/**
 * **반 이름 영문 표기** — 원장 2026-09-03: *"이런 반 이름도 사실 스타일이 비슷해서 충분히 스마트하게
 * 영문전환 가능할듯"*(`중등E_초등 브릿지 C` 화면을 보며).
 *
 * 🔴 **이건 번역이 아니라 표기 규약이다.** 이 학원의 반 이름은 사람이 지은 문장이 아니라
 * `밴드_학년 레벨 반구분`이라는 **고정 문법**이고(실측 2026-09-03: 활성 영어 반 43개 전부, 수학 76개
 * 대부분), 그래서 낱말 표 하나로 기계적으로 옮길 수 있다. AI 호출은 **하지 않는다**(사전 규약 그대로 —
 * 같은 반이 열 때마다 다른 이름이 되면 안 된다).
 *
 * ## 규칙
 * - **구조를 그대로 둔다.** `_`·공백·괄호·대괄호·순서를 하나도 안 바꾸고 **낱말만** 갈아 끼운다.
 *   그래야 `중등E_초등 브릿지 C` ↔ `MidE_Elem Bridge C`가 눈으로 1:1 대응되고, 한국인 강사와
 *   원어민이 **같은 반을 이야기하고 있다는 걸 서로 알 수 있다**(이게 이 규칙의 안전장치다).
 * - **모르는 낱말은 그대로 둔다.** 반쯤 한글로 남는 편이 지어낸 영어보다 정직하고, 구조가 남아 있어
 *   여전히 대조된다. 🔴 모르는 낱말을 음차하거나 비슷한 말로 때려 맞히지 말 것.
 * - **한글이 없으면 원문 그대로 즉시 반환**한다(`JP1`·`LS4a`·`MEC1-5` 같은 EiE 이름은 손대지 않는다).
 *
 * ## 🔴 표시 전용 — 새어 나가면 안 되는 곳
 * 화면에 그리는 글자만 정한다. **저장값·검색·매칭·엑셀·인쇄·ClassNote·학부모 표면은 한국어 이름 고정**이다
 * (학부모와 사무실은 이 표기를 모른다). 가드가 그 경로들의 import를 구조로 막는다
 * ([`class-name.test.ts`](./class-name.test.ts) — 학생 이름 규약 [[student-name]]과 같은 방식).
 *
 * ⚠️ 새 낱말을 더할 땐 **실제 반 이름에서 확인한 것만** 넣는다. 사전이 커질수록 오역 위험이 커지고,
 *    안 넣으면 그냥 한글로 남을 뿐이라 손해가 작다(fail-soft).
 */
import type { SheetLang } from "./i18n";

/**
 * 여러 낱말이 뭉쳐 하나의 뜻인 것 — **토큰으로 쪼개기 전에** 먼저 바꾼다.
 * (긴 것부터 적용해야 `주말내신특강`이 `주말`+`내신특강`으로 잘못 갈리지 않는다.)
 */
const PHRASES: ReadonlyArray<readonly [string, string]> = [
  ["주말내신특강", "Weekend Exam Prep"],
  ["고등내신특강", "High Exam Prep"],
  ["내신중등특강", "Mid Exam Prep"],
  ["내신특강", "Exam Prep"],
  ["문제 풀이반", "Problem Solving"],
  ["개념 완성반", "Concept Mastery"],
  ["개별진도", "Individual Pace"],
  ["고등개별", "High Individual"],
];

/** 낱말 하나 → 영문. 밴드(끝의 E/M은 과목 표식이라 살린다)·레벨·구분. */
const TOKENS: Readonly<Record<string, string>> = {
  // 밴드 — 긴 것이 먼저 걸리도록 아래 치환은 **정확 일치**로만 본다(부분 문자열 치환 아님).
  고등E: "HighE",
  중고E: "MidHighE",
  중등E: "MidE",
  초등E: "ElemE",
  고등M: "HighM",
  중등M: "MidM",
  초등M: "ElemM",
  고등: "High",
  중등: "Mid",
  초등: "Elem",
  // 레벨·성격
  정규: "Regular",
  심화: "Advanced",
  특별: "Special",
  // 🔴 `TOP`(중등E_중1 TOP)과 헷갈리지 않게 일부러 다른 낱말을 쓴다 — 둘은 다른 반이다.
  최상위: "Top-tier",
  브릿지: "Bridge",
  개별: "Individual",
  단체: "Group",
  특강: "Special",
  내신: "Exam",
  주말: "Weekend",
  오전: "AM",
  오후: "PM",
  보강: "Makeup",
};

/** 요일 한 글자 — `월목`·`토일`처럼 붙여 쓴다(반 이름에서 수업 요일을 가리킨다). */
const DOW: Readonly<Record<string, string>> = {
  월: "Mon",
  화: "Tue",
  수: "Wed",
  목: "Thu",
  금: "Fri",
  토: "Sat",
  일: "Sun",
};

/** `고1`·`중2-2`·`초5` — 학교급 한 글자 + 학년 숫자(+ 학기). */
const GRADE_RE = /^(고|중|초)(\d(?:-\d)?)$/;
const GRADE_PREFIX: Readonly<Record<string, string>> = { 고: "H", 중: "M", 초: "E" };

/** 구조를 남기려면 구분자도 조각으로 들고 있어야 한다 — 공백·`_`·괄호·대괄호·`/`에서 자른다. */
const SPLIT_RE = /([\s_[\]()/])/;

const HANGUL_RE = /[가-힣]/;

function translateToken(token: string): string {
  if (!token || !HANGUL_RE.test(token)) return token; // 라틴·숫자·구분자는 그대로
  const exact = TOKENS[token];
  if (exact) return exact;
  const grade = GRADE_RE.exec(token);
  if (grade) return `${GRADE_PREFIX[grade[1]!]}${grade[2]}`;
  // 요일만으로 된 토큰(`수`·`월목`·`토일`) — 한 글자씩 옮겨 `·`로 잇는다.
  if (token.length <= 3 && [...token].every((ch) => ch in DOW)) {
    return [...token].map((ch) => DOW[ch]!).join("·");
  }
  return token; // 🔴 모르는 낱말은 그대로 — 지어내지 않는다.
}

/**
 * 반 이름의 영문 표기. **한글이 없으면 원문 그대로**(EiE 반 이름은 이미 라틴이다).
 *
 * @example englishClassName("중등E_초등 브릿지 C") // "MidE_Elem Bridge C"
 * @example englishClassName("PJ2")                 // "PJ2"  (손대지 않음)
 */
export function englishClassName(name: string | null | undefined): string {
  const raw = (name ?? "").trim();
  if (!raw || !HANGUL_RE.test(raw)) return raw;
  let work = raw;
  for (const [ko, en] of PHRASES) work = work.split(ko).join(en);
  return work
    .split(SPLIT_RE)
    .map((piece) => (SPLIT_RE.test(piece) && piece.length === 1 ? piece : translateToken(piece)))
    .join("");
}

/**
 * 화면에 적을 반 이름 — `ko`면 **글자까지 원문 그대로**다(한국어 화면은 한 글자도 안 바뀐다).
 *
 * 🔴 화면마다 `lang === "en" ? …` 삼항을 적지 말 것 — 한쪽만 고쳐지면 같은 반이 화면마다 다른 이름이 된다.
 */
export function classNameFor(name: string | null | undefined, lang: SheetLang): string {
  const raw = (name ?? "").trim();
  return lang === "en" ? englishClassName(raw) : raw;
}
