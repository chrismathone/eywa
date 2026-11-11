"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import {
  issueReportAttachmentUploadTicket,
  registerReportAttachment,
  removeReportAttachment,
  signReportAttachmentUrls,
} from "../server/attachment-actions";
import { saveLessonReport } from "../server/actions";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import { resizeImageForUpload } from "../resize-image";
import { ENGLISH_DRAFT_TEXTAREA_ID, uniqueAttachmentName } from "../attachment-utils";
import { usedAttachmentNames } from "@/features/report-templates/image-slots";
import {
  attachmentLineIndex,
  carryAttachmentLines,
  insertAttachmentLine,
  removeAttachmentLines,
} from "@/features/report-templates/attachment-lines";
import { isProgressOptionalReport } from "../jj-books";
import { isRowActionable, rowKey } from "../grid";
import { READONLY_TEACHER_VIEW_ERROR } from "@/lib/auth/view-as-message";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent, Subject } from "../types";
import type { SubjectReport } from "./report-card";
import { notifyMakeupEffect } from "./makeup-effect-toast";
import type { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

type SaveInput = Parameters<typeof saveLessonReport>[0];
type SaveResult = Awaited<ReturnType<typeof saveLessonReport>>;

/** 이미지 MIME → 저장 경로 확장자(P2b 첨부). 리사이즈로 포맷 보존되니 원본 파일명 ext보다 type이 정확. */
function extFromType(type: string): string | null {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return null;
}

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
  const [attUrls, setAttUrls] = useState<Record<string, string>>({}); // 첨부 path→signed 썸네일 URL(P2b)
  // 첨부 업로드 중인 (학생::과목) 키 — 표는 행마다 첨부할 수 있어 과목명만으론 어느 행인지 못 가린다.
  const [uploadingAttKey, setUploadingAttKey] = useState<string | null>(null);

  // ── 학생 사진 첨부(P2b) — 저장된 보고서에만(서버 강제). subject는 DB 저장키(subjectKey)로 넘긴다. ──
  // ⚠️ 첨부 핸들러는 **(학생, 과목) 파라미터**가 원형이고 카드는 selected를 감싸 부른다(표=행별 직접 호출) —
  //    진도·점수 핸들러와 같은 "로직 단일 소스" 규약. 표 첨부(클립·드롭·일괄)가 이 경로를 그대로 쓴다.
  const subjectKeyFor = (student: OneScreenStudent, subjectName: string): string | undefined => {
    const su = student.subjects.find((s) => s.name === subjectName);
    return su?.subjectKey || su?.subjectLabel || su?.name || undefined;
  };
  // 첨부가 붙을 **행(반)** — 보고서 단위가 반이라(0134a) 과목만 넘기면 정규/특강 중 아무 행에나 붙는다.
  const classIdFor = (student: OneScreenStudent, subjectName: string): string | null =>
    student.subjects.find((s) => s.name === subjectName)?.classId ?? null;

  // 선택 학생 과목별 첨부 path 시그니처 — 경로 변경 시에만 썸네일 URL 재요청(draft 편집엔 재요청 안 함).
  const attTargets = selected
    ? selected.subjects
        .map((su) => ({
          subject: su.subjectKey || su.subjectLabel || su.name || undefined,
          // 반(0134a) — 같은 과목 두 행이면 과목만으론 어느 보고서의 첨부인지 못 가른다.
          classId: su.classId ?? null,
          paths: (reports[selected.id]?.[su.name]?.attachments ?? []).map((a) => a.path),
        }))
        .filter((t) => t.paths.length > 0)
    : [];
  const attSig = attTargets.map((t) => `${t.classId ?? t.subject ?? ""}:${t.paths.join(",")}`).join("|");
  useEffect(() => {
    // attTargets 없으면 재요청 안 함(기존 map은 path 키라 stale해도 오표시 없음 — 신규 서명 시 전체 교체).
    if (!selected || attTargets.length === 0) return;
    let cancelled = false;
    void (async () => {
      const merged: Record<string, string> = {};
      for (const t of attTargets) {
        const res = await signReportAttachmentUrls({
          studentId: selected.id,
          subject: t.subject,
          classId: t.classId,
          reportDate: date || undefined,
        });
        if (res.urls) Object.assign(merged, res.urls);
      }
      if (!cancelled) setAttUrls(merged);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- attSig가 attTargets 내용을 대표(경로 변경 시에만 재요청)
  }, [selected?.id, attSig]);

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
    // 미저장 첨부는 buildSaveInput으로 보고서 행을 먼저 만든다 — 진도 없으면 빈 보고서가 생기므로 게이트(#15).
    const su0 = student.subjects.find((s) => s.name === subjectName);
    if (su0 && !reports[student.id]?.[subjectName]?.sent && !isRowActionable(su0, "save", undefined, { progressOptional: isProgressOptionalReport(su0, reports[student.id]?.[subjectName]) })) {
      if (!opts?.silent) toast.message(t("os.c.attachNeedProgress"));
      return 0;
    }
    // 영어 행 — 첫 첨부는 지금 글로 보고서를 자동 저장한다(저장된 글은 학부모 링크·인쇄에 그대로 보인다). 글이 고치기 전
    // 값을 담고 있으면 발송·저장과 같은 판정으로 묻고, 일괄(조용히)은 그 행을 건너뛴다(요약의 '건너뜀'에 잡힌다).
    if (!reports[student.id]?.[subjectName]?.sent && su0?.subjectKey === "english") {
      if (opts?.silent) {
        if (englishRowFlags(student, su0, reportsRef.current[student.id]?.[subjectName]).outdated) return 0;
      } else if (!confirmEnglishOutput(student, su0, "os.tpl.outdatedSave")) return 0;
    }
    const studentId = student.id;
    const subject = subjectKeyFor(student, subjectName);
    setUploadingAttKey(rowKey(studentId, subjectName));
    let added = 0;
    try {
      // 첨부 먼저 UX — 미저장 상태면 현재 초안으로 자동저장해 보고서 행을 먼저 만든다(첨부는 저장된 행에만).
      // 수동 '저장' 클릭을 없앨 뿐 결과는 "저장 후 첨부"와 동일(진짜 저장된 행).
      if (!reports[studentId]?.[subjectName]?.sent) {
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
  /** 카드(선택 학생) 래퍼 — 표는 addAttachmentsFor를 행별로 직접 부른다. */
  const addAttachments = (subjectName: string, files: File[]) =>
    selected ? addAttachmentsFor(selected, subjectName, files) : Promise.resolve();

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
  const removeAttachment = (subjectName: string, path: string) =>
    selected ? removeAttachmentFor(selected, subjectName, path) : Promise.resolve();

  /** 표 팝오버용 썸네일 서명 — 카드처럼 상시 서명하지 않고 **열 때만** 1회(행 수만큼 서명하면 낭비). */
  async function ensureAttachmentUrls(student: OneScreenStudent, subjectName: string) {
    const atts = reportsRef.current[student.id]?.[subjectName]?.attachments ?? [];
    if (atts.length === 0) return;
    const res = await signReportAttachmentUrls({
      studentId: student.id,
      subject: subjectKeyFor(student, subjectName),
      classId: classIdFor(student, subjectName),
      reportDate: date || undefined,
    });
    if (res.urls) setAttUrls((prev) => ({ ...prev, ...res.urls }));
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
