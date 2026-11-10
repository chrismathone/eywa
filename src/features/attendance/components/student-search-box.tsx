"use client";
import { useSheetLang } from "@/features/teacher-view/lang-context";

/**
 * 출석부 **학생 검색 칸** — 월별 출석부·오늘 출결이 같이 쓰는 입력 하나(판정은 [`student-search.ts`](../student-search.ts)).
 *
 * 🔴 **검색어는 저장하지 않는다**(정렬·글씨 크기 같은 뷰 세팅과 다르다) — 상태는 부르는 화면의
 *    `useState`뿐이고 `users.ui_prefs`·localStorage 어디에도 안 남는다. 다음 접속에 필터가 걸린 채
 *    열리면 "출석부가 비었다"로 읽힌다.
 * ⚠️ 서버 왕복 0 — URL 파라미터도 아니다(라우팅하면 표가 통째로 다시 그려져 즉시성이 사라진다).
 */
import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { CONTROL_H } from "@/components/ui/control-scale";
import { isSearchActive } from "../student-search";
import { HeaderSearchSlot } from "@/components/header-search-slot";

/**
 * **클라 상태 검색칸** — 늘 펼친 입력칸 + 검색어가 걸려 있으면 그 옆에 결과 표기(`chip`, N/M).
 * 원장 2026-11-11 *"전체 웹앱에서 '검색' 옆에 '닫기' 제거. 닫을 필요가 없지 않나? 항상 열려있는데"* — 2026-11-10 기본값을 펼침으로 바꾼 뒤 남아 있던
 * '닫기'와 접힌 상태('검색' 글자 하나)를 없앴다(공용 [`SearchToggle`](@/components/search-toggle)과 같다). 🔴 다시 접는 단추를 두지 말 것.
 * 공용 SearchToggle은 URL(`?q=`) 검색용이라, 서버 왕복 0의 클라 필터(시간표·월별 출석부·오늘 출결·좌석표)는 이 칸을 쓴다.
 * 커서는 화면을 열 때 가져가지 않는다(autoFocus 없음 — 아래 StudentSearchBox 주석).
 * ⚠️ 부르는 쪽이 "검색할 게 없을 때"(편집 모드·행 0개)는 이 컴포넌트를 아예 안 그린다 — 여기서는 판단하지 않는다.
 */
export function StudentSearchToggle({
  value,
  onChange,
  chip,
  placeholder,
  inputWidth,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  /** 검색이 걸려 있을 때 입력칸 옆에 설 표기(`SearchScopeChip`). */
  chip?: ReactNode;
  placeholder?: string;
  inputWidth?: string;
  /** 입력칸 접근성 이름 — 학생이 아닌 것을 찾는 화면(도움말)은 제 이름을 준다(기본 "학생 검색"). */
  ariaLabel?: string;
}) {
  const lang = useSheetLang();
  // 그리는 자리 = 화면 머리 동작 줄 맨 앞(공용 SearchToggle과 같은 규약, 원장 2026-10-19).
  return (
    <HeaderSearchSlot>
      <StudentSearchBox
        value={value}
        onChange={onChange}
        placeholder={lang === "en" && (placeholder === undefined || placeholder === "학생 이름") ? "Student name" : placeholder}
        inputWidth={inputWidth}
        ariaLabel={ariaLabel}
      />
      {isSearchActive(value) ? chip : null}
    </HeaderSearchSlot>
  );
}

