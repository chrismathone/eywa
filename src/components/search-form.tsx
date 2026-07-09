"use client";

import { useRef, useTransition, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";

/**
 * 공통 검색 폼 — 기존 GET <form>(문서 전체 새로고침 = 화면 깜빡 + 스크롤/포커스 유실)을
 * 클라 내비로 대체. 전환(useTransition) 동안 기존 화면이 그대로 남고 결과만 부드럽게 교체된다.
 * 다른 searchParams는 전부 보존(GET 폼의 hidden input 보존 불필요), page는 리셋(FilterSelect 규약).
 */
export function SearchForm({
  paramName = "q",
  placeholder,
  defaultValue,
  inputWidth = "w-32",
  className = "ml-auto flex items-center gap-2",
  resetParams = [],
}: {
  paramName?: string;
  placeholder: string;
  defaultValue?: string | null;
  /** 입력창 폭 클래스 — 사이트별 기존 폭 유지용. */
  inputWidth?: string;
  className?: string;
  /** 검색 시 함께 제거할 파라미터(page는 항상 제거). */
  resetParams?: string[];
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
      <div className="border-border bg-bg-soft text-text-dim flex items-center gap-2 rounded-sm border px-2.5 py-1.5">
        <EyIcon name="search" size={13} />
        <input
          ref={inputRef}
          type="search"
          name={paramName}
          defaultValue={defaultValue ?? ""}
          placeholder={placeholder}
          className={`text-foreground placeholder:text-text-faint ${inputWidth} bg-transparent text-xs focus:outline-none`}
        />
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "검색 중…" : "검색"}
      </Button>
    </form>
  );
}
