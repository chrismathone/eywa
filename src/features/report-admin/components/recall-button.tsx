"use client";

/**
 * 수업보고서 회수 버튼 — **강사 카드(본인 보고서)·관리자 목록(전체) 공용**.
 *
 * 두 화면이 같은 컴포넌트를 쓰는 이유: 경고 문구와 이중확인이 한 곳에만 있어야 한쪽만 약해지지 않는다
 * (#77의 UI판 — 같은 파괴적 동작이 표면마다 다른 관문을 가지면 약한 쪽이 곧 구멍이다).
 *
 * ## 두 가지 의도 (원장 정의 2026-08-06)
 *  - **회수** = 그냥 삭제만 한다(다시 안 보낸다).
 *  - **재발송** = 회수한 뒤 그 보고서를 **미발송으로 되돌려** 수정본을 다시 올릴 수 있게 한다.
 * 🔴 게시글은 **이미지**로 올라가므로 링크만 새로 내는 '재발급'은 학부모 눈에 아무 변화가 없다 —
 *    수정본을 올리려면 **반드시 옛 글을 지운 뒤** 올려야 한다(안 그러면 틀린 글과 맞는 글이 나란히 남는다).
 *
 * ## 이중확인 (원장 지시 2026-08-05 — "바로 회수하지 말고 '회수하겠습니까?'")
 * 1단계 = **무슨 일이 일어나는지** 알리는 경고(되돌릴 수 없음 · 이미 읽었을 수 있음 · 재발송 불가).
 * 2단계 = "정말 회수하겠습니까?" 최종 확인. 한 번의 오클릭으로 학부모 게시글이 사라지지 않게 한다.
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  requestReportRecall,
  requestReportRecallByShareToken,
} from "@/features/report-admin/server/recall-actions";
import { isRecallInFlight, isRecallable, recallBlockReason } from "@/features/report-admin/report-recall";

export function RecallButton({
  reportId,
  studentName,
  classnoteStatus,
  shareToken,
  readAt,
  label,
  size = "sm",
  onDone,
}: {
  /** 관리자 목록 경로. 없으면 shareToken으로 회수(강사 카드는 보고서 id를 모른다). */
  reportId?: string;
  studentName?: string | null;
  classnoteStatus: string | null;
  shareToken: string | null;
  /** 학부모 읽음 시각 — 있으면 "이미 읽었다"를 경고에 명시(양성 신호만, 없음 = 미읽음이 아님). */
  readAt?: string | null;
  label?: string;
  size?: "sm" | "default";
  onDone?: () => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [pending, start] = useTransition();

  const row = { classnoteStatus, shareToken };
  const blocked = recallBlockReason(row);
  const inFlight = isRecallInFlight(classnoteStatus);

  // 회수 요청된 건은 버튼 대신 진행 표시 — 다시 누를 것이 없다는 뜻을 화면에서 읽히게.
  if (inFlight)
    return (
      <span className="text-amber text-xs font-bold" title="연동 PC가 ClassNote 게시글을 순차 삭제합니다">
        회수 처리 중
      </span>
    );
  if (!isRecallable(row)) return null; // 회수할 게 없는 행엔 버튼 자체를 안 만든다(거짓 약속 방지)

  const who = studentName ? `${studentName} 학생의 ` : "";

  function submit() {
    start(async () => {
      const res = reportId
        ? await requestReportRecall([reportId])
        : await requestReportRecallByShareToken(shareToken ?? "");
      setStep(0);
      if (!res.ok) {
        toast.error(res.error ?? "회수하지 못했습니다");
        return;
      }
      toast.success("회수를 요청했습니다 — 연동 PC가 학부모 게시글을 삭제합니다");
      onDone?.();
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size={size}
        disabled={pending || !!blocked}
        title={blocked ?? "학부모 게시판에서 이 보고서 글을 삭제합니다 — 지운 뒤 수정해서 다시 보낼 수 있습니다"}
        onClick={() => setStep(1)}
        className="text-danger"
      >
        {pending ? "요청 중…" : (label ?? "회수")}
      </Button>

      {/* 1단계 — 무슨 일이 일어나는지. */}
      <ConfirmDialog
        open={step === 1}
        danger
        title="보고서를 회수합니다"
        message={
          `${who}학부모 게시판에 올라간 이 보고서 글을 삭제합니다. ` +
          `공유 링크는 즉시 차단되고, 게시글은 연동 PC가 순차적으로 지웁니다. ` +
          (readAt ? "주의: 이 보고서는 학부모가 이미 열람했습니다 — 지워도 본 내용은 되돌릴 수 없습니다. " : "") +
          "삭제가 끝나면 입력이 열립니다 — 고쳐서 'ClassNote 발송'을 누르면 수정본이 다시 올라갑니다."
        }
        confirmLabel="회수 진행"
        cancelLabel="그만두기"
        onConfirm={() => setStep(2)}
        onCancel={() => setStep(0)}
      />

      {/* 2단계 — 최종 확인(원장 지시: 바로 회수 금지). */}
      <ConfirmDialog
        open={step === 2}
        danger
        title="회수하겠습니까?"
        message={`${who}보고서를 학부모 게시판에서 삭제합니다. 이 동작은 되돌릴 수 없습니다.`}
        confirmLabel="회수하겠습니다"
        cancelLabel="취소"
        onConfirm={submit}
        onCancel={() => setStep(0)}
      />
    </>
  );
}