export function StudentSearchBox({
  value,
  onChange,
  placeholder = "학생 이름",
  /** 입력칸 폭 — 툴바가 빡빡한 화면(월별 출석부)은 좁게, 여유 있는 화면은 넓게. */
  inputWidth = "w-[92px]",
  className = "",
  inputRef,
  ariaLabel = "학생 검색",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputWidth?: string;
  className?: string;
  /** 입력칸 접근성 이름 — 기본 "학생 검색"(출석부·시간표). 다른 것을 찾는 화면은 제 이름을 준다. */
  ariaLabel?: string;
  /**
   * 입력칸 ref — 토글로 펼치는 화면(시간표 '검색')이 **누른 그 순간에만** 포커스를 넣으려고 쓴다.
   * ⚠️ `autoFocus`가 아니다: autoFocus는 마운트마다 포커스를 훔쳐서, 편집 모드·교실뷰로 물러났다 돌아올 때(remount)
   *    방금 드롭다운을 고른 손에서 커서를 뺏는다(적대적 리뷰 2026-09-04).
   */
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const lang = useSheetLang();
  const active = isSearchActive(value);
  return (
    <div
      // 높이 = control-scale(툴바 한 줄 정렬 — 원장 2026-09-01 *"전체적으로 버튼높이 등을 통일"* → 09-03 v5 프리셋).
      // 🔴 `py-*`로 높이를 만들지 말 것 — 글자 크기가 바뀌면(폰 16px 자동확대 방지) 이 칸만 흔들린다.
      className={`${CONTROL_H} border-line focus-within:border-primary flex shrink-0 items-center gap-1.5 rounded-lg border px-2 ${className}`}
    >
      <EyIcon name="search" size={14} className="text-text-faint shrink-0" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        ref={inputRef}
        // Esc = 즉시 해제. 표를 보다가 손이 키보드에 있는 채로 되돌릴 수 있어야 한다.
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            // ⚠️ 전파를 막는다 — 창(모달·팝오버) 안에서 열려 있으면 Esc 한 번에 화면까지 닫힌다.
            e.stopPropagation();
            onChange("");
          }
        }}
        placeholder={lang === "en" && (placeholder === undefined || placeholder === "학생 이름") ? "Student name" : placeholder}
        aria-label={lang === "en" && ariaLabel === "학생 검색" ? "Search students" : ariaLabel}
        // ⚠️ 브라우저 기본 ✕(webkit)를 감춘다 — 아래 우리 ✕와 나란히 두 개가 뜬다.
        // 글자 = sm 라벨(16px — iOS 자동확대 하한 그대로, 상자 라벨 18보다 한 단계 작게: 원장 2026-09-04 "내부 텍스트는 폰트 작게") ·
        // `h-full leading-normal` — `<input>`은 제 상자 안에서
        // 글자를 자르므로 상자 높이를 다 써야 한글이 안 잘린다(control-scale.ts 규칙 3, 원장 캡처 2026-09-03).
        className={`text-foreground placeholder:text-text-faint ${inputWidth} h-full bg-transparent text-(length:--control-label-sm) leading-normal outline-none [&::-webkit-search-cancel-button]:appearance-none`}
      />
      {active ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={lang === "en" ? "Clear search" : "검색 지우기"}
          title="검색 지우기 (Esc)"
          className="text-text-faint hover:text-foreground hover:bg-bg-soft -mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full transition"
        >
          <EyIcon name="close" size={12} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * **지금 걸린 필터를 눈에 보이게** 하는 칩 — 검색 중일 때만 뜬다.
 *
 * 🔴 **합계가 필터를 따라가는지는 화면마다 다르다** — 그래서 `totalsNote`가 필수에 가깝다.
 *    · 월별 출석부(2026-08-20~) = **따라간다**. 시수·청구·납입·정산액을 매치된 학생만으로 다시 세고,
 *      전체 값은 `검색분 / 전체`로 나란히 세운다(좁혀 놓고 전체인 척하는 숫자를 만들지 않는다, [[#89]]).
 *    · 오늘 출결·좌석표 = **안 따라간다**. 하루 분모(입력 N/M)는 그 반 전체가 모수라, 일부만 세면
 *      미입력 반이 '입력 완료'로 칠해진다. 그쪽은 숫자를 줄이는 대신 필터를 크게 말한다.
 * ⚠️ 이 칩을 지우거나 접지 말 것(`<details>` 안에 넣는 것 포함) — 접히면 없는 것과 같다.
 */
export function SearchScopeChip({
  shown,
  total,
  unit = "명",
  /** 합계가 무엇 기준인지 — 화면마다 문구가 다르다. **자연스러운 한 마디**로 넘긴다("… 전체 기준"). */
  totalsNote,
}: {
  shown: number;
  total: number;
  unit?: string;
  totalsNote?: string;
}) {
  return (
    <span
      className="bg-amber-soft text-amber num shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap"
      title={
        totalsNote
          ? `검색으로 목록만 좁혔습니다 — ${totalsNote}입니다.`
          : "검색으로 목록만 좁혔습니다."
      }
    >
      {`검색 중 · ${shown}/${total}${unit} 표시`}
      {totalsNote ? <span className="font-medium">{` · ${totalsNote}`}</span> : null}
    </span>
  );
}
