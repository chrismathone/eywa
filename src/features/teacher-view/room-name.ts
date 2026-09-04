/**
 * **강의실 이름 영문 표기** — 강사뷰 영어 화면(원장 2026-09-04 *"kr/en에서도 본원305를 en버전으로"*).
 *
 * 반 이름([`class-name.ts`](./class-name.ts))과 **같은 결**이다: 번역이 아니라 **건물 이름만 로마자로
 * 옮기고 호수는 그대로 둔다**(`본원305` → `Main 305`). 그래야 한국인 강사와 원어민이 같은 방을
 * 이야기하고 있다는 걸 숫자로 1:1 대조한다.
 *
 * 🔴 **모르는 건물은 원문 그대로**(지어낸 영어보다 정직하다). 한글이 없으면 즉시 원문 반환 —
 *    `LAB실`·`JJ실` 같은 자리 라벨과 `305` 같은 맨숫자는 손대지 않는다.
 * 🔴 **표시 전용.** 저장·매칭은 언제나 등록된 이름(`classrooms.name`)이고, 이 함수를 저장 경로나
 *    비교(같은 방인가) 판정에 끼우지 말 것 — 끼우면 영어 화면에서 저장한 값만 딴 글자가 된다.
 * 🔴 학부모·사무실 표면(report-admin·onescreen·exports·messaging·`(print)`)은 **한국어 고정**이다.
 *    학부모는 `Main 305`가 어디인지 모른다 — 구조 가드가 그 경로들의 import를 막는다.
 *
 * ⚠️ 건물 이름은 **이 학원의 고유명사**다(실측 2026-09-04, 등록 강의실 22개): `본원`·`고수`·`바른`.
 *    새 건물이 생기면 여기 한 줄을 더한다 — 없으면 그 방만 한국어로 남고 화면은 안 죽는다.
 * ⚠️ 한국어 원문엔 띄어쓰기가 없지만(`본원305`) 영어는 **한 칸 띄운다**(`Main 305`) — 붙여 쓰면
 *    `Main305`가 한 낱말로 읽혀 호수가 눈에 안 들어온다. 숫자는 그대로라 대조는 그대로 된다.
 */
import type { SheetLang } from "./i18n";

/** 건물 이름(접두) → 로마자. 🔴 값은 사람이 부르는 이름이지 코드가 아니다 — 마음대로 줄이지 말 것. */
const BUILDINGS: ReadonlyArray<readonly [string, string]> = [
  ["본원", "Main"],
  ["고수", "Gosu"],
  ["바른", "Bareun"],
];

const HANGUL_RE = /[가-힣]/;

/** `본원305` → `Main 305`. 모르는 이름·한글 없는 이름은 원문 그대로. */
export function englishRoomName(name: string | null | undefined): string {
  const raw = (name ?? "").trim();
  if (!raw || !HANGUL_RE.test(raw)) return raw;
  for (const [ko, en] of BUILDINGS) {
    if (!raw.startsWith(ko)) continue;
    const rest = raw.slice(ko.length).trim();
    // 접두만 있는 이름(`본원`)은 건물 자체를 가리킨다 — 뒤에 붙일 게 없으면 그대로 한 낱말.
    return rest ? `${en} ${rest}` : en;
  }
  return raw;
}

/** 화면에 적을 강의실 이름 — 한국어면 원문 그대로(ko 화면은 한 글자도 안 바뀐다). */
export function roomNameFor(name: string | null | undefined, lang: SheetLang): string | null {
  const raw = (name ?? "").trim();
  if (!raw) return null;
  return lang === "en" ? englishRoomName(raw) : raw;
}
