"use client";

import type { ReactNode } from "react";
import { useLockedPlaceholder } from "./write-lock-context";

const inputCls =
  "border-line text-foreground block w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-foreground text-xs font-bold">{label}</span>
      {hint ? <span className="text-text-dim ml-2 text-xs">{hint}</span> : null}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  // 읽기 권한(쓰기 잠금)이면 빈 칸의 placeholder가 권한 안내가 된다(write-lock-context.tsx).
  const ph = useLockedPlaceholder();
  return (
    <Field label={label} hint={hint}>
      <input
        className={inputCls}
        value={value}
        placeholder={ph(placeholder)}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/**
 * 색상 필드 — 네이티브 스와치(색 선택) + hex 텍스트 입력 동기. 반 색상 폼과 동일 패턴.
 * `note` = 입력 아래 한 줄 상태 문구. 저장은 됐지만 실제로는 적용되지 않는 값일 때(브랜드색이
 * 기본색으로 간주돼 주입 생략되는 경우 등) 그 사실을 알리는 용도 — 스와치만 보여주면 사용자가
 * "저장은 초록인데 화면은 왜 파랗지?"로 읽는다(2026-07-20 감사).
 */
export function ColorField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  note,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  note?: string;
}) {
  const valid = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(value.trim());
  const ph = useLockedPlaceholder();
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} 색상 선택`}
          value={valid ? value.trim() : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="border-line h-9 w-11 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
        />
        <input
          className={inputCls}
          value={value}
          placeholder={ph(placeholder)}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {note ? <p className="text-text-dim mt-1.5 text-xs leading-snug">{note}</p> : null}
    </Field>
  );
}

export function TextAreaField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  rows = 4,
  maxLength,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
}) {
  const ph = useLockedPlaceholder();
  return (
    <Field label={label} hint={hint}>
      <textarea
        className={inputCls}
        rows={rows}
        maxLength={maxLength}
        value={value}
        placeholder={ph(placeholder)}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        className={inputCls}
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

/** on/off 토글 — 라벨 우측 체크박스. 보고서 표시 항목 등 불리언 설정용. */
export function ToggleField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
      <span className="min-w-0">
        <span className="text-foreground text-xs font-bold">{label}</span>
        {hint ? <span className="text-text-dim ml-2 text-xs">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="border-line accent-primary h-4 w-4 shrink-0 cursor-pointer rounded"
      />
    </label>
  );
}

export function SelectField({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Field label={label} hint={hint}>
      <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
