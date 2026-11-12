"use client";

import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { removeReportAttachment } from "../server/attachment-actions";
import { ENGLISH_DRAFT_TEXTAREA_ID, uniqueAttachmentName } from "../attachment-utils";
import { usedAttachmentNames } from "@/features/report-templates/image-slots";
import {
  attachmentLineIndex,
  carryAttachmentLines,
  insertAttachmentLine,
  removeAttachmentLines,
} from "@/features/report-templates/attachment-lines";
import { classIdFor, subjectKeyFor } from "../attachment-row";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent } from "../types";
import type { SubjectReport } from "./report-card";
import type { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/**
 * 영어 글 속 첨부 넣기 · 첨부 지우기 · 선택 행 일괄 첨부 — 수정 계획 P3-O batch D, `use-report-attachments.ts`에서 나눔(본문 그대로).
 * 올리기는 모두 같은 함수(addAttachmentsFor — report-attachment-upload.ts)를 지난다. 일괄 첨부도 행마다 **순차**다.
 */
export function useReportAttachmentExtras({
  reportsRef,
  studentsRef,
  date,
  classnoteOn,
  i18n: { t, tf },
  readonlyBlocked,
  patchReport,
  addAttachmentsFor,
  setAttUrls,
  bulk: { bulkBusy, bulkGen, setBulkBusy },
}: {
  reportsRef: { readonly current: ReportsState };
  studentsRef: { readonly current: OneScreenStudent[] };
  /** 조회 대상 날짜(YYYY-MM-DD) — 빈값 = 서버 오늘. */
  date: string;
  classnoteOn: boolean;
  i18n: { t: ReturnType<typeof useSheetT>; tf: ReturnType<typeof useSheetTf> };
  readonlyBlocked: () => boolean;
  patchReport: (studentId: string, subjectName: string, fn: (r: SubjectReport) => SubjectReport) => void;
  addAttachmentsFor: (
    student: OneScreenStudent,
    subjectName: string,
    files: File[],
    opts?: { silent?: boolean },
  ) => Promise<number>;
  setAttUrls: Dispatch<SetStateAction<Record<string, string>>>;
  /** 일괄 저장·발송·자동작성과 같은 재진입 잠금(#10). */
  bulk: { bulkBusy: "save" | "send" | null; bulkGen: boolean; setBulkBusy: Dispatch<SetStateAction<"save" | "send" | null>> };
}) {
  /**
   * 영어 글 속 사진·PDF(2026-09-11, 사용자 선택 "글 속 원하는 자리에") — 올린 뒤 **커서가 있던 줄**에 `[첨부: 이름]` 줄을 넣는다.
   * 이름은 그 보고서 첨부와 겹치지 않게 정한다(자리 줄이 이름으로 첨부를 찾는다 — attachment-utils.ts). 올리기·저장 보장·게이트는
   * 카드·표와 **같은 함수**(addAttachmentsFor)다. 🔴 못 올렸으면 줄을 넣지 않는다(가리킬 파일이 없는 줄).
   * ⚠️ 줄은 글(초안)에 들어간다 — 다른 글 고치기처럼 저장·발송·PDF가 저장할 때 학부모 글에 실린다(그 셋은 늘 먼저 저장한다).
   */
  async function insertEnglishMediaFor(student: OneScreenStudent, subjectName: string, file: File) {
    if (readonlyBlocked()) return;
    // 커서 줄 — 파일을 고르고 자르는 동안에도 글칸은 마지막 커서를 기억한다(초점이 빠져도 selectionStart는 남는다).
    const el = document.getElementById(ENGLISH_DRAFT_TEXTAREA_ID);
    const before = reportsRef.current[student.id]?.[subjectName];
    const draft0 = before?.draft ?? "";
    // 이름은 지금 첨부 **와 글 속 자리 줄** 둘 다와 겹치지 않게 — 다른 화면에서 지운 첨부의 줄이 남아 있으면 새 사진이 그 옛
    // 자리에 서고 새 줄은 무시된다(적대 리뷰 2026-09-11).
    const name = uniqueAttachmentName(file.name, [
      ...(before?.attachments ?? []).map((a) => a.name),
      ...usedAttachmentNames(draft0),
    ]);
    // 자리는 **줄 내용**으로 기억한다(attachment-lines.ts) — 첫 첨부의 자동 저장이 글을 다시 짜거나 올리는 동안 강사가 계속 써도
    // 같은 윗줄 아래에 선다(줄 번호로만 기억하면 머리말과 내용 사이로 갔다 — 적대 리뷰 2026-09-11).
    // 글 칸은 맨 위 '수업 평가' 표를 뗀 본문만 보인다(2026-10-26) — 칸의 커서 위치에 뗀 길이(data-caret-offset)를 더해 전체 글 기준으로.
    const caret = el instanceof HTMLTextAreaElement ? el.selectionStart + (Number(el.dataset.caretOffset) || 0) : null;
    const placed = insertAttachmentLine(draft0, attachmentLineIndex(draft0, caret), name);
    const named = name === file.name ? file : new File([file], name, { type: file.type });
    const added = await addAttachmentsFor(student, subjectName, [named]);
    if (!added) return;
    patchReport(student.id, subjectName, (r) => ({ ...r, draft: carryAttachmentLines(placed, r.draft, { only: name }) }));
  }

  async function removeAttachmentFor(student: OneScreenStudent, subjectName: string, path: string) {
    if (readonlyBlocked()) return;
    const studentId = student.id;
    // 영어 글 속 그 첨부의 자리 줄도 함께 지운다(아래) — 지우기 **전** 이름과 '그 줄이 가리키던 첨부'를 잡아 둔다.
    // 자리 줄은 이름이 같은 **첫** 첨부를 가리킨다(pickInlineAttachments) — 지운 게 그 첨부였을 때만 줄을 지운다
    // (남겨 두면 같은 이름의 다른 첨부를 조용히 가리키게 된다 — 적대 리뷰 2026-09-11).
    const list = reportsRef.current[studentId]?.[subjectName]?.attachments ?? [];
    const removedName = list.find((a) => a.path === path)?.name;
    const pointedHere = !!removedName && list.find((a) => a.name === removedName)?.path === path;
    const englishRow = student.subjects.find((x) => x.name === subjectName)?.subjectKey === "english";
    const res = await removeReportAttachment({
      studentId,
      subject: subjectKeyFor(student, subjectName),
      classId: classIdFor(student, subjectName),
      reportDate: date || undefined,
      path,
    });
    if (!res.ok) {
      toast.error(res.error ?? t("os.c.attachDeleteFail"));
      return;
    }
    const dropLine = englishRow && pointedHere;
    patchReport(studentId, subjectName, (r) => ({
      ...r,
      attachments: res.attachments ?? [],
      classnoteStatus: null, // 명시적 해제(undefined=미확인과 구분 — effectiveClassnoteStatus)
      // 가리킬 파일이 없는 대괄호 줄을 글칸에 남기지 않는다(카드는 어차피 안 그린다).
      ...(dropLine && removedName ? { draft: removeAttachmentLines(r.draft, removedName) } : {}),
    }));
    setAttUrls((prev) => {
      const n = { ...prev };
      delete n[path];
      return n;
    });
    toast.success(t("os.c.attachDeleted"));
  }

  /**
   * 선택 행 일괄 첨부 — 같은 사진/파일(시험지·판서)을 여러 학생 행에 한 번에.
   * 행마다 **순차** 처리(register가 read-modify-write라 병렬이면 서로 덮어쓴다). 게이트·저장보장은 행 단위 동일.
   */
  async function bulkAttach(keys: string[], files: File[]) {
    if (readonlyBlocked()) return;
    if (!files.length) return;
    if (bulkBusy || bulkGen) return; // 재진입·중첩 방지(#10과 같은 규약)
    const targets = keys
      .map((k) => {
        const [studentId, subjectName] = k.split("::");
        const student = studentsRef.current.find((s) => s.id === studentId);
        return student && subjectName ? { student, subjectName } : null;
      })
      .filter((t): t is { student: OneScreenStudent; subjectName: string } => !!t);
    if (!targets.length) return;
    setBulkBusy("save");
    let rows = 0;
    let added = 0;
    try {
      for (const t of targets) {
        const n = await addAttachmentsFor(t.student, t.subjectName, files, { silent: true });
        if (n > 0) {
          rows++;
          added += n;
        }
      }
    } finally {
      setBulkBusy(null);
    }
    // 요약 1개 — 건너뛴 행(진도 미입력·상한 초과)이 있으면 숫자로 드러난다.
    if (rows === 0) toast.message(t("os.c.attachNoRow"));
    else {
      const skipped = targets.length - rows;
      toast.success(
        tf("os.c.attachBulk", { rows, n: added }) +
          (skipped ? tf("os.c.attachBulkSkip", { n: skipped }) : "") +
          (classnoteOn ? t("os.c.attachBulkTail") : ""),
      );
    }
  }
  return { insertEnglishMediaFor, removeAttachmentFor, bulkAttach };
}
