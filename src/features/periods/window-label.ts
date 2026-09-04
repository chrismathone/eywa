/**
 * **기간 창 표기** — 강사뷰 영어 화면(원장 2026-09-04 *"강사가 접근 가능한 모든 메뉴를 전환"*).
 *
 * 🔴 `PeriodWindow.label`(한국어)은 **한 글자도 안 건드린다** — 수납·급여·인쇄가 같은 값을 읽고,
 *    돈 계열 화면은 한국어 고정이다. 여기서는 **같은 재료**(kind·start·end)로 영어판을 다시 만든다.
 * ⚠️ `resolve.ts`에 넣지 않고 파일을 가른 이유: 그 모듈은 돈 계열이 함께 import하는 순수 계산이라
 *    표시용 사전 의존을 얹지 않는다(계산과 표기를 섞지 않는다).
 */
import type { PeriodWindow } from "./resolve";
import { sheetDateLabelEn, sheetMonthLabel, type SheetLang } from "@/features/teacher-view/i18n";

/** `2026-03-06` → `Mar 6` — 창 라벨 안에서 쓰는 짧은 표기(연도는 앞 조각이 이미 말한다). */
function shortEn(ymd: string): string {
  // `Mon, Mar 6, 2026` → `Mar 6`(요일·연도 제거). 형식이 깨지면 원문 그대로.
  const m = /^[A-Za-z]{3}, ([A-Za-z]{3} \d{1,2}), \d{4}$/.exec(sheetDateLabelEn(ymd));
  return m ? m[1]! : ymd;
}

/**
 * 화면에 적을 기간 창 이름. 한국어는 **저장된 라벨 그대로**, 영어만 다시 만든다.
 * 재료가 비면(깨진 창) 한국어 라벨로 떨어진다 — 지어낸 영어보다 원문이 정직하다.
 */
export function periodWindowLabel(win: PeriodWindow, lang: SheetLang): string {
  if (lang !== "en") return win.label;
  if (!win.start || !win.end) return win.label;
  // 🔴 라벨월은 **한국어 라벨에서 읽는다** — 세션은 라벨월과 실제 시작월이 다를 수 있어서
  //    (`2월 세션`이 3/5까지) `start`에서 뽑으면 조용히 어긋난다. 못 읽으면 한국어 그대로.
  const ym = /^(\d{4})년 (\d{1,2})월/.exec(win.label);
  if (!ym) return win.label;
  const month = sheetMonthLabel(`${ym[1]}-${String(Number(ym[2])).padStart(2, "0")}`, win.label, "en");
  if (win.kind === "month") return month;
  return `${month} session (${shortEn(win.start)}–${shortEn(win.end)})`;
}
