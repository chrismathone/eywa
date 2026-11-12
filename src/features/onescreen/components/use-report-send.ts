"use client";

import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { isProgressOptionalReport } from "../jj-books";
import { hasTextBesidesMarkers } from "@/features/report-templates/image-slots";
import { isRowActionable } from "../grid";
import { expectedVideoDue, videoDueTextMismatch } from "@/features/video-homework/due-text-check";
import type { usePrintWindow } from "@/components/workspace/print-window";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent, Subject } from "../types";
import type { SubjectReport } from "./report-card";
import type { SendCore } from "./use-bulk-send";
import type { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { useReportStatusMerge } from "./use-report-status-merge";
import { useReportShareLinks } from "./use-report-share-links";
import { notifyCardQueueResult, notifyRowQueueResult } from "./report-send-notices";

/**
 * 카드·표 행의 저장/발송 버튼과 공유 링크 — 수정 계획 P3-O 9/10, `onescreen-client.tsx`에서 옮김(동작 그대로).
 *
 * 카드 '저장/PDF'(sendSubject)·카드 ClassNote 발송(queueClassnote)·표 행 발송(sendRow)은 진입 게이트(열람 전용·일괄 중·
 * 빈 멘트·진도·영어 옛 값·영상 마감 글)를 지난 뒤 저장·발송 코어(use-send-core.ts)를 부르고, 결과 코드를 문구로 푼다.
 * 발송 대기·처리 중인 학생이 있는 동안만 ClassNote 결과를 감시해 배지에 반영한다(queueSave 없음 — 서버가 알려준 사실).
 * batch D: 결과 감시 = use-report-status-merge.ts · 공유 링크 = use-report-share-links.ts · 결과 알림 = report-send-notices.ts.
 */
export function useReportSend({
  ctx: { date, activeDate, classnoteOn, lang },
  state: { selected, reports, setReports, studentsRef },
  i18n: { t, tf },
  bulk: { bulkBusy, bulkGen },
  core: { saveRecord, queueOne },
  rows: { patchReport, readonlyBlocked, confirmEnglishOutput },
  openPrint,
}: {
  ctx: { date: string; activeDate: string; classnoteOn: boolean; lang: ReturnType<typeof useSheetLang> };
  state: {
    selected: OneScreenStudent | null;
    reports: ReportsState;
    setReports: Dispatch<SetStateAction<ReportsState>>;
    studentsRef: { readonly current: OneScreenStudent[] };
  };
  i18n: { t: ReturnType<typeof useSheetT>; tf: ReturnType<typeof useSheetTf> };
  bulk: { bulkBusy: "save" | "send" | null; bulkGen: boolean };
  core: SendCore;
  rows: {
    patchReport: (studentId: string, subjectName: string, fn: (r: SubjectReport) => SubjectReport) => void;
    readonlyBlocked: () => boolean;
    confirmEnglishOutput: (
      student: OneScreenStudent,
      su: Subject | undefined,
      key: "os.tpl.outdatedSend" | "os.tpl.outdatedSave" | "os.tpl.outdatedCopy",
    ) => boolean;
  };
  openPrint: ReturnType<typeof usePrintWindow>;
}) {
  // ClassNote 결과 감시(use-report-status-merge.ts) — 이 훅의 첫 훅들이다(batch D에서 나눔 · 순서 그대로).
  useReportStatusMerge({ date, classnoteOn, reports, setReports, studentsRef });
  async function sendSubject(subjectName: string, channel: string) {
    if (readonlyBlocked()) return;
    if (!selected) return;
    if (bulkGen || bulkBusy) {
      toast.message(t("os.c.bulkBusy"));
      return;
    }
    // 진도 미입력 게이트(방어층) — 버튼 disabled 우회·프로그램 호출 대비. 표뷰와 동일 기준(#15 확정).
    const su = selected.subjects.find((s) => s.name === subjectName);
    if (su && !isRowActionable(su, "save", undefined, { progressOptional: isProgressOptionalReport(su, reports[selected.id]?.[subjectName]) })) {
      toast.message(t("os.c.needProgress"));
      return;
    }
    // 영어 행 — AI 인사말·코멘트가 옛 값 기준이면 묻는다(학부모 링크·인쇄는 저장된 글을 그대로 보여 준다).
    if (!confirmEnglishOutput(selected, su, "os.tpl.outdatedSave")) return;
    const res = await saveRecord(selected, subjectName);
    if (!res.ok) {
      toast.error(res.error ?? t("os.c.saveFail"));
      return;
    }
    // 채널은 pdf(인쇄 미리보기 창)·save(기록 저장)뿐. 카톡·문자 자동발송(알림톡)은 후속 —
    // 지금은 저장 후 하단 '학부모 공유 링크' 복사로 수동 전달(별도 버튼 제거).
    if (channel === "pdf" && res.id) {
      openPrint({
        id: `print/lesson_reports/${res.id}`,
        href: `/lesson_reports/${res.id}/print`,
        title: t("os.c.printTitle"),
      });
      toast.success(tf("os.c.savedPreview", { subject: subjectName }));
    } else {
      toast.success(tf("os.c.savedRecord", { subject: subjectName }));
    }
    if (res.warning) toast.message(res.warning); // 영어 그림 자료를 못 묶었다(서버 문장)
  }

  // ClassNote 발송(카드) — 저장 + 큐 적재. 실제 게시는 로컬 워커가 백그라운드로(강사는 대기 안 함).
  async function queueClassnote(subjectName: string) {
    if (readonlyBlocked()) return;
    if (!selected) return;
    if (bulkGen || bulkBusy) {
      toast.message(t("os.c.bulkBusy"));
      return;
    }
    // 영어 행 — AI 코멘트가 고치기 전 값 기준이면 한 번 묻는다(표 행 발송·일괄 확인과 같은 판정, english-draft.ts).
    const suCard = selected.subjects.find((x) => x.name === subjectName);
    if (!confirmEnglishOutput(selected, suCard, "os.tpl.outdatedSend")) return;
    // 🔴 빈 멘트 절대 가드(원장 지시 2026-07-28) — 표 sendRow와 동일. 워커 최종 관문이 무조건 차단하므로
    // 여기서 큐잉해 봐야 "발송 대기" 표시 후 실패로 뒤집히는 혼란만 남는다. 이유를 즉시 말하고 막는다.
    if (!hasTextBesidesMarkers(reports[selected.id]?.[subjectName]?.draft)) {
      toast.error(tf("os.c.emptyMentSubject", { subject: subjectName }));
      return;
    }
    const res = await queueOne(selected, subjectName);
    if (!res.ok) {
      toast.error(res.error ?? t("os.c.queueFail"));
      return;
    }
    notifyCardQueueResult(res, subjectName, { classnoteOn, lang, t, tf });
  }

  // ── 표(그리드) 행별/일괄 — 카드와 같은 코어(queueOne/saveRecord) 재사용. 오늘 진도 있는 행만. ──
  async function sendRow(student: OneScreenStudent, subjectName: string) {
    if (readonlyBlocked()) return;
    if (bulkGen || bulkBusy) {
      toast.message(t("os.c.bulkBusy"));
      return;
    }
    // 🔴 빈 멘트 절대 가드(원장 지시 2026-07-28) — 워커 최종 관문이 무조건 차단하므로(빈 보고서가
    // 학부모에게 노출된 이날 사고) 여기서 보내봐야 실패 예약일 뿐이다. 이유를 즉시 말하고 막는다.
    if (!hasTextBesidesMarkers(reports[student.id]?.[subjectName]?.draft)) {
      toast.error(tf("os.c.emptyMentRow", { name: student.name }));
      return;
    }
    // 영어 행 — AI 코멘트가 고치기 전 값 기준이면 한 번 묻는다(카드 칩·표 칩·일괄 확인과 같은 판정, english-draft.ts).
    const suRow = student.subjects.find((x) => x.name === subjectName);
    if (!confirmEnglishOutput(student, suRow, "os.tpl.outdatedSend")) return;
    // 글에 적힌 영상 숙제 마감이 저장될 마감과 다르면 보내지 않는다(원장 2026-10-28, due-text-check.ts) — 서버도 같은 판정으로 한 번 더(#77).
    if (suRow?.videoHomework === true) {
      const dueGap = videoDueTextMismatch(
        reports[student.id]?.[subjectName]?.draft,
        expectedVideoDue(activeDate, suRow.videoHomeworkDue, suRow.videoHomeworkDueDate),
      );
      if (dueGap) {
        toast.error(tf("os.c.videoDueTextMismatch", { name: student.name, found: dueGap.found, expected: dueGap.expected }));
        return;
      }
    }
    const res = await queueOne(student, subjectName);
    if (!res.ok) {
      toast.error(res.error ?? t("os.c.sendFail"));
      return;
    }
    notifyRowQueueResult(res, student, subjectName, { classnoteOn, lang, t, tf });
  }

  // 공유 링크 취소·재발급(use-report-share-links.ts).
  const { revokeShare, reissueShare } = useReportShareLinks({ selected, reports, i18n: { t, tf }, patchReport, readonlyBlocked });
  return { sendSubject, queueClassnote, sendRow, revokeShare, reissueShare };
}
