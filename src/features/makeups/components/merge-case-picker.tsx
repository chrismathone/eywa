"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { searchMergeCases } from "../server/actions";
import type { MakeupCaseRow } from "../server/read-types";

export function MergeCasePicker({ row }: { row: MakeupCaseRow }) {
  const id = useId(), request = useRef(0);
  const [rows, setRows] = useState<MakeupCaseRow[]>([]), [selected, setSelected] = useState<MakeupCaseRow>();
  const [page, setPage] = useState(1), [total, setTotal] = useState(0), [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const load = (next: number) => {
    const sequence = ++request.current;
    startTransition(async () => {
      try {
        const result = await searchMergeCases({ student_id: row.student_id, subject_key: row.subject_key, page: next });
        if (sequence !== request.current) return;
        if (!result.data) { setError(result.error ?? "대표 보강을 조회하지 못했습니다"); return; }
        setRows(result.data.rows.filter(item => item.id !== row.id)); setPage(result.data.page); setTotal(result.data.total); setError("");
      } catch { if (sequence === request.current) setError("대표 보강을 조회하지 못했습니다. 다시 조회해 주세요."); }
    });
  };
  const options = selected && !rows.some(item => item.id === selected.id) ? [selected, ...rows] : rows;
  return <div className="space-y-2">
    <label htmlFor={id} className="block font-medium">같은 학생·과목의 대표 보강</label>
    <Button type="button" variant="outline" disabled={pending} onClick={() => load(1)}>대표 보강 찾기</Button>
    <select id={id} name="merged_into" required value={selected?.id ?? ""} onFocus={() => { if (!total) load(1); }}
      onChange={event => setSelected(options.find(item => item.id === event.target.value))} className="border-line min-h-10 w-full rounded-md border bg-white px-2">
      <option value="">선택해 주세요</option>{options.map(item => <option key={item.id} value={item.id}>
        {item.original_date ?? "원결석 없음"} · {item.original_class_name ?? "추가 지도"} · 잔량 {item.outstanding_minutes ?? "미정"}분
      </option>)}
    </select>
    {total > 30 ? <div className="flex items-center gap-3">
      <Button type="button" variant="outline" disabled={pending || page <= 1} onClick={() => load(page - 1)}>이전 대표 보강</Button>
      <span>{page} / {Math.ceil(total / 30)}</span>
      <Button type="button" variant="outline" disabled={pending || page * 30 >= total} onClick={() => load(page + 1)}>다음 대표 보강</Button>
    </div> : null}
    <p className="text-sm">현재 건의 근거를 대표 건에 모읍니다. 예약·잔량·인정량을 자동 합산하지 않습니다.</p>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
