"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyIcon } from "@/components/icons/aywa-icons";
import { SHEET_LANGS, SHEET_LANG_LABEL, sheetT, type SheetLang } from "./i18n";
import { useSheetLang } from "./lang-context";
import { sheetFeedback } from "./feedback";
import { setMyTeacherLang } from "./server/actions";

/**
 * 강사뷰 **화면 언어 스위치**(한국어 / English) — 자리는 **'내 메뉴' 드롭다운 하나**다
 * (원장 2026-09-03: *"관리자뷰는 수정할 필요 없고 강사로 로그인했을때 내 메뉴에서 한영전환이 있으면 됨"*).
 *
 * 🔴 **다른 화면 툴바에 이 스위치를 다시 달지 말 것** — 처음엔 ECS 툴바 3곳에 뒀는데 원장이 자리를
 *    지정해 걷어냈다. 강사에겐 사이드바가 없어 '내 메뉴'가 유일한 공용 크롬이고, 화면마다 흩뿌리면
 *    같은 설정을 여러 자리에서 만나 "화면마다 다른 설정"으로 읽힌다.
 * 🔴 **전원에게 보인다** — 기본값만 이름으로 갈린다([`defaultSheetLangFor`](./i18n.ts)).
 *    "원어민에게만 보이기"로 만들면, 이름 휴리스틱이 틀린 사람(한글로 등록된 원어민)은 **영어로
 *    되돌릴 수단이 아예 없다**. 표시 판정이 곧 능력 판정이 되면 안 된다.
 * 언어 버튼은 현재 언어에 맞춘 짧은 이름을 쓴다: 한글/영어 · Kor/En.
 *
 * ⚠️ **메뉴 항목(`DropdownMenuItem`)이 아니라 팝업의 평범한 자식**으로 놓는다 — 항목 안에 버튼 둘을
 *    넣으면 클릭·키보드를 서로 뺏고 스크린리더에 중첩 인터랙티브로 읽힌다(teacher-menu.tsx 주석).
 *    덕분에 눌러도 메뉴가 닫히지 않아 `closeOnClick` 제어 자체가 필요 없다.
 * 🔴 여기는 **네비게이션이 아니라 `router.refresh()`**라 `window.location`이 필요 없다
 *    (서버 액션 뒤 `router.push`가 삼켜지는 [[#102]]는 이동에만 해당한다).
 * ⚠️ **서버가 진실**이라 저장 후 `router.refresh()` — 셸 레이아웃(서버)이 언어를 읽어 provider에 넣으므로
 *    클라 state만 바꾸면 메뉴만 영어이고 화면은 한글인 상태가 된다.
 */
export function TeacherLangSwitch() {
  const lang = useSheetLang();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const pick = useCallback(
    async (next: SheetLang) => {
      if (pending || next === lang) return;
      setPending(true);
      try {
        const r = await setMyTeacherLang(next);
        if (!r.ok) {
          // 실패 문구는 **바꾸려던 언어**로 — 영어를 누른 사람에게 한글 오류를 띄우면 두 번 막힌다.
          toast.error(sheetFeedback(next, r.error ?? sheetT(next, "lang.saveFailed")));
          return;
        }
        router.refresh();
      } finally {
        setPending(false);
      }
    },
    [lang, pending, router],
  );

  return (
    <div
      // ⚠️ `role="group"` 없이 `aria-label`만 붙이면 div는 이름을 갖지 못한다(암묵 role generic).
      role="group"
      aria-label={sheetT(lang, "lang.aria")}
      title={sheetT(lang, "lang.title")}
      className="flex items-center gap-1.5 px-2 py-1.5"
    >
      <EyIcon name="globe" size={16} strokeWidth={1.8} className="text-text-dim shrink-0" />
      <span className="text-text-dim shrink-0 text-sm">{sheetT(lang, "lang.label")}</span>
      <span className="border-line ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5">
        {SHEET_LANGS.map((l) => (
          <button
            key={l}
            type="button"
            disabled={pending}
            onClick={() => void pick(l)}
            aria-pressed={lang === l}
            // ⚠️ `lang` 속성을 함께 준다 — 한글 폰트 스택 안에서 `English`가 자간이 어긋나 보이는 것을 막고,
            //    스크린리더가 각 칸을 그 언어로 읽는다.
            lang={lang}
            className={`cursor-pointer rounded-md px-2 py-0.5 text-xs font-medium transition disabled:cursor-wait disabled:opacity-60 ${
              lang === l ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
            }`}
          >
            {SHEET_LANG_LABEL[lang][l]}
          </button>
        ))}
      </span>
    </div>
  );
}
