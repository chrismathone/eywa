"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { sheetFeedback } from "./feedback";
import {
  DEFAULT_SHEET_LANG,
  sheetT,
  sheetTf,
  type SheetDictKey,
  type SheetLang,
} from "./i18n";

/**
 * 강사 시트 화면 언어를 **클라 트리 전체에** 흘려보내는 통로 — 학원설정
 * [`OperationsProvider`](@/features/owner/operations-context)와 같은 결이다.
 *
 * 🔑 **왜 prop이 아니라 context인가**: 강사가 여는 화면이 수십 개고 공용 조각(`SheetClassPicker`·
 *    `SheetFaceSwitch`·'내 메뉴')이 여러 트리에 걸쳐 있어, prop으로 내리면 중간 파일을 전부 고쳐야
 *    한다. context면 provider 한 곳(**강사 미니셸 레이아웃**)만 두고 읽는 쪽이 알아서 집는다.
 *
 * 🔴 **provider는 강사 미니셸에만 건다** — 관리자 풀셸은 한국어 고정이다(원장 2026-09-03
 *    *"관리자뷰는 수정할 필요 없고"*). 그래서 기본값도 한국어여야 한다: 같은 공용 조각이 관리자
 *    화면에서도 렌더되는데, 기본값이 `en`이면 그쪽이 영어가 된다.
 */
const SheetLangContext = createContext<SheetLang>(DEFAULT_SHEET_LANG);

export function SheetLangProvider({ lang, children }: { lang: SheetLang; children: ReactNode }) {
  return <SheetLangContext.Provider value={lang}>{children}</SheetLangContext.Provider>;
}

/** 지금 화면의 언어. provider 밖(MCS 등)에서는 한국어. */
export function useSheetLang(): SheetLang {
  return useContext(SheetLangContext);
}

/** Server feedback follows the teacher's language; the default Korean screen keeps the original. */
export function useSheetFeedback(): (message: string) => string {
  const lang = useSheetLang();
  return useMemo(() => (message: string) => sheetFeedback(lang, message), [lang]);
}

/**
 * `t("toolbar.saved")` 형태로 쓰는 번역 함수. 언어가 안 바뀌면 같은 함수라 memo 의존성으로 안전하다.
 * ⚠️ 사전에 없는 en 문구는 한글로 폴백한다(빈 버튼 금지 — [`i18n.ts`](./i18n.ts) 폴백 규약).
 */
export function useSheetT(): (key: SheetDictKey) => string {
  const lang = useSheetLang();
  return useMemo(() => (key: SheetDictKey) => sheetT(lang, key), [lang]);
}

/**
 * 수를 끼우는 문구용 — `tf("strip.slotMeta", { time, n })`.
 *
 * 🔴 **조각을 이어 붙이지 말 것**(`앞 + n + 뒤`) — 한국어는 수 뒤에 단위가 오고(`미입력 4명`) 영어는
 *    앞에 온다(`4 not marked`). 문장 전체를 사전에 넣고 자리만 뚫는다([`sheetTf`](./i18n.ts)).
 */
export function useSheetTf(): (key: SheetDictKey, params: Record<string, string | number>) => string {
  const lang = useSheetLang();
  return useMemo(
    () => (key: SheetDictKey, params: Record<string, string | number>) => sheetTf(lang, key, params),
    [lang],
  );
}
