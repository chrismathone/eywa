"use client";

import { useState, type ReactNode } from "react";
import { SearchForm } from "./search-form";
import { HeaderSearchSlot } from "./header-search-slot";
import { CONTROL_H, CONTROL_LABEL } from "./ui/control-scale";
import { useSheetText } from "@/features/teacher-view/lang-context";

/**
 * 검색은 **필요할 때만** 나타난다(디자인 지시서 §10 "검색은 필요할 때만 나타나게(단축키 또는 토글)" —
 * 원장 2026-09-03 *"남은 결정사항은 지시서 그대로"*). 상시 검색창 대신 '검색' 글자 하나가 서고, 누르면 SearchForm이 펼쳐진다.
 * 🔴 **기본값 = 펼침**(원장 2026-11-10 *"검색창 전부 눌러야 열리자나 그거 디폴트값이 열려있도록"*) — 화면을 열면 입력창이 서 있고,
 *    '닫기'로 접으면 그 화면에 있는 동안만 '검색' 글자로 남는다. 포커스는 '검색'을 **누른 순간에만**(열 때마다 커서를 훔치지 않게).
 * 검색어가 이미 있으면(`defaultValue`) 펼친 채로 시작한다 — 무엇으로 걸러졌는지 보여야 한다.
 * 학생상담·등록상담 목록이 같이 쓴다 — 새 목록 화면의 검색도 이걸로(상시 SearchForm을 새로 놓지 말 것).
 * 🔴 그리는 자리는 화면 머리(PageHeader) 동작 줄 맨 앞이다([`HeaderSearchSlot`](./header-search-slot.tsx), 원장 2026-10-19) —
 *    부르는 쪽은 툴바에 그대로 두면 된다. '검색' 버튼은 학원 색 채움 + 흰 굵은 글씨(같은 날 *"파란배경 흰글씨로 굵게"*).
 */
export function SearchToggle({
  placeholder,
  defaultValue,
  extra,
  resetParams,
}: {
  placeholder: string;
  defaultValue?: string;
  /**
   * 펼쳤을 때만 입력창 **앞**에 서는 부가 컨트롤(검색 필드 선택 등) — 지시서 §4 "필터 상세는 2차": 검색을 열어야
   * 보이는 자리다. 접힌 상태엔 '검색' 글자 하나뿐이다.
   */
  extra?: ReactNode;
  /** 검색할 때 함께 지울 파라미터(SearchForm 그대로 — 1회성 배너 `?invited=` 같은 것. page는 늘 지운다). */
  resetParams?: string[];
}) {
  const text = useSheetText();
  const [opened, setOpen] = useState(true);
  const [clicked, setClicked] = useState(false);
  // 검색어가 URL에 걸려 있으면 **언제나** 펼친다(뒤로 가기 등 클라 내비로 q가 나중에 생겨도 — 마운트 시점 state만 보면
  // "검색어는 걸려 있는데 입력창은 접힘"이 된다).
  const open = opened || Boolean(defaultValue);
  if (!open) {
    return (
      <HeaderSearchSlot>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setClicked(true);
          }}
          className={`${CONTROL_H} ${CONTROL_LABEL} bg-primary text-primary-foreground hover:bg-primary/90 inline-flex shrink-0 items-center rounded-lg px-2.5 font-bold whitespace-nowrap transition`}
        >
          {text("검색")}
        </button>
      </HeaderSearchSlot>
    );
  }
  return (
    <HeaderSearchSlot>
    <span className="flex flex-wrap items-center gap-1.5">
      {extra ?? null}
      <SearchForm
        placeholder={placeholder}
        defaultValue={defaultValue}
        resetParams={resetParams}
        autoFocus={clicked}
        className="flex items-center gap-2"
      />
      {/* 검색어가 걸려 있으면 닫지 않는다 — 무엇으로 걸러졌는지 보여야 한다. 빈 채로 열었으면 되돌릴 수 있게. */}
      {!defaultValue ? (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={`${CONTROL_H} ${CONTROL_LABEL} text-text-faint hover:text-foreground inline-flex shrink-0 items-center px-1 whitespace-nowrap transition`}
        >
          {text("닫기")}
        </button>
      ) : null}
    </span>
    </HeaderSearchSlot>
  );
}
