"use client";

import { useLayoutEffect, useRef, useState, useTransition, type ReactNode, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useUnsavedGuard } from "@/components/workspace/use-unsaved-guard";
import { publishMutation } from "@/lib/realtime/mutation-signal";
import { executeMakeupCommand } from "../server/actions";
import { useCaseDetailReload } from "./case-detail-context";
import { toast } from "sonner";

type Message = { error?: string; saved?: boolean; followUp?: string; readFailed?: boolean };

/**
 * refresh — "server": the action revalidates and Next re-renders this page (lists).
 * "client" (default inside the case detail view, or set by forms that navigate on success): the action returns data
 * only; the detail view reloads its case data or the caller navigates. Then no save waits on a streamed page tree.
 */
export function CommandForm({ action, revision = null, payload, label, onSaved, refresh, children }: {
  action: string; revision?: number | null;
  payload: (data: FormData) => Record<string, unknown>; label: string;
  onSaved?: (result: Record<string, unknown>) => void; refresh?: "server" | "client"; children: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const request = useRef<{ id: string; fingerprint: string } | null>(null);
  // Synchronous lock: set on submit, released only after the enabled commit below (no double submit, no gap).
  const inFlight = useRef(false);
  const settled = useRef<{ saved: boolean } | null>(null);
  const detail = useCaseDetailReload();
  const mode = refresh ?? (detail ? "client" : "server");
  // One group for all makeups forms in this window: saving one form must not clear a sibling's unsaved warning.
  const { markSaved } = useUnsavedGuard({ formRef, group: "makeups" });
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message>({});
  useLayoutEffect(() => {
    // Runs in the commit that enables the fieldset again, before paint: FormData leaves out disabled controls, so the
    // saved baseline is taken here, and the lock is released only after it.
    if (pending || !settled.current) return;
    const { saved } = settled.current;
    settled.current = null;
    if (saved) markSaved();
    inFlight.current = false;
  }, [pending, markSaved]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || inFlight.current) return;
    let value: Record<string, unknown>;
    try { value = payload(new FormData(event.currentTarget)); }
    catch (error) { setMessage({ error: error instanceof Error ? error.message : "입력값을 확인해 주세요" }); return; }
    const fingerprint = JSON.stringify({ action, value, revision });
    if (!request.current || request.current.fingerprint !== fingerprint) request.current = { id: crypto.randomUUID(), fingerprint };
    const commandId = request.current.id;
    inFlight.current = true;
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof executeMakeupCommand>>;
      try {
        result = await executeMakeupCommand({ command_id: commandId, action, payload: value, expected_revision: revision }, { refresh: mode });
      } catch {
        settled.current = { saved: false };
        setMessage({ error: "저장 응답을 받지 못했습니다. 다시 누르면 같은 요청으로 확인합니다." });
        return;
      }
      if (!result.ok) { settled.current = { saved: false }; setMessage({ error: result.error }); return; }
      if (mode === "client") publishMutation();
      const shown = mode === "client" && detail ? await detail.reload() : true;
      // A failed read keeps the command id: pressing again with the same fields replays the saved command, no new write.
      if (shown) request.current = null;
      const state = result.result.projection_state;
      const anchorVerification = result.result.anchor_verification;
      const anchorState = anchorVerification && typeof anchorVerification === "object"
        ? (anchorVerification as Record<string, unknown>).state : null;
      const anchorCode = anchorVerification && typeof anchorVerification === "object"
        ? (anchorVerification as Record<string, unknown>).code : null;
      const anchorNotice = anchorState === "pending" && anchorCode === "attendance_missing"
        ? "연결할 반을 저장했습니다. 아직 출결 기록이 없으며, 실제 실시 후 출결·참여 기록을 입력할 수 있습니다."
        : anchorState === "failed" || anchorState === "pending"
        ? "연결할 반은 저장했습니다. 출결·시수 연결 상태에 확인할 항목이 남아 있습니다. 대사·복구에서 확인해 주세요."
        : anchorState === "done" ? "연결할 반과 기존 출결·시수의 연결 상태를 확인했습니다. 출결·시수 값은 자동 변경하지 않았습니다." : undefined;
      // Resolved rows disappear on reload. Keep the observed result visible after this form unmounts.
      if (anchorNotice) toast.message(anchorNotice);
      const notes = [
        state === "failed" ? "출결·시수 반영을 확인하지 못했습니다. 대사·복구에서 다시 확인해 주세요."
          : state === "pending" ? "출결·시수 반영은 대기 중입니다. 연결된 기록을 확인해 주세요." : undefined,
        anchorNotice,
        shown ? undefined : "바뀐 내용을 불러오지 못했습니다. 새로고침해 확인해 주세요.",
      ].filter(Boolean);
      settled.current = { saved: true };
      setMessage({ saved: true, followUp: notes.length ? notes.join(" ") : undefined, readFailed: !shown });
      onSaved?.(result.result); // here, not in an effect: it runs once even if this form leaves the page after the save
    });
  };
  const alert = Boolean(message.error || message.readFailed);
  return (
    <form ref={formRef} onSubmit={submit} className="space-y-3">
      <fieldset disabled={pending} className="min-w-0 space-y-3 border-0 p-0">{children}</fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "처리 중…" : label}</Button>
        <p aria-live="polite" role={alert ? "alert" : "status"} className={alert ? "text-danger text-sm" : "text-sm"}>
          {message.error ?? (message.saved ? `저장했습니다${message.followUp ? ` · ${message.followUp}` : ""}` : "")}
        </p>
      </div>
    </form>
  );
}
