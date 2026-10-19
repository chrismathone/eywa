"use client";

import { Input } from "@/components/ui/input";
import { DATASET_LABELS, FIELDS, type Dataset } from "../contract";

export type SelectedCsv = { file: File; headers: string[]; mapping: Record<string, string> };
export function FileFields({ dataset, selected, onFile, onMapping }: {
  dataset: Dataset; selected?: SelectedCsv; onFile: (file?: File) => void;
  onMapping: (field: string, header: string) => void;
}) {
  return <section className="bg-card shadow-card space-y-3 rounded-2xl p-4">
    <h3 className="text-base font-bold">{DATASET_LABELS[dataset]}</h3>
    <label className="block space-y-1 text-sm">
      <span>CSV 파일 (512KB 이하)</span>
      <Input aria-label={`${DATASET_LABELS[dataset]} CSV`} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
    </label>
    {selected ? <>
      <p className="text-xs">파일 선택 완료 · 열 {selected.headers.length}개</p>
      <div className="flex flex-wrap gap-3">
        {Object.entries(FIELDS[dataset]).map(([field, label]) => <label key={field} className="min-w-40 flex-1 space-y-1 text-sm">
          <span>{label}</span>
          <select aria-label={`${DATASET_LABELS[dataset]} ${label}`} required className="border-input bg-card h-8 w-full rounded-lg border px-2 text-sm"
            value={selected.mapping[field] ?? ""} onChange={(e) => onMapping(field, e.target.value)}>
            <option value="">열 선택</option>
            {selected.headers.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>)}
      </div>
    </> : <p className="text-xs">데이터가 없어도 열 이름이 있는 파일을 선택해 주세요.</p>}
  </section>;
}
