"use client";

/**
 * 출석부 **학생 검색 칸** — 월별 출석부·오늘 출결이 같이 쓰는 입력 하나(판정은 [`student-search.ts`](../student-search.ts)).
 *
 * 🔴 **검색어는 저장하지 않는다**(정렬·글씨 크기 같은 뷰 세팅과 다르다) — 상태는 부르는 화면의
 *    `useState`뿐이고 `users.ui_prefs`·localStorage 어디에도 안 남는다. 다음 접속에 필터가 걸린 채
 *    열리면 "출석부가 비었다"로 읽힌다.
 * ⚠️ 서버 왕복 0 — URL 파라미터도 아니다(라우팅하면 표가 통째로 다시 그려져 즉시성이 사라진다).
 */
import { EyIcon } from "@/components/icons/eywa-icons";
import { isSearchActive } from "../student-search";

export function StudentSearchBox({
  value,
  onChange,
  placeholder = "학생 이름",
  /** 입력칸 폭 — 툴바가 빡빡한 화면(월별 출석부)은 좁게, 여유 있는 화면은 넓게. */
  inputWidth = "w-[92px]",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputWidth?: string;
  className?: string;
}) {
  const active = isSearchActive(value);
  return (
    <div
      // 높이 h-8 = 공용 `<Button>` 기본 크기(툴바 한 줄 정렬, 원장 2026-09-01 *"전체적으로 버튼높이 등을
      // 통일"*). 🔴 `py-*`로 높이를 만들지 말 것 — 글자 크기가 바뀌면(폰 16px 자동확대 방지) 이 칸만 흔들린다.
      className={`border-line focus-within:border-primary flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2 ${className}`}
    >
      <EyIcon name="search" size={13} className="text-text-faint shrink-0" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Esc = 즉시 해제. 표를 보다가 손이 키보드에 있는 채로 되돌릴 수 있어야 한다.
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            // ⚠️ 전파를 막는다 — 창(모달·팝오버) 안에서 열려 있으면 Esc 한 번에 화면까지 닫힌다.
            e.stopPropagation();
            onChange("");
          }
        }}
        placeholder={placeholder}
        aria-label="학생 검색"
        // ⚠️ 브라우저 기본 ✕(webkit)를 감춘다 — 아래 우리 ✕와 나란히 두 개가 뜬다.
        // ⚠️ 거친 포인터(폰)에선 16px — iOS는 16px 미만 입력에 포커스하면 페이지를 자동 확대한다.
        className={`text-foreground placeholder:text-text-faint ${inputWidth} bg-transparent text-[12px] outline-none [&::-webkit-search-cancel-button]:appearance-none pointer-coarse:text-[16px]`}
      />
      {active ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="검색 지우기"
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
