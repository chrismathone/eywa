"use client";

// 배열형 설정(과목·직급·학년·교시·학기·공휴일) 편집기 — 행 추가/삭제 + 인라인 입력.
import { Plus, X } from "lucide-react";
import { SUBJECT_COLORS, type HolidaySetting, type PeriodTimeRow, type SubjectSetting, type TermSetting } from "@/features/owner/settings-types";

const cellCls =
  "border-line text-foreground rounded-md border bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:border-primary";

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-line text-text-dim hover:text-foreground hover:border-primary inline-flex items-center gap-1 rounded-md border border-dashed px-3 py-1.5 text-[12px]"
    >
      <Plus className="size-3.5" /> {label}
    </button>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="삭제"
      className="text-text-faint hover:text-danger shrink-0 rounded p-1"
    >
      <X className="size-4" />
    </button>
  );
}

export function StringListEditor({
  value,
  onChange,
  placeholder,
  addLabel,
  type = "text",
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  addLabel: string;
  type?: "text" | "date";
}) {
  const set = (i: number, v: string) => onChange(value.map((x, j) => (j === i ? v : x)));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((v, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              type={type}
              className={`${cellCls} ${type === "date" ? "w-[140px]" : "w-[110px]"}`}
              value={v}
              placeholder={placeholder}
              onChange={(e) => set(i, e.target.value)}
            />
            <RemoveButton onClick={() => onChange(value.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <AddButton onClick={() => onChange([...value, ""])} label={addLabel} />
    </div>
  );
}

export function SubjectListEditor({
  value,
  onChange,
}: {
  value: SubjectSetting[];
  onChange: (v: SubjectSetting[]) => void;
}) {
  const set = (i: number, patch: Partial<SubjectSetting>) =>
    onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      {value.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={`${cellCls} w-[120px] font-mono`}
            value={s.key}
            placeholder="key (math)"
            onChange={(e) => set(i, { key: e.target.value })}
          />
          <input
            className={`${cellCls} w-[140px]`}
            value={s.label}
            placeholder="라벨 (수학)"
            onChange={(e) => set(i, { label: e.target.value })}
          />
          <select
            className={`${cellCls} w-[110px]`}
            value={s.color}
            onChange={(e) => set(i, { color: e.target.value as SubjectSetting["color"] })}
          >
            {SUBJECT_COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <RemoveButton onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddButton
        onClick={() => onChange([...value, { key: "", label: "", color: "neutral" }])}
        label="과목 추가"
      />
    </div>
  );
}

export function PeriodListEditor({
  value,
  onChange,
}: {
  value: PeriodTimeRow[];
  onChange: (v: PeriodTimeRow[]) => void;
}) {
  const set = (i: number, patch: Partial<PeriodTimeRow>) =>
    onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      {value.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={`${cellCls} w-[90px]`}
            value={p.label}
            placeholder="1교시"
            onChange={(e) => set(i, { label: e.target.value })}
          />
          <input
            type="time"
            className={`${cellCls} w-[120px]`}
            value={p.startTime}
            onChange={(e) => set(i, { startTime: e.target.value })}
          />
          <span className="text-text-faint text-[12px]">~</span>
          <input
            type="time"
            className={`${cellCls} w-[120px]`}
            value={p.endTime}
            onChange={(e) => set(i, { endTime: e.target.value })}
          />
          <RemoveButton onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddButton
        onClick={() => onChange([...value, { label: `${value.length + 1}교시`, startTime: "", endTime: "" }])}
        label="교시 추가"
      />
    </div>
  );
}

export function HolidayListEditor({
  value,
  onChange,
}: {
  value: HolidaySetting[];
  onChange: (v: HolidaySetting[]) => void;
}) {
  const set = (i: number, patch: Partial<HolidaySetting>) =>
    onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      {value.map((h, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="date"
            className={`${cellCls} w-[150px]`}
            value={h.date}
            onChange={(e) => set(i, { date: e.target.value })}
          />
          <input
            className={`${cellCls} flex-1`}
            value={h.name}
            placeholder="공휴일명 (예: 개교기념일, 설날)"
            onChange={(e) => set(i, { name: e.target.value })}
          />
          <RemoveButton onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddButton onClick={() => onChange([...value, { date: "", name: "" }])} label="휴일 추가" />
    </div>
  );
}

export function TermListEditor({
  value,
  onChange,
}: {
  value: TermSetting[];
  onChange: (v: TermSetting[]) => void;
}) {
  const set = (i: number, patch: Partial<TermSetting>) =>
    onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      {value.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={`${cellCls} w-[140px]`}
            value={t.name}
            placeholder="1학기"
            onChange={(e) => set(i, { name: e.target.value })}
          />
          <input
            type="date"
            className={`${cellCls} w-[150px]`}
            value={t.start}
            onChange={(e) => set(i, { start: e.target.value })}
          />
          <span className="text-text-faint text-[12px]">~</span>
          <input
            type="date"
            className={`${cellCls} w-[150px]`}
            value={t.end}
            onChange={(e) => set(i, { end: e.target.value })}
          />
          <RemoveButton onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddButton
        onClick={() => onChange([...value, { name: "", start: "", end: "" }])}
        label="학기 추가"
      />
    </div>
  );
}
