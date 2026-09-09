"use client";

import { useRef, useTransition, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { TOOLBAR_SEARCH_BOX } from "@/components/toolbar-controls";

/**
 * 공통 검색 폼 — 기존 GET <form>(문서 전체 새로고침 = 화면 깜빡 + 스크롤/포커스 유실)을
 * 클라 내비로 대체. 전환(useTransition) 동안 기존 화면이 그대로 남고 결과만 부드럽게 교체된다.
 * 다른 searchParams는 전부 보존(GET 폼의 hidden input 보존 불필요), page는 리셋(FilterSelect 규약).
 */
export function SearchForm({
  paramName = "q",
  placeholder,
  defaultValue,
  // 기본 폭 w-32(128px) → w-52(208px): 2026-09-08 v5 글자 기준 실측 — 안 글자 16px에서 학생목록 `이름·학교·연락처·메모`≈175px,
  // 수업목록 `수업명, 강사, 강의실 검색`≈180px, 영어 `Name, school, phone or memo`≈200px이라 128px 상자에선 자리표시자가 말줄임 없이 끊겼다.
  inputWidth = "w-52",
  className = "ml-auto flex items-center gap-2",
  resetParams = [],
  autoFocus = false,
}: {
  paramName?: string;
  placeholder: string;
  defaultValue?: string | null;
  /** 입력창 폭 클래스 — 사이트별 기존 폭 유지용. */
  inputWidth?: string;
  className?: string;
  /** 검색 시 함께 제거할 파라미터(page는 항상 제거). */
  resetParams?: string[];
  /** 토글로 펼쳐질 때(SearchToggle) 커서를 바로 넣는다 — 버튼이 사라진 자리에서 포커스를 잃지 않게. */
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    const q = (inputRef.current?.value ?? "").trim();
    if (q) params.set(paramName, q);
    else params.delete(paramName);
    params.delete("page"); // 검색은 결과집합이 바뀌므로 1페이지로(stale page 방지)
    for (const p of resetParams) params.delete(p);
    const s = params.toString();
    startTransition(() => router.push(`${pathname}${s ? `?${s}` : ""}`));
  }

  return (
    <form onSubmit={onSubmit} className={className}>
      {/* 치수 = TOOLBAR_SEARCH_BOX(control-scale) — 툴바 한 줄에서 버튼·칩과 같은 높이·라벨. */}
      <div className={TOOLBAR_SEARCH_BOX}>
        <EyIcon name="search" size={16} />
        <input
          ref={inputRef}
          type="search"
          name={paramName}
          defaultValue={defaultValue ?? ""}
          placeholder={placeholder}
          autoFocus={autoFocus}
          // 안 글자는 16px(sm 라벨) — 상자 라벨 18px보다 한 단계 작게, 자리표시자·검색어가 더 보이게(원장 2026-09-04 재고관리 캡처,
          // "스타일 통일" — 앱의 검색 입력이 전부 같은 값).
          className={`text-foreground placeholder:text-text-faint ${inputWidth} h-full bg-transparent text-(length:--control-label-sm) leading-normal focus:outline-none`}
        />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "검색 중…" : "검색"}
      </Button>
    </form>
  );
}
