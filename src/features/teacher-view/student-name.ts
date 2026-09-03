/**
 * **학생 이름 표기** — 영어 모드에서 영어 이름을 주 이름으로 (원장 2026-09-03:
 * *"학생들 중 영어이름 보유한 학생은 이름 → 영어이름 전환"*).
 *
 * 지금까지는 `김두나` 아래에 작게 `Ruby`가 붙었다. 영어로 보는 사람에겐 그 반대여야 한다.
 *
 * ## 규칙
 * - **en + 영어 이름 있음** → 주 이름 = 영어 이름, 보조 = 한글 이름(지금의 반대).
 * - **영어 이름 없음** → 한글 이름 그대로(빈 칸 금지 — 이름이 사라지면 명단이 못 읽힌다).
 * - **ko** → 지금과 **글자까지 같다**(주 = 한글, 보조 = 영어 이름).
 *
 * ## 🔴 표시 전용 — 절대 새어 나가면 안 되는 곳
 * 이 함수는 **화면에 그리는 글자만** 정한다. 검색·정렬·매칭·저장 값·감사로그는 한 글자도 안 바뀐다.
 * 🔴 **학부모에게 나가는 것에는 절대 쓰지 말 것** — 수업보고서·ClassNote 발송·인쇄물·엑셀 내보내기는
 *    **한글 이름 고정**이다(학부모는 영어 이름을 모른다). 그 경로들은 이 모듈을 import하지 않으며,
 *    가드 [`student-name-scope.test.ts`](./student-name-scope.test.ts)가 그것을 구조로 잠근다.
 * 🔴 화면마다 `lang === "en" ? …` 삼항을 적지 말 것 — 한쪽만 고쳐진다. 이 함수 하나를 부른다.
 *
 * ⚠️ 좁은 칸은 영어 이름이 더 길 수 있다 — 기존 축소 규약(`fitSeatName` 등)을 그대로 타야 한다
 *    (이 함수는 **문자열만** 돌려주고 폭·글씨 크기에는 관여하지 않는다).
 */
import type { SheetLang } from "./i18n";

export type StudentNameParts = {
  /** 크게 적는 이름. 항상 비어 있지 않다. */
  primary: string;
  /** 작게 덧붙이는 이름. 없으면 null(같은 글자를 두 번 적지 않는다). */
  secondary: string | null;
};

/**
 * @param name    한글 이름(`students.name`) — 이 학원의 정본.
 * @param english 영어 이름(`students.english_name`) — 없을 수 있다.
 */
export function studentNameParts(
  name: string | null | undefined,
  english: string | null | undefined,
  lang: SheetLang,
): StudentNameParts {
  const ko = (name ?? "").trim();
  const en = (english ?? "").trim();
  // 같은 글자면 보조를 달지 않는다(`Ruby` 아래 `Ruby`).
  const pair = (primary: string, secondary: string): StudentNameParts => ({
    primary,
    secondary: secondary && secondary !== primary ? secondary : null,
  });

  if (lang === "en" && en) return pair(en, ko);
  // 🔴 영어 이름이 없으면 한글 이름 그대로 — 빈 칸을 만들지 않는다.
  if (ko) return pair(ko, en);
  // 한글 이름이 비어 있는 이상 상황(데이터 오류)에서도 무엇이든 보여 준다.
  return pair(en, "");
}

/** 한 줄로만 적는 자리(좁은 칸·툴팁)용 — 주 이름만. */
export function studentDisplayName(
  name: string | null | undefined,
  english: string | null | undefined,
  lang: SheetLang,
): string {
  return studentNameParts(name, english, lang).primary;
}
