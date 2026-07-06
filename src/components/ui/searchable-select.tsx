"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export type ComboOption = { value: string; label: string; hint?: string };

/**
 * 검색형 콤보박스 — 옵션이 수백 개인 native `<select>`(학생·반 선택 등)를 대체한다.
 * 네이티브 select 팝업은 전역 디자인 스크롤바가 안 닿고(타입어헤드뿐) 수백 옵션이 그대로 벽이 되므로,
 * 타이핑 필터 + 렌더 캡(기본 50) + 디자인 스크롤바가 적용되는 div 팝업으로 컴팩트하게.
 *
 * - 폼 모드: `name`을 주면 hidden input으로 선택값을 제출(필수성은 서버 액션 검증에 위임).
 * - 네비 모드: `value`(제어) + `onValueChange`로 라우팅 등에 사용.
 */
export function SearchableSelect({
  options,
  value,
  defaultValue = "",
  onValueChange,
  name,
  placeholder = "선택...",
  searchPlaceholder = "검색...",
  cap = 50,
  className,
  ariaLabel,
}: {
  options: ComboOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  name?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  cap?: number;
  className?: string;
  /** 트리거 버튼의 접근성 이름 — 선택값만으론 무엇의 드롭다운인지 불명할 때(필터 등) 서술 라벨 제공. */
  ariaLabel?: string;
}) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const current = isControlled ? value : internal;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === current) ?? null;
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(t) || (o.hint ?? "").toLowerCase().includes(t),
    );
  }, [q, options]);
  const shown = filtered.slice(0, cap);
  const overflow = filtered.length - shown.length;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function choose(v: string) {
    if (!isControlled) setInternal(v);
    onValueChange?.(v);
    setOpen(false);
    setQ("");
  }

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className="border-border bg-card text-foreground flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
      >
        <span className={`truncate ${selected ? "" : "text-text-faint"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-50" />
      </button>
      {open ? (
        <div className="border-border bg-card absolute z-50 mt-1 w-full min-w-[12rem] overflow-hidden rounded-md border shadow-lg">
          <div className="border-border flex items-center gap-2 border-b px-2.5 py-1.5">
            <Search className="size-3.5 shrink-0 opacity-50" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                // Enter = 첫 결과 선택. preventDefault 필수 — 폼 안에서 쓰이면 Enter가 바깥 폼을
                // 암묵 제출(HTML implicit submission)해 의도치 않은 저장이 발화한다(적대리뷰 2026-07-06).
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (shown.length > 0) choose(shown[0].value);
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setOpen(false);
                  setQ("");
                }
              }}
              placeholder={searchPlaceholder}
              className="text-foreground placeholder:text-text-faint w-full bg-transparent text-sm focus:outline-none"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {shown.length === 0 ? (
              <li className="text-text-faint px-3 py-2 text-xs">결과 없음</li>
            ) : (
              shown.map((o) => (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => choose(o.value)}
                    className="hover:bg-bg-soft flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm"
                  >
                    <span className="truncate">
                      {o.label}
                      {o.hint ? <span className="text-text-faint ml-1 text-xs">{o.hint}</span> : null}
                    </span>
                    {o.value === current ? <Check className="text-primary size-3.5 shrink-0" /> : null}
                  </button>
                </li>
              ))
            )}
            {overflow > 0 ? (
              <li className="text-text-faint px-3 py-1.5 text-[11px]">
                +{overflow}개 더 — 검색으로 좁히세요
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
