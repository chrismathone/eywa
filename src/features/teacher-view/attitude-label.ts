/**
 * **수업 태도 표시 라벨** — 강사뷰 영어 화면(원장 2026-09-03 *"모든 곳을 en 전환"*).
 *
 * 🔴🔴 **저장값은 한국어 그대로다.** `ATTITUDE`의 값(`매우 좋음`…)이 곧 DB에 들어가는 문자열이고,
 * 학부모 문장([`attitudeClause`](@/features/onescreen/attitude))이 그 문자열을 읽는다. 그래서 이 모듈은
 * **화면에 적는 글자만** 바꾼다 — 영어로 골라도 저장은 `매우 좋음`이고 학부모는 한국어를 받는다.
 * 🔴 그러니 이 함수를 **저장 경로에 끼우지 말 것**(고른 값을 영어로 저장하면 옛 기록과 갈리고
 *    학부모 문장이 폴백(`${값}입니다`)으로 떨어져 영문이 학부모에게 나간다).
 *
 * ⚠️ **선택지 밖 값은 그대로 돌려준다** — 실데이터에 `최고`(5,016건)·`아주 좋음`·`최고 책없음` 같은
 *    옛 값·자유입력이 남아 있다(그 파일 ⚠️). 옮길 표가 없으니 원문이 정답이다(쓴 게 안 보이면 안 된다).
 *
 * ⚠️ 방향 주의: **teacher-view가 onescreen을 import**하는 것은 괜찮다(선택지는 그쪽이 단일 소스).
 *    반대 방향(onescreen이 teacher-view를 import)은 학부모 표면 오염이라 가드가 막는다.
 */
import { ATTITUDE } from "@/features/onescreen/attitude";
import { sheetT, type SheetDictKey, type SheetLang } from "./i18n";

/** 저장값(한국어) → 사전 키. 🔴 키를 새로 만들 땐 `ATTITUDE` 순서와 짝을 맞출 것. */
const KEY_OF: Record<string, SheetDictKey> = {
  "매우 좋음": "roster.attitude.veryGood",
  좋음: "roster.attitude.good",
  보통: "roster.attitude.ok",
  안좋음: "roster.attitude.bad",
  "매우 안좋음": "roster.attitude.veryBad",
};

/** 화면에 적을 태도 — 모르는 값(옛 표기·자유입력)은 원문 그대로. */
export function attitudeLabelFor(value: string | null | undefined, lang: SheetLang): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const key = KEY_OF[v];
  return key ? sheetT(lang, key) : v;
}

/** 순환 안내(툴팁)에 쓰는 눈금 나열 — `매우 좋음 → 좋음 → …`. */
export function attitudeScaleText(lang: SheetLang): string {
  return ATTITUDE.map((v) => attitudeLabelFor(v, lang) ?? v).join(" → ");
}
