"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";

export function TextField({ name, label, type = "text", required = false, initial, min, max, step, onChange }: {
  name: string; label: string; type?: string; required?: boolean;
  initial?: string | number; min?: number; max?: number; step?: number;
  onChange?: (value: string) => void;
}) {
  const id = useId();
  return <div className="space-y-1"><label htmlFor={id} className="block font-medium">{label}</label>
    <Input id={id} name={name} type={type} required={required} defaultValue={initial} min={min} max={max} step={step}
      onChange={onChange ? event => onChange(event.target.value) : undefined} />
  </div>;
}

export function ReasonField({ name = "reason", label = "처리 사유", required = true, initial = "" }: {
  name?: string; label?: string; required?: boolean; initial?: string;
}) {
  const id = useId();
  return <div className="space-y-1"><label htmlFor={id} className="block font-medium">{label}</label>
    <textarea id={id} name={name} required={required} defaultValue={initial} maxLength={4000} rows={3}
      className="border-line w-full rounded-md border bg-white px-3 py-2" />
  </div>;
}

export function formText(data: FormData, key: string): string {
  const value = data.get(key); return typeof value === "string" ? value.trim() : "";
}
export function formMinutes(data: FormData, key: string): number {
  const raw = formText(data, key), value = Number(raw);
  if (!raw || !Number.isSafeInteger(value)) throw new Error("분량을 정수로 입력해 주세요");
  return value;
}
