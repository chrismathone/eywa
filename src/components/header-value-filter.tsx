"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { useSheetText } from "@/features/teacher-view/lang-context";
import { BLANK_LABEL, BLANK_VALUE, checkedOf, encodeValueFilter, type ValueFilter } from "@/lib/value-filter";
import type { FilterSelectOption } from "./filter-select";
import { CONTROL_H_SM, CONTROL_LABEL_SM } from "./ui/control-scale";

const UNKNOWN_LABEL = "(선택지에 없는 값)";

/**
 * **엑셀식 열 머리 필터** — 원장 2026-10-14 *"오름차순/내림차순 필요없는 제목 행에 대해서는 엑셀처럼 필터적용가능하게"*.
 * 열 제목을 누르면 값 체크 목록(검색 · 모두 선택 · 지우기 · (공백))이 뜨고, **확인**을 눌러야 걸린다(취소·바깥 클릭은 그대로).
 * 주소 값 규칙은 [`value-filter.ts`](@/lib/value-filter) — 서버가 같은 풀이로 거른다. 걸리면 제목이 파랗고 깔때기가 선다.
 *
 * [`HeaderFilter`](./header-filter)(한 값을 누르면 바로 바뀌는 드롭다운)와 다른 물건이다 — 값이 많고 여러 개를 골라
 * 한 번에 거는 열(학교학년·반·담임·시험·시험정보)에 쓴다. 팝업은 포털이라 표의 overflow에 안 잘린다([[#128]]).
 * 🔴 지금 주소의 다른 값(`embed=1` 포함)은 그대로 싣는다 — 창 안에서 빠지면 다음 새로고침에 전체 셸이 뜬다([[#133]]).
 */
