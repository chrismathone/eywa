"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * 분류별 다중 선택 드롭다운을 가로로 나열(원장 2026-09-28 *"우측으로 모두 나열하고 각 항목을 드랍다운해서 중복 체크"*).
 * 알림 종류·활동 종류·사람 고르기에 같이 쓴다. 항목을 눌러도 닫히지 않는다. `locked` 항목은 보이되 고를 수 없다.
 */
export const SLACK_BTN =
  "border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition disabled:opacity-50";
export const SLACK_BTN_ON = SLACK_BTN.replace("text-text-dim", "text-foreground");

export type CheckOption = { key: string; label: string; group: string; locked?: boolean };

export function CheckDropdowns({
  groups,
  options,
  picked,
  onChange,
  ariaPrefix,
}: {
  groups: readonly { id: string; label: string }[];
  options: readonly CheckOption[];
  picked: readonly string[];
  onChange: (next: string[]) => void;
  ariaPrefix: string;
}) {
  const set = new Set(picked);
  const apply = (keys: string[], on: boolean) => {
    const next = new Set(set);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    onChange(options.filter((o) => next.has(o.key)).map((o) => o.key));
  };

  return (
    <>
      {groups.map((g) => {
        const opts = options.filter((o) => o.group === g.id);
        if (opts.length === 0) return null;
        const open = opts.filter((o) => !o.locked);
        const count = opts.filter((o) => set.has(o.key)).length;
        const all = open.length > 0 && open.every((o) => set.has(o.key));
        return (
          <DropdownMenu key={g.id}>
            <DropdownMenuTrigger
              render={
                <button type="button" aria-label={`${ariaPrefix} ${g.label} ${count}개 선택됨`} className={count > 0 ? SLACK_BTN_ON : SLACK_BTN} />
              }
            >
              {g.label} {count}/{open.length}
              <EyIcon name="chevronDown" size={14} className="opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-96 w-auto min-w-56">
              {open.length > 0 ? (
                <>
                  <DropdownMenuItem closeOnClick={false} onClick={() => apply(open.map((o) => o.key), !all)} className="font-medium">
                    {all ? "모두 해제" : "모두 선택"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              {opts.map((o) => (
                <DropdownMenuCheckboxItem
                  key={o.key}
                  checked={set.has(o.key)}
                  disabled={o.locked}
                  closeOnClick={false}
                  onCheckedChange={() => apply([o.key], !set.has(o.key))}
                >
                  {o.locked ? `${o.label} (발송 금지)` : o.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </>
  );
}
