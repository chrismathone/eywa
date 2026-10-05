"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { searchMakeupOptions } from "../server/actions";
import type { MakeupOption } from "../server/read-types";
import { makeupOptionLabel } from "./option-label";

export function OptionPicker({ kind, name, label, searchPlaceholder, subject, initial, required = false, onSelect, filter, disabled = false }: {
  kind: "students" | "classes" | "staff" | "classrooms" | "policies" | "attendance" | "reports" | "sessions";
  name: string; label: string; searchPlaceholder?: string; subject?: string; initial?: MakeupOption; required?: boolean;
  onSelect?: (value: MakeupOption | undefined) => void;
  filter?: { student_id?: string; session_date?: string; class_id?: string; purpose?: "original" | "anchor" };
  disabled?: boolean;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<MakeupOption[]>(initial ? [initial] : []);
  const [selected, setSelected] = useState(initial?.id ?? "");
  const [selectedRow, setSelectedRow] = useState(initial);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const request = useRef(0);
  const load = (targetPage: number) => {
    if (disabled) return;
    const sequence = ++request.current;
    startTransition(async () => {
      try {
        const result = await searchMakeupOptions({ ...filter, kind, q: query, subject_key: subject, page: targetPage, page_size: 30 });
        if (sequence !== request.current) return;
        if (result.error || !result.data) { setError(result.error ?? "목록을 불러오지 못했습니다"); return; }
        setOptions(result.data.rows); setPage(result.data.page); setTotal(result.data.total); setLoaded(true); setError("");
      } catch { if (sequence === request.current) setError("목록을 불러오지 못했습니다. 다시 검색해 주세요."); }
    });
  };
  const selectedOption = options.find(option => option.id === selected) ?? selectedRow;
  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block font-medium">{label}</label>
      <div className="flex gap-2">
        <Input aria-label={`${label} 검색어`} disabled={disabled} placeholder={searchPlaceholder} value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); load(1); } }} />
        <Button type="button" variant="outline" disabled={pending || disabled} onClick={() => load(1)}>{pending ? "조회 중…" : "검색"}</Button>
      </div>
      <select id={inputId} name={name} required={required} disabled={disabled} value={selected} onFocus={() => { if (!loaded) load(1); }}
        className="border-line min-h-10 w-full rounded-md border bg-white px-2"
        onChange={e => { const row = options.find(option => option.id === e.target.value);
          setSelected(e.target.value); setSelectedRow(row); onSelect?.(row); }}>
        <option value="">선택해 주세요</option>
        {selectedOption && !options.some(option => option.id === selected) ? <option value={selected}>{makeupOptionLabel(kind, selectedOption)}</option> : null}
        {options.map(option => <option key={option.id} value={option.id}>{makeupOptionLabel(kind, option)}</option>)}
      </select>
      {loaded && !total && !error ? <p role="status" className="text-sm">
        {kind === "classes" && filter?.purpose === "anchor"
          ? "실시 날짜에 수강 중인 같은 과목 반이 없습니다. 원생목록에서 수강 반과 수강 기간을 확인한 뒤 다시 검색해 주세요."
          : "검색 결과가 없습니다. 검색어와 선택 조건을 확인해 주세요."}
      </p> : null}
      {total > 30 ? <div className="flex items-center gap-3 text-sm">
        <Button type="button" variant="outline" disabled={pending || page <= 1} aria-label={`${label} 이전 목록`} onClick={() => load(page - 1)}>이전</Button>
        <span>{page} / {Math.ceil(total / 30)} · {total}건</span>
        <Button type="button" variant="outline" disabled={pending || page * 30 >= total} aria-label={`${label} 다음 목록`} onClick={() => load(page + 1)}>다음</Button>
      </div> : null}
      {error ? <p role="alert" className="text-danger text-sm">{error}</p> : null}
    </div>
  );
}
