"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Loader2 } from "@/components/icons/aywa-icon-compat";
import { KIND_ICON, KIND_LABEL, type ExploreTarget } from "../model";

type Props = {
  onPick: (target: ExploreTarget) => void;
  size?: "sm" | "lg";
  autoFocus?: boolean;
};

type Result = { term: string; hits: ExploreTarget[]; error: boolean };

/**
 * 원생·수업·강사 검색 → 고르면 **같은 중심 전환**(`onPick`). 서버는 `/api/explore/search`(검색 팰릿과 같은 스코프).
 * 2글자부터 · 250ms 디바운스 · 늦게 온 옛 응답은 버린다(term이 다르면 안 그린다).
 */
export function ExploreSearch({ onPick, size = "sm", autoFocus }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [result, setResult] = useState<Result>({ term: "", hits: [], error: false });
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const term = q.trim();
  const enabled = term.length >= 2;

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/explore/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          const json = (await r.json()) as { hits: ExploreTarget[] };
          setResult({ term, hits: json.hits, error: false });
          setActive(0);
        })
        .catch((e: unknown) => {
          if ((e as { name?: string })?.name !== "AbortError") setResult({ term, hits: [], error: true });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [term, enabled]);

  const fresh = result.term === term;
  const hits = enabled && fresh ? result.hits : [];
  const loading = enabled && !fresh;
  const failed = enabled && fresh && result.error;
  const showList = open && enabled;

  const pick = (t: ExploreTarget) => {
    setOpen(false);
    setQ("");
    onPick(t);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(hits.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (hits[active]) {
        e.preventDefault();
        pick(hits[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const inputCls = size === "lg" ? "h-12 text-base" : "h-(--control-h) text-sm";
  return (
    <div
      ref={wrap}
      className={`relative ${size === "lg" ? "w-full" : "w-64 max-w-full"}`}
      onBlurCapture={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <div className="relative">
        <EyIcon name="search" size={16} className="text-text-dim pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
        <input
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && hits[active] ? `${listId}-${active}` : undefined}
          aria-label="원생·수업·강사 검색"
          placeholder="원생명, 반, 수업, 강사, 강의실 검색"
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          className={`border-line bg-background text-foreground focus-visible:ring-ring w-full rounded-lg border pr-3 pl-9 leading-normal focus-visible:ring-2 focus-visible:outline-none ${inputCls}`}
        />
        {loading ? <Loader2 className="text-text-dim absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" /> : null}
      </div>
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="검색 결과"
          className="bg-card shadow-modal border-line absolute right-0 left-0 z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border p-1"
        >
          {failed ? (
            <li className="text-danger px-3 py-2 text-sm" role="status">
              검색하지 못했습니다. 잠시 뒤 다시 시도해 주세요.
            </li>
          ) : hits.length === 0 && !loading ? (
            <li className="text-text-dim px-3 py-2 text-sm">일치하는 원생·수업·강사가 없습니다.</li>
          ) : (
            hits.map((t, i) => (
              <li
                key={`${t.kind}:${t.id}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(t)}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 ${i === active ? "bg-primary-softer" : ""}`}
              >
                <span className="bg-bg-soft text-text-dim flex size-7 shrink-0 items-center justify-center rounded-full">
                  <EyIcon name={KIND_ICON[t.kind]} size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate text-sm font-bold">{t.label}</span>
                  {t.detail ? <span className="text-text-dim block truncate text-xs">{t.detail}</span> : null}
                </span>
                <span className="text-text-dim shrink-0 text-xs">{KIND_LABEL[t.kind]}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
