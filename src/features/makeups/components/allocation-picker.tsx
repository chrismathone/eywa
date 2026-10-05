"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MakeupCaseRow } from "../server/read-types";
import { searchAllocationCases } from "../server/actions";

export function AllocationPicker({ row, refreshExtras = false }: { row: MakeupCaseRow; refreshExtras?: boolean }) {
  const [added, setAdded] = useState<MakeupCaseRow[]>([]);
  const rows = [row, ...added.filter(item => item.id !== row.id)];
  const [selected, setSelected] = useState<Set<string>>(new Set([row.id]));
  const [extra, setExtra] = useState<MakeupCaseRow[]>([]);
  const [page, setPage] = useState(1), [total, setTotal] = useState(0), [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const request = useRef({ sequence: 0 });
  const load = useCallback((targetPage: number) => {
    const generation = request.current;
    const mine = ++generation.sequence;
    startTransition(async () => {
      try {
        const result = await searchAllocationCases({ student_id: row.student_id, subject_key: row.subject_key, page: targetPage });
        if (mine !== generation.sequence) return;
        if (!result.data) { setError(result.error ?? "보강 건을 조회하지 못했습니다"); return; }
        setExtra(result.data.rows); setPage(result.data.page); setTotal(result.data.total); setError("");
      } catch { if (mine === generation.sequence) setError("보강 건을 조회하지 못했습니다. 다시 시도해 주세요."); }
    });
  }, [row.student_id, row.subject_key]);
  useEffect(() => {
    const generation = request.current;
    if (refreshExtras) load(1);
    return () => { ++generation.sequence; };
  }, [refreshExtras, load]);
  const add = (value: MakeupCaseRow) => {
    setAdded(current => current.some(item => item.id === value.id) ? current : [...current, value]);
    setSelected(current => new Set([...current, value.id]));
  };
  return <fieldset className="border-line space-y-2 rounded-md border p-3"><legend className="px-1 font-bold">원수업별 분량 배정</legend>
    {rows.map(item => <AllocationRow key={item.id} item={item} selected={selected.has(item.id)} onSelect={checked => {
      setSelected(current => { const next = new Set(current); if (checked) next.add(item.id); else next.delete(item.id); return next; });
    }} />)}
    <Button type="button" variant="outline" disabled={pending} onClick={() => load(1)}>같은 학생의 다른 미처리 건 찾기</Button>
    {extra.filter(item => !rows.some(existing => existing.id === item.id)).map(item => <div key={item.id} className="flex items-center justify-between gap-3">
      <span>{item.original_date ?? "추가 지도"} · {item.original_class_name ?? "원결석 없음"} · 예약 가능 {item.reservable_minutes ?? "미정"}분</span>
      <Button type="button" variant="outline" disabled={!item.reservable_minutes} onClick={() => add(item)}>함께 배정</Button>
    </div>)}
    {total > 30 ? <div className="flex items-center gap-3">
      <Button type="button" variant="outline" disabled={pending || page <= 1} onClick={() => load(page - 1)}>이전 보강 건</Button>
      <span>{page} / {Math.ceil(total / 30)}</span>
      <Button type="button" variant="outline" disabled={pending || page * 30 >= total} onClick={() => load(page + 1)}>다음 보강 건</Button>
    </div> : null}
    {error ? <p role="alert">{error}</p> : null}
  </fieldset>;
}

function AllocationRow({ item, selected, onSelect }: { item: MakeupCaseRow; selected: boolean; onSelect: (checked: boolean) => void }) {
  const [quantity, setQuantity] = useState(String(Math.min(item.reservable_minutes ?? 0, 60) || ""));
  const noticeId = useId();
  const exceeded = selected && item.reservable_minutes !== null && Number(quantity) > item.reservable_minutes;
  return <div className="flex flex-wrap items-center gap-3">
    <label className="flex min-h-6 items-center gap-2"><input type="checkbox" checked={selected} onChange={e => onSelect(e.target.checked)} />
      {item.original_date ?? "추가 지도"} · {item.original_class_name ?? "원결석 없음"}</label>
    <label className="flex items-center gap-2">배정(분)
      <Input type="number" name={`allocation:${item.id}`} min={1} max={item.reservable_minutes ?? undefined} step={1}
        value={quantity} onChange={e => setQuantity(e.target.value)} disabled={!selected} required={selected} className="max-w-28"
        aria-invalid={exceeded || undefined} aria-describedby={exceeded ? noticeId : undefined} />
    </label><span className="text-sm">예약 가능 {item.reservable_minutes ?? "미정"}분</span>
    {exceeded ? <p id={noticeId} role="status" className="text-danger w-full text-sm">입력한 분량이 현재 예약 가능량을 넘습니다. 분량을 확인해 주세요.</p> : null}
  </div>;
}
