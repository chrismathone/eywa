"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ToolbarButton } from "@/components/toolbar";
import { addBeforeClassTarget, removeBeforeClassTarget } from "../server/target-actions";
import type { ChecklistTarget } from "../types";

/**
 * 반 관리 — 체크리스트를 쓰는 반을 넣고 뺀다(원장 2026-11-03). 버튼은 서버 게이트(`canManageBeforeClassTargets`)를 통과한
 * 계정에게만 선다(페이지가 판정) — 서버 액션도 같은 함수로 다시 본다([[#77]]).
 * 빼기는 한 번 더 눌러 확정한다 · 뺀 반의 체크 기록은 남아 다시 넣으면 돌아온다.
 */
export function TargetManager({ targets, choices }: { targets: ChecklistTarget[]; choices: ChecklistTarget[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [arming, setArming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  const run = async (id: string, act: typeof addBeforeClassTarget, done: string) => {
    setBusy(id);
    // 요청이 아예 실패해도(연결 끊김 등) 버튼이 '처리 중'에 굳지 않게 한다.
    const res = await act(id).catch(() => ({ ok: false as const, error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요" }));
    setBusy(null);
    setArming(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(done);
    startRefresh(() => router.refresh());
  };

  return (
    <>
      <ToolbarButton onClick={() => setOpen(true)}>반 관리</ToolbarButton>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setArming(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>체크리스트 반 관리</DialogTitle>
            <DialogDescription>반을 빼도 그동안의 체크 기록은 지워지지 않습니다. 다시 넣으면 그대로 보입니다.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <p className="micro">반 넣기</p>
            <SearchableSelect
              ariaLabel="넣을 반"
              options={choices.map((c) => ({ value: c.id, label: c.name, hint: c.teacherName || undefined }))}
              value=""
              placeholder={busy && !targets.some((t) => t.id === busy) ? "넣는 중…" : "반을 고르세요"}
              searchPlaceholder="반·담임 검색"
              onValueChange={(id) => { if (id && !busy) void run(id, addBeforeClassTarget, "반을 넣었습니다"); }}
              portal
            />
          </div>
          <div className="space-y-1.5">
            <p className="micro">지금 쓰는 반 {targets.length}개</p>
            {targets.length === 0 ? (
              <p className="text-text-dim text-sm">아직 없습니다.</p>
            ) : (
              <ul className="divide-line-faint border-line divide-y rounded-lg border">
                {targets.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    {t.teacherName ? <span className="text-text-dim shrink-0 text-sm">{t.teacherName}</span> : null}
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => (arming === t.id ? void run(t.id, removeBeforeClassTarget, "반을 뺐습니다") : setArming(t.id))}
                      className={`shrink-0 rounded-lg px-2 py-0.5 text-sm font-medium transition disabled:opacity-50 ${
                        arming === t.id ? "bg-danger text-white" : "text-text-dim hover:text-danger hover:bg-bg-soft"
                      }`}
                    >
                      {busy === t.id ? "빼는 중…" : arming === t.id ? "정말 빼기" : "빼기"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
