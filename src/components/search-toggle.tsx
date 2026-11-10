"use client";

import type { ReactNode } from "react";
import { SearchForm } from "./search-form";
import { HeaderSearchSlot } from "./header-search-slot";

/**
 * 목록 화면의 검색칸 — **늘 펼친 입력칸 + '검색' 버튼**(원장 2026-11-11 *"전체 웹앱에서 '검색' 옆에 '닫기' 제거. 닫을 필요가 없지 않나? 항상 열려있는데"*).
 * 2026-11-10에 기본값을 펼침으로 바꾼 뒤(*"검색창 전부 눌러야 열리자나 그거 디폴트값이 열려있도록"*) 남아 있던 '닫기'와 접힌 상태('검색' 글자 하나)를 없앴다.
 * 🔴 다시 접는 단추를 두지 말 것. 커서는 화면을 열 때 가져가지 않는다(autoFocus 없음 — 다른 칸을 고르던 손에서 커서를 뺏지 않게).
 * 이름은 그대로 둔다(부르는 화면이 많다) — 학생상담·등록상담 등 목록 화면의 검색은 이걸로(상시 SearchForm을 새로 놓지 말 것).
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
  /** 입력창 **앞**에 서는 부가 컨트롤(검색 필드 선택 등). */
  extra?: ReactNode;
  /** 검색할 때 함께 지울 파라미터(SearchForm 그대로 — 1회성 배너 `?invited=` 같은 것. page는 늘 지운다). */
  resetParams?: string[];
}) {
  return (
    <HeaderSearchSlot>
      <span className="flex flex-wrap items-center gap-1.5">
        {extra ?? null}
        <SearchForm placeholder={placeholder} defaultValue={defaultValue} resetParams={resetParams} className="flex items-center gap-2" />
      </span>
    </HeaderSearchSlot>
  );
}
