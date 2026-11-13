"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { CONTROL_H_SM, CONTROL_LABEL_SM } from "@/components/ui/control-scale";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * 선생님 표의 필터(항목 · 과목) — 칩을 옆으로 늘어놓지 않고 드롭다운 하나에 체크로 여럿 고른다(원장 2026-11-12 *"항목과 과목 필터를 우측으로 나열하지말고 드랍다운형태로 동시선택가능하게"*).
 * 아무것도 안 고르면 '전체'. 항목을 눌러도 메뉴는 닫히지 않는다(여럿을 고르는 데 두 번 열 이유가 없다).
 */
export function MultiPick<K extends string | null>({ label, options, value, onChange }: {
  label: string; options: readonly { key: K; label: string }[]; value: readonly K[]; onChange: (next: K[]) => void;
}) {
  const picked = options.filter((o) => value.includes(o.key));
  const summary = picked.length ? picked.map((o) => o.label).join(" · ") : "전체";
  const toggle = (key: K) => onChange(options.map((o) => o.key).filter((k) => (k === key ? !value.includes(k) : value.includes(k))));
  return <DropdownMenu>
    <DropdownMenuTrigger render={<button type="button" aria-label={`${label}: ${summary}`}
      className={`${CONTROL_H_SM} ${CONTROL_LABEL_SM} border-line hover:bg-bg-soft inline-flex max-w-full min-w-0 items-center gap-1 rounded-lg border px-2 font-bold`} />}>
      <span className="text-text-dim shrink-0">{label}</span>
      <span className={`min-w-0 truncate ${picked.length ? "text-primary" : ""}`}>{summary}</span>
      <EyIcon name="chevronDown" size={14} className="shrink-0 opacity-60" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="min-w-36">
      <DropdownMenuItem onClick={() => onChange([])} className="font-medium">전체</DropdownMenuItem>
      <DropdownMenuSeparator />
      {options.map((o) => <DropdownMenuCheckboxItem key={o.key ?? ""} checked={value.includes(o.key)} closeOnClick={false} onCheckedChange={() => toggle(o.key)}>{o.label}</DropdownMenuCheckboxItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