export function HeaderValueFilter({ paramName, axisLabel, filter, options, clearParams }: {
  paramName: string;
  /** 열 제목 = 축 이름(`반`·`담임`). */
  axisLabel: string;
  /** 지금 걸린 필터(서버가 주소에서 푼 값) — 없으면 전부 보임. */
  filter: ValueFilter | null | undefined;
  /** 값 목록 — 열 필터를 걸기 **전** 줄에서 만든다(걸면 사라지는 값은 되돌릴 수 없다). '(공백)'도 여기 들어온다. */
  options: FilterSelectOption[];
  /** 이 필터를 바꿀 때 함께 지울 파라미터. */
  clearParams?: string[];
}) {
  const text = useSheetText();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const current = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<string[]>([]);
  // 걸린 값이 목록 밖이면(기간을 좁혀 사라진 반 · 옛 링크) 끝에 세워 둔다 — 안 그러면 0건인데 어디서 걸렸는지 안 보인다.
  // '뺀다' 쪽도 세운다(꺼진 채로) — 빠지면 열고 확인만 눌러도 그 제외가 조용히 풀린다.
  const shown = useMemo((): FilterSelectOption[] => {
    const known = new Set(options.map((o) => o.value));
    const unknown = (filter?.values ?? []).filter((v) => !known.has(v));
    return [...options, ...unknown.map((value) => ({ value, label: value === BLANK_VALUE ? BLANK_LABEL : UNKNOWN_LABEL }))];
  }, [options, filter]);
  const all = useMemo(() => shown.map((o) => o.value), [shown]);
  const needle = q.trim().toLowerCase();
  const visible = needle ? shown.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(needle)) : shown;
  const picked = new Set(draft);
  const active = !!filter;

  const onOpenChange = (next: boolean) => {
    if (next) {
      setDraft(checkedOf(filter, all));
      setQ("");
    }
    setOpen(next);
  };
  const toggle = (v: string) => setDraft((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]));
  const selectVisible = () => setDraft((d) => [...new Set([...d, ...visible.map((o) => o.value)])]);
  const clearVisible = () => {
    const off = new Set(visible.map((o) => o.value));
    setDraft((d) => d.filter((v) => !off.has(v)));
  };
  const apply = (chosen: string[] = all.filter((v) => picked.has(v))) => {
    if (chosen.length === 0) return;
    const params = new URLSearchParams(current?.toString() ?? "");
    // 목록 순서로 적는다 — 같은 체크가 누른 순서에 따라 다른 주소가 되지 않게.
    const encoded = encodeValueFilter(chosen, all);
    if (encoded) params.set(paramName, encoded);
    else params.delete(paramName);
    for (const k of clearParams ?? []) params.delete(k);
    params.delete("page"); // 걸리는 줄이 바뀌니 1쪽부터.
    const s = params.toString();
    setOpen(false);
    startTransition(() => router.push(`${pathname}${s ? `?${s}` : ""}`));
  };
  // 검색칸 Enter = **검색 결과만** 건다(엑셀 빠른 검색) — 결과 중 체크한 것, 하나도 없으면 결과 전부.
  // 검색어가 없으면 확인과 같다. 숨은 값의 체크까지 그대로 걸려면 확인 버튼(구글 시트와 같다).
  const applyFromSearch = () => {
    if (!needle) return apply();
    const hits = visible.map((o) => o.value);
    const checkedHits = hits.filter((v) => picked.has(v));
    apply(checkedHits.length ? checkedHits : hits);
  };
  const labelOf = (o: FilterSelectOption) => (o.label === BLANK_LABEL || o.label === UNKNOWN_LABEL ? text(o.label) : o.label);
  const checkedVisible = visible.filter((o) => picked.has(o.value)).length;

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        aria-label={text(`${axisLabel} 필터`)}
        aria-busy={pending || undefined}
        data-filtered={active || undefined}
        className={`${CONTROL_H_SM} ${CONTROL_LABEL_SM} ${active ? "text-primary" : "text-foreground"} hover:bg-bg-soft inline-flex cursor-pointer items-center gap-0.5 rounded-md px-1 font-bold whitespace-nowrap`}
      >
        {text(axisLabel)}
        <EyIcon name={active ? "filter" : "chevronDown"} size={14} className={`size-3.5 shrink-0 ${active ? "" : "opacity-50"}`} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="z-50">
          <Popover.Popup className="border-border bg-card w-72 max-w-(--available-width) overflow-hidden rounded-md border text-left font-normal shadow-lg outline-none">
            <div className="border-border flex items-center gap-2 border-b px-2.5 py-1.5">
              <EyIcon name="search" size={14} className="size-3.5 shrink-0 opacity-50" />
              <input
                autoFocus
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                // Enter = 검색 결과만 걸기(applyFromSearch). preventDefault — 바깥에 폼이 있으면 암묵 제출이 된다.
                // 한글 조합 중 Enter는 글자를 확정하는 키라 걸지 않는다(맥 크롬은 조합 Enter 뒤 Enter를 한 번 더 보낸다 — 두 번 이동).
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) { if (e.key === "Enter") e.preventDefault(); return; }
                  if (e.key === "Enter") { e.preventDefault(); applyFromSearch(); }
                }}
                placeholder={text("값 검색")}
                aria-label={text("값 검색")}
                className="text-foreground placeholder:text-text-faint w-full bg-transparent text-sm focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
              <span className="flex items-center gap-1">
                <button type="button" onClick={selectVisible} className="text-primary cursor-pointer font-bold hover:underline">{text("모두 선택")}</button>
                <span aria-hidden className="text-text-faint">·</span>
                <button type="button" onClick={clearVisible} className="text-primary cursor-pointer font-bold hover:underline">{text("지우기")}</button>
              </span>
              <span className="num text-text-dim">{checkedVisible} / {visible.length}</span>
            </div>
            <ul className="max-h-64 overflow-y-auto pb-1">
              {visible.length === 0 ? <li className="text-text-faint px-3 py-2 text-xs">{text("결과 없음")}</li> : visible.map((o) => (
                <li key={o.value}>
                  <label className="hover:bg-bg-soft flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm">
                    <input type="checkbox" className="accent-primary size-4 shrink-0" checked={picked.has(o.value)} onChange={() => toggle(o.value)} />
                    <span className={`min-w-0 flex-1 truncate ${o.label === BLANK_LABEL || o.label === UNKNOWN_LABEL ? "text-text-dim" : ""}`}>{labelOf(o)}</span>
                    {o.hint ? <span className="text-text-faint shrink-0 text-xs">{o.hint}</span> : null}
                  </label>
                </li>
              ))}
            </ul>
            <div className="border-border flex justify-end gap-2 border-t px-3 py-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>{text("취소")}</Button>
              <Button type="button" size="sm" disabled={draft.length === 0} onClick={() => apply()}>{text("확인")}</Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
