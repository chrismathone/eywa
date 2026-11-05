"use client";

// 교재요청 → 학부모 ClassNote 공지 발송(2단계) — 강사가 요청서를 만든 그 자리에서 바로 보낸다.
// 글 1개 = 멘트+교재 내용(텍스트) + 요청서 양식 이미지(학생별, 자동) + 교재 표지(선택, 공통).
// 서버 로직(강사 스코프·보드 판정·동명이인 가드·발송 킬스위치·큐 적재)은 textbook-notice-actions.ts에 있고
// 여기는 화면만. 요청서 이미지는 목록의 '요청서' 다운로드와 **같은 카드**를 캡처해 올린다(_use-form-capture).

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EyIcon } from "@/components/icons/aywa-icons";
import { useSubjectMaps } from "@/features/owner/operations-context";
import type { AccountSetting } from "@/features/owner/settings-types";
import type { NoticeAttachment } from "@/features/onescreen/notice-attachments";
import { cardFileBase } from "@/app/(print)/textbook/[id]/print/download-card";
import { prepareTextbookNotice, sendTextbookNotice } from "@/features/billing/server/textbook-notice-actions";
import type { PreparedTextbookNotice, TextbookNoticeSkip } from "@/features/billing/textbook-notice-types";
import { DEFAULT_TEXTBOOK_MENT } from "@/features/billing/textbook-notice";
import { initialNoticePicks } from "@/features/billing/textbook-notice-subject";
import { useMentDraft } from "@/features/billing/textbook-ment";
import { groupTargets, sendBlockOf, SendSkipList, SendTargetList } from "./_send-targets";
import { MentField, NoticeBanners } from "./_send-fields";
import { CoverPicker, FormCaptureStatus } from "./_send-images";
import { NoticePreview } from "./_send-preview";
import { useFormCapture, type CaptureJob } from "./_use-form-capture";

