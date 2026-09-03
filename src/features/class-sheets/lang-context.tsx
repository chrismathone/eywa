"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  DEFAULT_SHEET_LANG,
  sheetT,
  type SheetDictKey,
  type SheetLang,
} from "./i18n";

/**
 * 강사 시트 화면 언어를 **클라 트리 전체에** 흘려보내는 통로 — 학원설정
 * [`OperationsProvider`](@/features/owner/operations-context)와 같은 결이다.
 *
 * 🔑 **왜 prop이 아니라 context인가**: 상단 바 조각(`SheetClassPicker`·`SheetFaceSwitch`)은 주간 시트와
 *    월간 뷰가 함께 쓰는데, 그 사이에 낀 컴포넌트가 여럿이라 prop으로 내리면 중간 파일을 전부 고쳐야
 *    한다. 지금 그 중간 파일 몇 개는 **다른 세션이 동시에 고치는 중**이라 손대면 병합이 깨진다.
 *    context면 provider 한 곳(ECS 레이아웃)만 두고 읽는 쪽이 알아서 집는다.
 *
 * 🔴 **기본값은 한국어**다(provider 없이 읽혔을 때) — `SheetClassPicker`는 MCS(수학 시트)도 쓰는데
 *    MCS는 `/ecs` 밖이라 provider가 없다. 여기가 `en`이면 수학 시트 상단만 영어가 된다.
 */
const SheetLangContext = createContext<SheetLang>(DEFAULT_SHEET_LANG);

export function SheetLangProvider({ lang, children }: { lang: SheetLang; children: ReactNode }) {
  return <SheetLangContext.Provider value={lang}>{children}</SheetLangContext.Provider>;
}

/** 지금 화면의 언어. provider 밖(MCS 등)에서는 한국어. */
export function useSheetLang(): SheetLang {
  return useContext(SheetLangContext);
}

/**
 * `t("toolbar.saved")` 형태로 쓰는 번역 함수. 언어가 안 바뀌면 같은 함수라 memo 의존성으로 안전하다.
 * ⚠️ 사전에 없는 en 문구는 한글로 폴백한다(빈 버튼 금지 — [`i18n.ts`](./i18n.ts) 폴백 규약).
 */
export function useSheetT(): (key: SheetDictKey) => string {
  const lang = useSheetLang();
  return useMemo(() => (key: SheetDictKey) => sheetT(lang, key), [lang]);
}
