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
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

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
  // 🔴 사무실(관리자 풀셸)엔 언어 Provider가 없어 항상 한국어다 — 이 배선은 강사 카드에서만 갈린다.
  const lang = useSheetLang();
  const t = useSheetT();
  const tf = useSheetTf();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [pending, start] = useTransition();

  const row = { classnoteStatus, shareToken };
  const blocked = recallBlockReason(row, lang);
  const inFlight = isRecallInFlight(classnoteStatus);

  // 회수 요청된 건은 버튼 대신 진행 표시 — 다시 누를 것이 없다는 뜻을 화면에서 읽히게.
  if (inFlight)
    return (
      <span className="text-amber text-[11px] font-bold" title={t("os.recall.inFlightTitle")}>
        {t("os.recall.inFlight")}
      </span>
    );
  if (!isRecallable(row)) return null; // 회수할 게 없는 행엔 버튼 자체를 안 만든다(거짓 약속 방지)

  const who = studentName ? tf("os.recall.who", { name: studentName }) : "";

  function submit() {
    start(async () => {
      const res = reportId
        ? await requestReportRecall([reportId])
        : await requestReportRecallByShareToken(shareToken ?? "");
      setStep(0);
      if (!res.ok) {
        toast.error(res.error ?? t("os.recall.failed"));
        return;
      }
      toast.success(t("os.recall.done"));
      onDone?.();
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size={size}
        disabled={pending || !!blocked}
        title={blocked ?? t("os.recall.btnTitle")}
        onClick={() => setStep(1)}
        className="text-danger"
      >
        {pending ? t("os.recall.btnBusy") : (label ?? t("os.recall.btn"))}
      </Button>

      {/* 1단계 — 무슨 일이 일어나는지. */}
      <ConfirmDialog
        open={step === 1}
        danger
        title={t("os.recall.step1Title")}
        message={
          tf("os.recall.step1Body", { who }) +
          (readAt ? t("os.recall.step1Read") : "") +
          t("os.recall.step1Tail")
        }
        confirmLabel={t("os.recall.step1Ok")}
        cancelLabel={t("os.recall.step1Cancel")}
        onConfirm={() => setStep(2)}
        onCancel={() => setStep(0)}
      />

      {/* 2단계 — 최종 확인(원장 지시: 바로 회수 금지). */}
      <ConfirmDialog
        open={step === 2}
        danger
        title={t("os.recall.step2Title")}
        message={tf("os.recall.step2Body", { who })}
        confirmLabel={t("os.recall.step2Ok")}
        cancelLabel={t("os.recall.step2Cancel")}
        onConfirm={submit}
        onCancel={() => setStep(0)}
      />
    </>
  );
}
