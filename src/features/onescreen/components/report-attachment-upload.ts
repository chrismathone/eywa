import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { issueReportAttachmentUploadTicket, registerReportAttachment } from "../server/attachment-actions";
import { saveLessonReport } from "../server/actions";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import { resizeImageForUpload } from "../resize-image";
import { effectiveClassnoteStatus, isAlreadySent, rowKey } from "../grid";
import { READONLY_TEACHER_VIEW_ERROR } from "@/lib/auth/view-as-message";
import { classIdFor, extFromType, subjectKeyFor } from "../attachment-row";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent } from "../types";
import { notifyMakeupEffect } from "./makeup-effect-toast";
import type { AttachmentSaveDeps } from "./use-report-attachments";
import type { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/**
 * 첨부 올리기(카드·표·일괄·영어 글 속 공용) — 수정 계획 P3-O batch D, `use-report-attachments.ts`에서 나눔(본문 그대로).
 * 훅 렌더마다 지금 값으로 함수를 만든다(예전 closure 그대로). 🔴 파일별 **순차**(발급 → 올리기 → 등록 — 병렬화 없음).
 */
export function makeAddAttachmentsFor({
  reportsRef,
  date,
  readonlyView,
  classnoteOn,
  i18n: { t, tf },
  save: {
    refreshJjBeforeOutput,
    buildSaveInputFor,
    latestStudent,
    applyKeptVideoHomework,
    applyVideoHomeworkDue,
    patchReport,
  },
  setUploadingAttKey,
  ensureAttachmentUrls,
}: {
  reports: ReportsState;
  reportsRef: { readonly current: ReportsState };
  /** 조회 대상 날짜(YYYY-MM-DD) — 빈값 = 서버 오늘. 과거 날짜 첨부가 '오늘' 행에 붙지 않게. */
  date: string;
  readonlyView: boolean;
  classnoteOn: boolean;
  i18n: { t: ReturnType<typeof useSheetT>; tf: ReturnType<typeof useSheetTf> };
  save: Omit<AttachmentSaveDeps, "readonlyBlocked">;
  setUploadingAttKey: Dispatch<SetStateAction<string | null>>;
  /** 표 팝오버 썸네일 — 올린 뒤 그 행 서명을 새로 받는다(use-report-attachment-urls.ts). */
  ensureAttachmentUrls: (student: OneScreenStudent, subjectName: string) => Promise<void>;
}) {
  // 파일별 순차 업로드(register read-modify-write clobber 방지). issue→uploadToTicket→register.
  // 카드(selected)·표(행별)·일괄 첨부가 **모두 이 함수 하나**를 쓴다 — 게이트·저장보장·상태리셋이 갈라지지 않게.
  async function addAttachmentsFor(
    student: OneScreenStudent,
    subjectName: string,
    files: File[],
    opts?: { silent?: boolean }, // 일괄 첨부 — 행마다 토스트를 띄우면 10행이면 10개가 쌓인다(요약 1개로)
  ): Promise<number> {
    if (readonlyView) {
      if (!opts?.silent) toast.error(READONLY_TEACHER_VIEW_ERROR); // 일괄(bulkAttach)은 진입부가 이미 알렸다
      return 0;
    }
    // 사진은 진도·평가·멘트보다 먼저 붙일 수 있다. 행/발송 잠금만 확인하고 초안으로 보관한다.
    const su0 = student.subjects.find((s) => s.name === subjectName);
    if (!su0) {
      if (!opts?.silent) toast.error(t("os.c.attachNoInfo"));
      return 0;
    }
    if (su0.splitIn || isAlreadySent(effectiveClassnoteStatus(reportsRef.current[student.id]?.[subjectName]?.classnoteStatus, su0.classnoteStatus))) {
      if (!opts?.silent) toast.message(t(su0.splitIn ? "os.photo.block.split" : "os.row.attachSent"));
      return 0;
    }
    const studentId = student.id;
    const subject = subjectKeyFor(student, subjectName);
    setUploadingAttKey(rowKey(studentId, subjectName));
    let added = 0;
    try {
      // 첨부 먼저 UX — 미저장 상태면 현재 초안으로 자동저장해 보고서 행을 먼저 만든다(첨부는 저장된 행에만).
      // 수동 '저장' 클릭을 없앨 뿐 결과는 "저장 후 첨부"와 동일(진짜 저장된 행).
      if (!reportsRef.current[studentId]?.[subjectName]?.sent) {
        const waited = await refreshJjBeforeOutput(student, subjectName);
        const built = buildSaveInputFor(waited ? latestStudent(student, subjectName) : student, subjectName);
        if (!built) {
          toast.error(t("os.c.attachNoInfo"));
          return 0;
        }
        const saved = await saveLessonReport(built.input);
        applyKeptVideoHomework(studentId, subjectName, saved);
        applyVideoHomeworkDue(studentId, subjectName, saved);
        if (!saved.ok || !saved.id) {
          toast.error(saved.error ?? t("os.c.saveFail"));
          return 0;
        }
        // 영어 그림 자료를 못 묶었으면 여기서도 알린다 — 첨부가 저장을 대신했을 뿐 같은 사실이다(적대 재리뷰).
        // 일괄 첨부(silent)는 행마다 띄우지 않는다(인재원이 멈추면 토스트가 쏟아진다).
        if (saved.warning && !opts?.silent) toast.message(saved.warning);
        notifyMakeupEffect(saved.makeupEffect);
        // 초안은 화면 값 그대로 둔다(위 saveRecord와 같은 이유 — 저장이 멘트를 쓰지 않는다).
        patchReport(studentId, subjectName, (r) => ({
          ...r,
          sent: true,
          shareToken: saved.shareToken ?? r.shareToken,
        }));
      }
      for (const original of files) {
        // 이미지만 업로드 전 클라 다운스케일(문서/오디오는 원본 그대로). 실패 시 원본 반환이라 업로드는 항상 진행.
        const file = original.type.startsWith("image/") ? await resizeImageForUpload(original) : original;
        const ext = extFromType(file.type) ?? file.name.split(".").pop() ?? "jpg";
        const issued = await issueReportAttachmentUploadTicket({
          studentId,
          subject,
          classId: classIdFor(student, subjectName), // 그 반 보고서에만 붙인다(0134a)
          reportDate: date || undefined, // 과거 날짜 첨부가 '오늘' 행에 붙지 않게 대상 날짜 명시(#5 확정)
          contentType: file.type,
          size: file.size,
          ext,
        });
        if (issued.error || !issued.ticket) {
          toast.error(issued.error ?? t("os.c.attachIssueFail"));
          break;
        }
        try {
          await uploadToTicket(issued.ticket, file);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : t("os.c.attachUploadFail"));
          break;
        }
        const reg = await registerReportAttachment({
          studentId,
          subject,
          classId: classIdFor(student, subjectName),
          reportDate: date || undefined,
          path: issued.ticket.path,
          name: original.name,
          size: file.size,
        });
        if (!reg.ok) {
          toast.error(reg.error ?? t("os.c.attachRegisterFail"));
          break;
        }
        added++;
        // 첨부 변경 시 서버가 classnote 상태 리셋 → UI 배지도 클리어(재발송 유도).
        patchReport(studentId, subjectName, (r) => ({
          ...r,
          attachments: reg.attachments ?? r.attachments,
          classnoteStatus: null, // 명시적 해제(undefined=미확인과 구분 — effectiveClassnoteStatus)
        }));
      }
      if (added) {
        if (!opts?.silent) toast.success(tf(classnoteOn ? "os.c.attachDone" : "os.c.attachDoneLink", { n: added }));
        void ensureAttachmentUrls(student, subjectName); // 표 팝오버 썸네일(카드는 아래 서명 이펙트가 갱신)
      }
    } finally {
      setUploadingAttKey(null);
    }
    return added;
  }
  return addAttachmentsFor;
}
