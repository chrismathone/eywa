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
import { FORWARD_EVENT_OPTIONS } from "@/features/slack/events";

/**
 * 보낼 알림 고르기 — 분류 하나 = 드롭다운 하나, 가로로 나열(원장 2026-09-28 *"우측으로 모두 나열하고 각 항목을
 * 드랍다운해서 중복 체크가능하게"*). 항목을 눌러도 닫히지 않아 여러 개를 한 번에 고른다. 트리거에 `고른 수/전체`.
 */
export const SLACK_BTN =
  "border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition disabled:opacity-50";

const GROUPS = [...new Set(FORWARD_EVENT_OPTIONS.map((o) => o.group))];

export function EventDropdowns({
  picked,
  onChange,
  ariaPrefix,
}: {
  picked: readonly string[];
  onChange: (next: string[]) => void;
  ariaPrefix: string;
}) {
  const set = new Set(picked);
  const apply = (types: string[], on: boolean) => {
    const next = new Set(set);
    for (const t of types) {
      if (on) next.add(t);
      else next.delete(t);
    }
    onChange(FORWARD_EVENT_OPTIONS.filter((o) => next.has(o.type)).map((o) => o.type));
  };

  return (
    <>
      {GROUPS.map((group) => {
        const options = FORWARD_EVENT_OPTIONS.filter((o) => o.group === group);
        const count = options.filter((o) => set.has(o.type)).length;
        const all = count === options.length;
        return (
          <DropdownMenu key={group}>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`${ariaPrefix} ${group} 알림 ${count}개 선택됨`}
                  className={count > 0 ? SLACK_BTN.replace("text-text-dim", "text-foreground") : SLACK_BTN}
                />
              }
            >
              {group} {count}/{options.length}
              <EyIcon name="chevronDown" size={14} className="opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-auto min-w-48">
              <DropdownMenuItem
                closeOnClick={false}
                onClick={() => apply(options.map((o) => o.type), !all)}
                className="font-medium"
              >
                {all ? "모두 해제" : "모두 선택"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {options.map((o) => (
                <DropdownMenuCheckboxItem
                  key={o.type}
                  checked={set.has(o.type)}
                  closeOnClick={false}
                  onCheckedChange={() => apply([o.type], !set.has(o.type))}
                >
                  {o.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </>
  );
}
