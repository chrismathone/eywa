"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Band, Scoring } from "@/features/teacher-portfolio/evaluation/config";
import { bandIssues, describeScoring, zeroMaxIssue } from "@/features/teacher-portfolio/evaluation/scoring";
import { useWriteLock } from "../write-lock-context";

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * 숫자 칸 — 치는 중인 글자("1.", "-")를 지우지 않고, 보통 숫자가 되는 순간에만 값을 올린다(`0x10`·`1e3`은 숫자로 안 본다).
 * 비우면 null(허용할 때만). 비울 수 없는 칸을 비우거나 숫자가 아닌 채로 떠나면 저장될 값으로 글자를 되돌린다(빈 칸인데 옛 값이 저장되지 않게).
 */
export function NumField({ value, onChange, allowEmpty, label, className = "w-20" }: {
  value: number | null; onChange: (n: number | null) => void; allowEmpty?: boolean; label: string; className?: string;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [seen, setSeen] = useState(value);
  // 밖에서 값이 바뀌었을 때만 글자를 다시 맞춘다(치는 중인 "1."을 "1"로 바꾸지 않게).
  if (value !== seen) {
    setSeen(value);
    const same = value === null ? text.trim() === "" : text.trim() !== "" && Number(text) === value;
    if (!same) setText(value === null ? "" : String(value));
  }
  return (
    <Input aria-label={label} inputMode="decimal" value={text} placeholder={allowEmpty ? "없음" : undefined}
      aria-invalid={text.trim() === "" ? !allowEmpty : !DECIMAL.test(text.trim())}
      className={`num text-right ${className}`}
      onBlur={() => {
        const t = text.trim();
        if (t === "" ? !allowEmpty : !DECIMAL.test(t)) setText(value === null ? "" : String(value));
      }}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t.trim() === "") { if (allowEmpty) onChange(null); return; }
        if (DECIMAL.test(t.trim())) onChange(Number(t));
      }} />
  );
}

const MODES: { mode: Scoring["mode"]; label: string }[] = [
  { mode: "linear", label: "비례" }, { mode: "bands", label: "구간표" }, { mode: "perUnit", label: "건당" },
];

function startOf(mode: Scoring["mode"], max: number, unit: string): Scoring {
  if (mode === "linear") return { mode, zero: 0, full: unit === "%" ? 100 : 10 };
  if (mode === "bands") return { mode, bands: [{ from: null, to: null, points: max }] };
  return { mode, points: 5, cap: true };
}

export function ScoringEditor({ scoring, max, unit, onChange, label }: {
  scoring: Scoring; max: number; unit: string; onChange: (s: Scoring) => void; label: string;
}) {
  const setBand = (i: number, patch: Partial<Band>) =>
    scoring.mode === "bands" && onChange({ ...scoring, bands: scoring.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const { locked } = useWriteLock();
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label={`${label} 점수 규칙`} className="flex flex-wrap gap-1.5"
        onKeyDown={(e) => {
          // 라디오 묶음의 화살표 이동(선택도 함께 옮긴다).
          const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          const next = (MODES.findIndex((m) => m.mode === scoring.mode) + step + MODES.length) % MODES.length;
          onChange(startOf(MODES[next]!.mode, max, unit));
          e.currentTarget.querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus();
        }}>
        {MODES.map((m) => (
          <Button key={m.mode} type="button" size="sm" role="radio" aria-checked={scoring.mode === m.mode} tabIndex={scoring.mode === m.mode ? 0 : -1}
            variant={scoring.mode === m.mode ? "default" : "outline"}
            onClick={() => scoring.mode !== m.mode && onChange(startOf(m.mode, max, unit))}>{m.label}</Button>
        ))}
      </div>
      {scoring.mode === "linear" ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="flex items-center gap-1.5">만점 기준 <NumField label={`${label} 만점 기준`} value={scoring.full} onChange={(n) => onChange({ ...scoring, full: n ?? 0 })} /> {unit}</span>
          <span className="flex items-center gap-1.5">0점 기준 <NumField label={`${label} 0점 기준`} value={scoring.zero} onChange={(n) => onChange({ ...scoring, zero: n ?? 0 })} /> {unit}</span>
        </div>
      ) : null}
      {scoring.mode === "bands" ? (
        <div className="space-y-2">
          <p className="text-xs">위에서부터 처음 맞는 구간의 점수를 줍니다. 양 끝을 포함하고, 비운 칸은 끝이 없다는 뜻입니다.</p>
          {scoring.bands.map((b, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5 text-sm">
              <NumField label={`${label} ${i + 1}번째 구간 시작`} allowEmpty value={b.from} onChange={(n) => setBand(i, { from: n })} />
              <span>~</span>
              <NumField label={`${label} ${i + 1}번째 구간 끝`} allowEmpty value={b.to} onChange={(n) => setBand(i, { to: n })} />
              <span>{unit}</span>
              <span aria-hidden>→</span>
              <NumField label={`${label} ${i + 1}번째 구간 점수`} value={b.points} onChange={(n) => setBand(i, { points: n ?? 0 })} />
              <span>점</span>
              {locked ? null : (
                <Button type="button" size="sm" variant="ghost" disabled={scoring.bands.length === 1}
                  onClick={() => onChange({ ...scoring, bands: scoring.bands.filter((_, j) => j !== i) })}>구간 삭제</Button>
              )}
            </div>
          ))}
          {locked ? null : (
            <Button type="button" size="sm" variant="outline" disabled={scoring.bands.length >= 20}
              onClick={() => onChange({ ...scoring, bands: [...scoring.bands, { from: null, to: null, points: 0 }] })}>구간 추가</Button>
          )}
          {/* 빈틈·만점 초과는 막지 않고 알린다 — 원장이 일부러 둔 것일 수도 있다. */}
          {bandIssues(scoring.bands, max, unit).map((t) => <p key={t} role="status" className="bg-amber-soft rounded-lg px-3 py-2 text-xs">{t}</p>)}
        </div>
      ) : null}
      {scoring.mode === "perUnit" ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="flex items-center gap-1.5">1{unit || "건"}당 <NumField label={`${label} 건당 점수`} value={scoring.points} onChange={(n) => onChange({ ...scoring, points: n ?? 0 })} /> 점</span>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={scoring.cap} onChange={(e) => onChange({ ...scoring, cap: e.target.checked })} className="size-4" />
            만점에서 멈춤
          </label>
        </div>
      ) : null}
      {zeroMaxIssue(scoring, max) ? <p role="status" className="bg-amber-soft rounded-lg px-3 py-2 text-xs">{zeroMaxIssue(scoring, max)}</p> : null}
      <p className="text-primary text-xs">{describeScoring(scoring, max, unit)}</p>
    </div>
  );
}
