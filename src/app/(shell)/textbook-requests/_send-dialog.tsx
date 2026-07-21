"use client";

// 교재요청 → 학부모 ClassNote 공지 발송(1단계, 텍스트) — 강사가 요청서를 만든 그 자리에서 바로 보낸다.
// 서버 로직(강사 스코프·보드 판정·동명이인 가드·발송 킬스위치·큐 적재)은 textbook-notice-actions.ts에
// 이미 있고 여기는 화면만. 본문은 발송과 **같은 순수 함수**(composeTextbookNotice)로 미리보기 = 실제 발송글.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EyIcon } from "@/components/icons/eywa-icons";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { composeTextbookNotice, DEFAULT_TEXTBOOK_MENT } from "@/features/billing/textbook-notice";
import {
  prepareTextbookNotice,
  saveMyTextbookMent,
  sendTextbookNotice,
  type PreparedTextbookNotice,
  type TextbookNoticeSkip,
} from "@/features/billing/server/textbook-notice-actions";
import { groupTargets, SendSkipList, SendTargetList } from "./_send-targets";

/** 입력이 멈추고 이 시간이 지나면 멘트를 조용히 저장(저장 버튼 없음 = '중간저장'). */
const MENT_SAVE_DELAY = 1500;

export function TextbookSendDialog({ orderIds, onClose }: { orderIds: string[]; onClose: () => void }) {
  const subjectMaps = useSubjectMaps();
  const [prep, setPrep] = useState<PreparedTextbookNotice | null>(null); // null = 불러오는 중
  const [ment, setMent] = useState(DEFAULT_TEXTBOOK_MENT);
  const [pick, setPick] = useState<Record<string, string>>({}); // studentId → 보낼 보드 과목
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<TextbookNoticeSkip[] | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMent = useRef<string | null>(null); // 아직 저장 안 된 마지막 입력(닫을 때 flush)
  const key = orderIds.join(","); // 배열 identity 대신 안정 키로 1회만 로드

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await prepareTextbookNotice(key.split(","));
      if (cancelled) return;
      setPrep(res);
      if (!res.ok) return;
      setMent(res.ment ?? DEFAULT_TEXTBOOK_MENT);
      // 과목 1개=자동 확정, 2개+=첫 과목 기본 선택(비워두면 서버가 조용히 제외하므로 항상 채운다).
      const init: Record<string, string> = {};
      for (const o of res.orders ?? []) {
        if (o.studentId && o.subjects[0] && !init[o.studentId]) init[o.studentId] = o.subjects[0];
      }
      setPick(init);
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  // 디바운스는 타이머로만(effect 안 동기 setState 금지 #25). 닫기가 1.5초보다 빨라도 마지막 타이핑이
  // 유실되지 않게 언마운트 때 예약분을 즉시 저장(flush)한다.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (pendingMent.current !== null) void saveMyTextbookMent(pendingMent.current);
  }, []);

  const editMent = (v: string) => {
    setMent(v);
    pendingMent.current = v;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      pendingMent.current = null;
      void saveMyTextbookMent(v);
    }, MENT_SAVE_DELAY);
  };

  const { targets, orphans } = groupTargets(prep?.orders ?? []);
  const sendable = targets.filter((t) => t.subjects.length > 0 && pick[t.studentId]);
  const head = sendable[0] ?? null;
  const headOrder = head?.orders[0] ?? null;
  const preview =
    head && headOrder
      ? composeTextbookNotice(ment, {
          studentName: head.name,
          bookName: headOrder.bookName,
          bookDetail: headOrder.bookDetail,
          price: headOrder.price,
          requestDate: headOrder.requestDate,
          account: prep?.account,
        }).full
      : "";

  async function send(test: boolean) {
    setBusy(true);
    setSkipped(null);
    const res = await sendTextbookNotice({ orderIds: key.split(","), ment, subjectByStudent: pick, test });
    setBusy(false);
    setSkipped(res.skipped?.length ? res.skipped : null);
    if (!res.ok) {
      toast.error(res.error ?? "발송에 실패했습니다");
      return;
    }
    if (res.dryRun) {
      // 성공이 아니다 — 킬스위치가 꺼둬서 아무것도 안 나갔다는 사실을 그대로 알린다.
      toast.warning("학원설정에서 발송이 꺼져 있어 보내지 않았습니다");
      return;
    }
    if (test) {
      toast.success("테스트 발송했습니다 — 테스트 학생(학원이) 알림장에서 확인하세요");
      return;
    }
    toast.success(`${res.queued ?? 0}명에게 발송 요청했습니다 · 잠시 후 알림장에 게시됩니다`);
    if (!res.skipped?.length) onClose(); // 제외된 학생이 있으면 닫지 않고 사유를 보여준다
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-[15px]">학부모에게 발송 · 교재 신청 안내</DialogTitle>
        </DialogHeader>

        {prep === null ? (
          <p className="text-text-dim py-6 text-center text-[13px]">발송 정보를 불러오는 중…</p>
        ) : !prep.ok ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-danger text-[13px]">{prep.error ?? "발송 정보를 불러오지 못했습니다"}</p>
            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {prep.sendEnabled === false ? (
              <p className="border-amber/30 bg-amber-soft text-amber rounded-2xl border px-3 py-2 text-[12px]">
                학원설정에서 &lsquo;ClassNote 실제 발송&rsquo;이 꺼져 있습니다 — 지금 누르면 실제로 보내지 않습니다.
              </p>
            ) : null}

            <div className="space-y-1">
              <span className="text-text-dim block text-[12px] font-medium">학부모께 드릴 말씀</span>
              <textarea
                value={ment}
                onChange={(e) => editMent(e.target.value)}
                rows={4}
                aria-label="학부모께 드릴 말씀"
                className="border-line bg-card focus:border-primary w-full resize-y rounded-lg border p-3 text-[13px] outline-none"
              />
              <p className="text-text-faint text-[11px]">
                {"{학생}·{교재명}·{금액}"}은 학생마다 자동으로 채워집니다 · 입력을 멈추면 자동 저장됩니다.
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="text-text-dim block text-[12px] font-medium">
                받는 학생 <span className="num">{sendable.length}</span>명
              </span>
              <SendTargetList
                targets={targets}
                orphans={orphans}
                pick={pick}
                onPick={(id, v) => setPick((p) => ({ ...p, [id]: v }))}
                labelOf={subjectMaps.labelOf}
              />
            </div>

            <div className="space-y-1">
              <span className="text-text-dim block text-[12px] font-medium">
                {/* 같은 학생의 요청 여러 건은 서버가 한 글로 이어 붙인다 — 미리보기는 첫 건만이라 명시. */}
                미리보기{head ? ` · ${head.name} 기준` : ""}
                {head && head.orders.length > 1 ? ` (요청 ${head.orders.length}건이 한 글로 이어집니다 — 첫 건만 표시)` : ""}
              </span>
              {preview ? (
                <p className="border-line bg-bg-soft/60 text-foreground rounded-2xl border p-3 text-[13px] whitespace-pre-wrap">
                  {preview}
                </p>
              ) : (
                <p className="text-text-faint border-line rounded-2xl border border-dashed p-3 text-[12px]">
                  보낼 수 있는 학생이 없습니다.
                </p>
              )}
            </div>

            {skipped ? <SendSkipList skipped={skipped} /> : null}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-text-faint text-[11px]">실제 학부모에게 가지 않습니다</span>
              <Button variant="secondary" disabled={busy || !head} onClick={() => send(true)}>
                학원이 테스트 발송
              </Button>
              <Button disabled={busy || !head} onClick={() => send(false)}>
                <EyIcon name="send" size={16} />
                {busy ? "보내는 중…" : `학부모에게 발송 (${sendable.length}명)`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
