"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  TOOLBAR_SEG_BOX,
  TOOLBAR_SEG_ITEM,
  TOOLBAR_SEG_OFF,
  TOOLBAR_SEG_ON_PRIMARY,
} from "@/components/toolbar-controls";
import { SHEET_SEG_BOX, sheetSegItem } from "../chrome";
import { SHEET_LANGS, SHEET_LANG_LABEL, sheetT, type SheetLang } from "../i18n";
import { useSheetLang } from "../lang-context";
import { setMyEcsLang } from "../server/actions";

/**
 * 화면 언어 스위치(한국어 / English) — 원장 2026-09-03
 * *"강사뷰 화면을 영어/한글 전환할 수 있도록 원어민 전용뷰 세팅 (영어강사 기준)"*.
 *
 * 🔴 **전원에게 보인다** — 기본값만 이름으로 갈린다(원어민=영어, [`defaultSheetLangFor`](../i18n.ts)).
 *    "원어민에게만 보이기"로 만들면, 이름 휴리스틱이 틀린 사람(한글로 등록된 원어민)은 **영어로 되돌릴
 *    수단이 아예 없다**. 표시 판정이 곧 능력 판정이 되면 안 된다. 덤으로 한국인 직원이 "원어민이 보는
 *    화면"을 그대로 확인할 수 있다('다른 강사 뷰'와 같은 결).
 * 🔴 **언어 이름은 번역하지 않는다**(`한국어`/`English`) — 지금 화면을 못 읽는 사람이 자기 언어를
 *    글자 모양으로 찾을 수 있어야 한다. 그래서 이 스위치만은 앞 라벨(캡션)도 없다.
 *
 * ⚠️ **서버가 진실**이라 저장 후 `router.refresh()` — 페이지 머리·빈 화면 안내는 서버 컴포넌트가
 *    그리므로(랜딩 `page.tsx`) 클라 state만 바꾸면 절반만 번역된 화면이 된다.
 * ⚠️ 모양은 화면마다 다른 두 규약을 그대로 쓴다(`tone`) — 랜딩 줄은 앱 전역 툴바 규약, 시트 상단 바는
 *    같은 규약 + 잉크 테두리([`chrome.ts`](../chrome.ts)). 여기서 치수를 새로 적지 않는다.
 */
export function SheetLangSwitch({ tone = "toolbar" }: { tone?: "toolbar" | "sheet" }) {
  const lang = useSheetLang();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const pick = useCallback(
    async (next: SheetLang) => {
      if (pending || next === lang) return;
      setPending(true);
      try {
        const r = await setMyEcsLang(next);
        if (!r.ok) {
          // 실패 문구는 **바꾸려던 언어**로 — 영어를 누른 사람에게 한글 오류를 띄우면 두 번 막힌다.
          toast.error(r.error ?? sheetT(next, "filter.saveFailed"));
          return;
        }
        router.refresh();
      } finally {
        setPending(false);
      }
    },
    [lang, pending, router],
  );

  const boxCls = tone === "sheet" ? `${SHEET_SEG_BOX} shrink-0` : TOOLBAR_SEG_BOX;
  const itemCls = (on: boolean) =>
    tone === "sheet"
      ? sheetSegItem(on)
      : `${TOOLBAR_SEG_ITEM} shrink-0 font-medium ${on ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`;

  return (
    // ⚠️ `role="group"` 없이 `aria-label`만 붙이면 span은 이름을 갖지 못한다(암묵 role이 generic).
    <span role="group" className={boxCls} title={sheetT(lang, "lang.title")} aria-label={sheetT(lang, "lang.aria")}>
      {SHEET_LANGS.map((l) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          onClick={() => void pick(l)}
          aria-pressed={lang === l}
          // ⚠️ `lang` 속성을 함께 준다 — 한글 폰트 스택 안에서 `English`가 자간이 어긋나 보이는 것을 막고,
          //    스크린리더가 각 칸을 그 언어로 읽는다.
          lang={l}
          className={`${itemCls(lang === l)} disabled:cursor-wait disabled:opacity-60`}
        >
          {SHEET_LANG_LABEL[l]}
        </button>
      ))}
    </span>
  );
}