export function TextbookSendDialog({
  orderIds,
  onClose,
  academyName,
  logoUrl,
  account,
  initialMent,
}: {
  orderIds: string[];
  onClose: () => void;
  /** 요청서 카드 렌더용(목록의 다운로드와 동일 소스) */
  academyName: string;
  logoUrl: string | null;
  account: AccountSetting;
  /** 작성 폼의 '학부모에게 보낼 메시지'를 그대로 이어받는다(비면 저장된 내 멘트 → 기본 문구). */
  initialMent?: string;
}) {
  const subjectMaps = useSubjectMaps();
  const [prep, setPrep] = useState<PreparedTextbookNotice | null>(null); // null = 불러오는 중
  const { ment, edit: editMent, apply: applyMent } = useMentDraft();
  const [pick, setPick] = useState<Record<string, string>>({}); // studentId → 보낼 보드 과목
  const [covers, setCovers] = useState<NoticeAttachment[]>([]); // 전원 공통(교재 표지)
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<TextbookNoticeSkip[] | null>(null);
  const key = orderIds.join(","); // 배열 identity 대신 안정 키로 1회만 로드

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await prepareTextbookNotice(key.split(","));
      if (cancelled) return;
      setPrep(res);
      if (!res.ok) return;
      // 작성 폼에서 방금 쓴 문구가 있으면 그것이 우선(같은 화면에서 쓴 글이 발송창에서 바뀌면 안 된다).
      applyMent(initialMent?.trim() ? initialMent : (res.ment ?? DEFAULT_TEXTBOOK_MENT));
      // 과목 1개=자동 확정, 2개+=이 요청을 낸 선생님이 가르치는 과목(서버 판정). 못 정한 학생은 비워 두고 고르게 한다 —
      // 가나다순 첫 과목으로 채우면 수학 교재가 영어 알림장으로 나간다(2026-10-02 김지우).
      setPick(initialNoticePicks(res.orders ?? []));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyMent는 매 렌더 새 함수(안정 키 key로만 1회 로드)
  }, [key]);

  // 요청서 캡처 대상 — 학생 연결이 있는 요청만(연결 없는 건 애초에 발송 불가). prep 로드 후 1회 확정.
  const jobs = useMemo<CaptureJob[]>(
    () =>
      (prep?.orders ?? [])
        .filter((o) => o.studentId)
        .map((o) => ({
          orderId: o.id,
          studentId: o.studentId!,
          fileName: cardFileBase(o.requestDate, o.studentName, o.bookName),
          data: {
            studentName: o.studentName,
            teacherName: o.teacherName,
            requestDate: o.requestDate,
            bookName: o.bookName,
            bookDetail: o.bookDetail,
            price: o.price,
          },
        })),
    [prep],
  );
  const capture = useFormCapture(jobs);

  const { targets, orphans } = groupTargets(prep?.orders ?? []);
  // 수학 반 보드 경로에서 받을 반 보드가 없는 학생 · 수업 시작 전·휴원(대기) 중인 학생은 대상에서 뺀다 — "N명 발송"이 실제로 나가는 수와 같게.
  const routeBlocked = (studentId: string) => !!sendBlockOf(prep?.mathRoute, prep?.standing, studentId, pick[studentId]);
  const sendable = targets.filter((t) => t.subjects.length > 0 && pick[t.studentId] && !routeBlocked(t.studentId));
  const unpicked = targets.filter((t) => t.subjects.length > 1 && !pick[t.studentId]).length;
  const head = sendable[0] ?? null;
  const attachOff = prep?.showAttachments === false;
  const workerError = prep?.workerError; // 연동 PC가 구버전이면 첨부가 통째로 무시된다 → 아예 막는다
  // 이미지가 준비되기 전엔 보내지 않는다 — 요청서 없이 글자만 나가면 원장이 손으로 올리던 것과 다르다.
  // 알림장을 안 고른 학생이 있으면 보내지 않는다 — 그대로 보내면 그 학생이 조용히 빠진다.
  const canSend = !busy && !!head && unpicked === 0 && capture.ready && !attachOff && !workerError;

  async function send(test: boolean) {
    setBusy(true);
    setSkipped(null);
    const res = await sendTextbookNotice({
      orderIds: key.split(","),
      ment,
      subjectByStudent: pick,
      commonAttachments: covers,
      attachmentsByStudent: capture.byStudent,
      test,
    });
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
          <DialogTitle className="text-base">학부모에게 발송 · 교재 신청 안내</DialogTitle>
        </DialogHeader>

        {prep === null ? (
          <p className="text-text-dim py-6 text-center text-sm">발송 정보를 불러오는 중…</p>
        ) : !prep.ok ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-danger text-sm">{prep.error ?? "발송 정보를 불러오지 못했습니다"}</p>
            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <NoticeBanners
              attachOff={attachOff}
              sendOff={prep.sendEnabled === false}
              workerError={workerError}
            />
            <MentField value={ment} onChange={editMent} />

            <FormCaptureStatus
              capture={capture}
              academyName={academyName}
              logoUrl={logoUrl}
              account={account}
            />
            <CoverPicker covers={covers} onChange={setCovers} disabled={busy || attachOff || !!workerError} />

            <div className="space-y-1.5">
              <span className="text-text-dim block text-xs font-medium">
                받는 학생 <span className="num">{sendable.length}</span>명
              </span>
              <SendTargetList
                targets={targets}
                orphans={orphans}
                pick={pick}
                onPick={(id, v) => setPick((p) => ({ ...p, [id]: v }))}
                labelOf={subjectMaps.labelOf}
                mathRoute={prep.mathRoute}
                standing={prep.standing}
              />
              {unpicked > 0 ? (
                <p className="text-danger text-xs">
                  알림장을 고르지 않은 학생이 <span className="num">{unpicked}</span>명 있습니다 — 어느 과목 알림장으로
                  보낼지 위 목록에서 골라 주세요.
                </p>
              ) : null}
            </div>

            <NoticePreview
              ment={ment}
              target={head}
              account={prep.account}
              imageCount={(head ? (capture.byStudent[head.studentId]?.length ?? 0) : 0) + covers.length}
            />

            {skipped ? <SendSkipList skipped={skipped} /> : null}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-text-faint text-xs">실제 학부모에게 가지 않습니다</span>
              <Button variant="secondary" disabled={!canSend} onClick={() => send(true)}>
                학원이 테스트 발송
              </Button>
              <Button disabled={!canSend} onClick={() => send(false)}>
                <EyIcon name="send" size={16} />
                {busy
                  ? "보내는 중…"
                  : !capture.ready && capture.total > 0 && !capture.error
                    ? "요청서 준비 중…"
                    : `학부모에게 발송 (${sendable.length}명)`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
