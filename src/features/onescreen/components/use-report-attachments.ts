"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import type { saveLessonReport } from "../server/actions";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent, Subject } from "../types";
import type { SubjectReport } from "./report-card";
import type { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { useReportAttachmentUrls } from "./use-report-attachment-urls";
import { makeAddAttachmentsFor } from "./report-attachment-upload";
import { useReportAttachmentExtras } from "./use-report-attachment-extras";

type SaveInput = Parameters<typeof saveLessonReport>[0];
type SaveResult = Awaited<ReturnType<typeof saveLessonReport>>;

/**
 * 화면이 넘기는 저장 경로 — 첨부는 **저장된 보고서에만** 붙으므로 안 보낸 행은 먼저 저장한다(카드·표·일괄 공용).
 * 전부 지금 렌더의 화면 함수다(예전 closure 그대로 — 최신 값은 함수들이 ref로 읽는다).
 */
export type AttachmentSaveDeps = {
  readonlyBlocked: () => boolean;
  englishRowFlags: (student: OneScreenStudent, su: Subject, rep: SubjectReport | undefined) => { outdated: boolean };
  confirmEnglishOutput: (
    student: OneScreenStudent,
    su: Subject | undefined,
    key: "os.tpl.outdatedSend" | "os.tpl.outdatedSave" | "os.tpl.outdatedCopy",
  ) => boolean;
  refreshJjBeforeOutput: (student: OneScreenStudent, subjectName: string) => Promise<boolean>;
  buildSaveInputFor: (student: OneScreenStudent, subjectName: string) => { input: SaveInput } | null | undefined;
  latestStudent: (student: OneScreenStudent, subjectName: string) => OneScreenStudent;
  applyKeptVideoHomework: (studentId: string, subjectName: string, res: SaveResult) => void;
  applyVideoHomeworkDue: (studentId: string, subjectName: string, res: SaveResult) => void;
  patchReport: (studentId: string, subjectName: string, fn: (r: SubjectReport) => SubjectReport) => void;
};

/**
 * 보고서 첨부(사진·파일) — 수정 계획 P3-O 4/10, `onescreen-client.tsx`에서 옮김(동작 그대로).
 *
 * 썸네일 서명 URL(`attUrls`)·업로드 중인 행(`uploadingAttKey`)을 들고, 카드·표·일괄 첨부·영어 글 속 첨부·지우기를 낸다.
 * 🔴 요청 순서 그대로 — 파일별·행별 **순차**(register가 read-modify-write라 병렬이면 서로 덮어쓴다). 선택 학생 서명 이펙트의
 *    취소 플래그(`cancelled`)도 그대로다(늦게 온 옛 학생 서명이 새 학생 썸네일을 덮지 않게).
 * batch D: 이 훅은 조립만 하고 공개 이름은 그대로다 — 행 판정 attachment-row.ts · 서명 use-report-attachment-urls.ts ·
 *    올리기 report-attachment-upload.ts · 글 속 넣기·지우기·일괄 use-report-attachment-extras.ts.
 */
export function useReportAttachments({
  selected,
  reports,
  reportsRef,
  studentsRef,
  date,
  readonlyView,
  classnoteOn,
  i18n: { t, tf },
  save: {
    readonlyBlocked,
    englishRowFlags,
    confirmEnglishOutput,
    refreshJjBeforeOutput,
    buildSaveInputFor,
    latestStudent,
    applyKeptVideoHomework,
    applyVideoHomeworkDue,
    patchReport,
  },
  bulk: { bulkBusy, bulkGen, setBulkBusy },
}: {
  selected: OneScreenStudent | null;
  reports: ReportsState;
  reportsRef: { readonly current: ReportsState };
  studentsRef: { readonly current: OneScreenStudent[] };
  /** 조회 대상 날짜(YYYY-MM-DD) — 빈값 = 서버 오늘. 과거 날짜 첨부가 '오늘' 행에 붙지 않게. */
  date: string;
  readonlyView: boolean;
  classnoteOn: boolean;
  i18n: { t: ReturnType<typeof useSheetT>; tf: ReturnType<typeof useSheetTf> };
  save: AttachmentSaveDeps;
  /** 일괄 저장·발송·자동작성과 같은 재진입 잠금(#10). */
  bulk: { bulkBusy: "save" | "send" | null; bulkGen: boolean; setBulkBusy: Dispatch<SetStateAction<"save" | "send" | null>> };
}) {
  // 첨부 업로드 중인 (학생::과목) 키 — 표는 행마다 첨부할 수 있어 과목명만으론 어느 행인지 못 가린다.
  const [uploadingAttKey, setUploadingAttKey] = useState<string | null>(null);
  // 썸네일 서명(use-report-attachment-urls.ts) · 올리기(report-attachment-upload.ts) · 글 속 넣기·지우기·일괄(use-report-attachment-extras.ts)
  // — batch D에서 나눴다(본문 그대로).
  const { attUrls, setAttUrls, ensureAttachmentUrls } = useReportAttachmentUrls({ selected, reports, reportsRef, date });

  // ── 학생 사진 첨부(P2b) — 저장된 보고서에만(서버 강제). subject는 DB 저장키(subjectKey)로 넘긴다. ──
  // ⚠️ 첨부 핸들러는 **(학생, 과목) 파라미터**가 원형이고 카드는 selected를 감싸 부른다(표=행별 직접 호출) —
  //    진도·점수 핸들러와 같은 "로직 단일 소스" 규약. 표 첨부(클립·드롭·일괄)가 이 경로를 그대로 쓴다.
  const addAttachmentsFor = makeAddAttachmentsFor({
    reports,
    reportsRef,
    date,
    readonlyView,
    classnoteOn,
    i18n: { t, tf },
    save: {
      englishRowFlags,
      confirmEnglishOutput,
      refreshJjBeforeOutput,
      buildSaveInputFor,
      latestStudent,
      applyKeptVideoHomework,
      applyVideoHomeworkDue,
      patchReport,
    },
    setUploadingAttKey,
    ensureAttachmentUrls,
  });
  /** 카드(선택 학생) 래퍼 — 표는 addAttachmentsFor를 행별로 직접 부른다. */
  const addAttachments = (subjectName: string, files: File[]) =>
    selected ? addAttachmentsFor(selected, subjectName, files) : Promise.resolve();
  const { insertEnglishMediaFor, removeAttachmentFor, bulkAttach } = useReportAttachmentExtras({
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
  });
  const removeAttachment = (subjectName: string, path: string) =>
    selected ? removeAttachmentFor(selected, subjectName, path) : Promise.resolve();
  return {
    attUrls,
    uploadingAttKey,
    addAttachmentsFor,
    addAttachments,
    insertEnglishMediaFor,
    removeAttachmentFor,
    removeAttachment,
    ensureAttachmentUrls,
    bulkAttach,
  };
}
