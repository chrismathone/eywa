"use client";

import { useMemo, useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/**
 * 고르기 창 — 왼쪽 분류(고른 수) · 오른쪽 검색 + 체크 목록. 알림·활동 종류(350여 종)·채널·사람 고르기에 같이 쓴다.
 * 창 안에서는 임시 선택을 고치고 '적용'을 눌러야 반영된다(닫으면 취소). `locked` = 보이되 고를 수 없다(발송 금지).
 */
export type PickerOption = { key: string; label: string; group: string; hint?: string; locked?: boolean };

export function PickerDialog({
  open,
  onOpenChange,
  title,
  description,
  groups,
  options,
  picked,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  groups: readonly { id: string; label: string }[];
  options: readonly PickerOption[];
  picked: readonly string[];
  onApply: (keys: string[]) => void;
}) {
  const [draft, setDraft] = useState<Set<string>>(() => new Set(picked));
  const [group, setGroup] = useState<string>("__all");
  const [q, setQ] = useState("");
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    // 열 때마다 저장된 선택에서 다시 시작(렌더 중 상태 맞추기 — effect에서 setState 금지 규칙).
    setLastOpen(open);
    if (open) {
      setDraft(new Set(picked));
      setQ("");
      setGroup("__all");
    }
  }

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return options.filter((o) => (group === "__all" || o.group === group) && (!needle || o.label.toLowerCase().includes(needle)));
  }, [options, group, q]);
  const open_ = visible.filter((o) => !o.locked);
  const allOn = open_.length > 0 && open_.every((o) => draft.has(o.key));
  const countIn = (g: string) => options.filter((o) => o.group === g && draft.has(o.key)).length;
  const toggle = (k: string) => setDraft((d) => (d.has(k) ? new Set([...d].filter((x) => x !== k)) : new Set([...d, k])));
  const setMany = (keys: string[], on: boolean) =>
    setDraft((d) => {
      const n = new Set(d);
      for (const k of keys) {
        if (on) n.add(k);
        else n.delete(k);
      }
      return n;
    });
  const groupLabel = (id: string) => groups.find((g) => g.id === id)?.label ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(640px,calc(100dvh-2rem))] flex-col gap-3 sm:max-w-3xl">
        <div>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription className="mt-1">{description}</DialogDescription> : null}
        </div>
        <div className="flex min-h-0 flex-1 gap-3">
          {groups.length > 1 ? (
            <nav className="border-line w-48 shrink-0 space-y-0.5 overflow-y-auto border-r pr-2" aria-label="분류">
              {[{ id: "__all", label: "전체" }, ...groups].map((g) => {
                const n = g.id === "__all" ? draft.size : countIn(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGroup(g.id)}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
                      group === g.id ? "bg-primary text-primary-foreground font-medium" : "text-foreground hover:bg-bg-soft"
                    }`}
                  >
                    <span className="truncate">{g.label}</span>
                    {n > 0 ? <span className={`ml-2 text-xs ${group === g.id ? "" : "text-primary font-medium"}`}>{n}</span> : null}
                  </button>
                );
              })}
            </nav>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <label className="border-line focus-within:border-primary flex h-(--control-h) flex-1 items-center gap-2 rounded-lg border px-2.5">
                <EyIcon name="search" size={16} className="text-text-dim" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름으로 찾기" className="h-full min-w-0 flex-1 bg-transparent text-sm leading-normal outline-none" />
              </label>
              <Button variant="outline" onClick={() => setMany(open_.map((o) => o.key), !allOn)} disabled={open_.length === 0}>
                {allOn ? "보이는 것 모두 해제" : "보이는 것 모두 선택"}
              </Button>
            </div>
            <ul className="border-line min-h-0 flex-1 divide-y divide-(--line-faint) overflow-y-auto rounded-lg border">
              {visible.length === 0 ? <li className="text-text-dim p-4 text-sm">해당하는 항목이 없습니다</li> : null}
              {visible.map((o) => {
                const on = draft.has(o.key);
                return (
                  <li key={o.key}>
                    <label className={`flex items-center gap-3 px-3 py-2 text-sm ${o.locked ? "opacity-50" : "hover:bg-bg-soft cursor-pointer"}`}>
                      <input type="checkbox" checked={on} disabled={o.locked} onChange={() => toggle(o.key)} className="accent-primary size-4 shrink-0" />
                      <span className={`min-w-0 flex-1 ${on ? "text-foreground font-medium" : "text-foreground"}`}>{o.label}</span>
                      {o.locked ? <span className="text-text-dim shrink-0 text-xs">발송 금지</span> : o.hint ? <span className="text-text-dim shrink-0 text-xs">{o.hint}</span> : null}
                      {group === "__all" && groups.length > 1 ? <span className="text-text-faint shrink-0 text-xs">{groupLabel(o.group)}</span> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-dim text-sm">{draft.size}개 선택됨</span>
          <Button variant="ghost" className="ml-auto" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={() => {
              onApply(options.filter((o) => draft.has(o.key) && !o.locked).map((o) => o.key));
              onOpenChange(false);
            }}
          >
            적용
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
