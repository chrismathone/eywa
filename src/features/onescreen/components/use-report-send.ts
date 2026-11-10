"use client";

import { useMemo, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { reissueShareLink, revokeShareLink } from "../server/actions";
import { isProgressOptionalReport } from "../jj-books";
import { hasTextBesidesMarkers } from "@/features/report-templates/image-slots";
import { reportOptoutNotice } from "@/features/classes/report-optout";
import { isRowActionable } from "../grid";
import { useClassnoteStatusSync } from "./use-classnote-status-sync";
import { mergeClassnoteStatuses, pendingSendStudentIds, type ClassnoteStatusRow } from "../classnote-status";
import { expectedVideoDue, videoDueTextMismatch } from "@/features/video-homework/due-text-check";
import type { usePrintWindow } from "@/components/workspace/print-window";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent, Subject } from "../types";
import type { SubjectReport } from "./report-card";
import type { SendCore } from "./use-bulk-send";
import type { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/** ClassNote 기능이 꺼진 학원 — 발송 상태 감시 대상 없음(참조 고정이라 감시 훅이 매 렌더 재시작하지 않는다). */
const NO_PENDING: string[] = [];

/**
 * 카드·표 행의 저장/발송 버튼과 공유 링크 — 수정 계획 P3-O 9/10, `onescreen-client.tsx`에서 옮김(동작 그대로).
 *
 * 카드 '저장/PDF'(sendSubject)·카드 ClassNote 발송(queueClassnote)·표 행 발송(sendRow)은 진입 게이트(열람 전용·일괄 중·
 * 빈 멘트·진도·영어 옛 값·영상 마감 글)를 지난 뒤 저장·발송 코어(use-send-core.ts)를 부르고, 결과 코드를 문구로 푼다.
 * 발송 대기·처리 중인 학생이 있는 동안만 ClassNote 결과를 감시해 배지에 반영한다(queueSave 없음 — 서버가 알려준 사실).
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
  // 워커가 백그라운드로 끝낸 ClassNote 발송 결과를 배지에 반영 — 새로고침 없이 '발송 대기' → '발송 완료'.
  // ⚠️ **queueSave를 부르지 않는다**: 내 편집이 아니라 서버가 알려준 사실이라 세션을 다시 쓸 이유가 없다.
  // 병합 규칙(빈 상태 무시·화면에 없는 과목 무시)은 순수함수 mergeClassnoteStatuses 한 곳에.
  function applyClassnoteStatuses(rows: ClassnoteStatusRow[]) {
    setReports((prev) =>
      mergeClassnoteStatuses(prev, rows, (studentId, subjectKey, classId) => {
        const subjects = studentsRef.current.find((s) => s.id === studentId)?.subjects;
        if (!subjects) return undefined;
        // 반 정확매칭 우선(0134a) — 같은 과목 두 행은 과목키가 같아 폴백만으론 엉뚱한 행에 배지가 붙는다.
        if (classId) {
          const byClass = subjects.find((su) => su.classId === classId);
          if (byClass) return byClass.name;
          // 화면에 없는 반(다른 강사·다른 요일)의 보고서 → 어느 행에도 붙이지 않는다.
          return undefined;
        }
        // 반 없는 보고서(관리자 작성·구버전)는 과목으로. 같은 과목 두 행이면 **앞 행**(로스터 정렬 순).
        return subjects.find((su) => (su.subjectKey || su.subjectLabel || su.name) === subjectKey)?.name;
      }),
    );
  }
  // 대기·처리중인 학생이 있는 동안만 감시(없으면 조회 0회, 다 끝나면 저절로 멈춘다).
  const pendingSends = useMemo(() => pendingSendStudentIds(reports), [reports]);
  useClassnoteStatusSync(date, classnoteOn ? pendingSends : NO_PENDING, applyClassnoteStatuses);
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
    if (res.warning) toast.message(res.warning); // 영어 그림 자료를 못 묶었다(서버 문장)
    if (res.status === "recall_pending") {
      toast.error(tf("os.c.recallingSubject", { subject: subjectName }));
      return;
    }
    if (res.status === "revoked") {
      toast.error(tf("os.c.revokedSubject", { subject: subjectName }));
      return;
    }
    if (res.status === "name_conflict") {
      toast.error(
        tf("os.c.nameConflictSubject", { subject: subjectName }),
      );
      return;
    }
    if (res.status === "dry_run") {
      // ClassNote 기능이 없는 학원 = 발송이라는 개념이 없다 → 그냥 "저장됨"(dry-run 문구 금지, 2026-09-30).
      toast.message(classnoteOn ? tf("os.c.dryRunSubject", { subject: subjectName }) : tf("os.c.savedRecord", { subject: subjectName }));
      return;
    }
    // 발송 대상 과목이 아님(원장 설정 classnoteSubjects 밖) — 저장만 되고 큐에 안 들어감. 성공으로 오인 방지.
    if (res.status === "subject_off") {
      toast.message(tf("os.c.subjectOff", { subject: subjectName }));
      return;
    }
    // '수업보고서 미발송' 반 게이트(서버판, 2026-08-19) — 여기서 안 잡으면 아래 폴스루가 "대기 중"
    // 성공 토스트를 띄운다(서버가 방금 거절한 발송을 성공으로 오인).
    if (res.status === "report_optout") {
      toast.message(tf("os.c.optoutSubject", { subject: subjectName, notice: reportOptoutNotice(lang) }));
      return;
    }
    // 결석 게이트(#77 서버판) — 버튼 disabled를 우회한 경로(반 모호 행·stale 화면)도 서버가 막는다.
    if (res.status === "absent") {
      toast.message(tf("os.c.absentSubject", { subject: subjectName }));
      return;
    }
    // 출결 미체크 게이트(서버판, 2026-08-17) — 여기서 안 잡으면 아래 폴스루가 "대기 중" 성공 토스트를
    // 띄운다(서버가 방금 거절한 발송을 성공으로 오인 — 적대 리뷰 확정). 표 sendRow와 동일 안내.
    if (res.status === "no_attendance") {
      toast.message(tf("os.c.uncheckedSubject", { subject: subjectName }));
      return;
    }
    // 이미 게시된 건(중복 게시 차단) — 저장도 안 했으므로 "내용을 고쳤다면 저장부터"를 함께 안내한다.
    if (res.status === "already_sent") {
      toast.message(
        tf("os.c.alreadySentSubject", { subject: subjectName }),
      );
      return;
    }
    const msg =
      res.status === "queued"
        ? res.sendWindowHint
          ? tf("os.c.queuedWindow", { hint: res.sendWindowHint })
          : t("os.c.queuedWaiting")
        : res.status === "success"
          ? t("os.c.statusSuccess")
          : res.status === "processing"
            ? t("os.c.statusProcessing")
            : res.status === "too_old"
              ? t("os.c.statusTooOld")
              : t("os.c.statusWaiting");
    toast.success(tf("os.c.queueResult", { subject: subjectName, msg }));
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
    if (res.warning) toast.message(res.warning); // 영어 그림 자료를 못 묶었다(서버 문장)
    if (res.status === "name_conflict") {
      toast.error(tf("os.c.nameConflictRow", { name: student.name }));
    } else if (res.status === "recall_pending") {
      toast.error(tf("os.c.recallingRow", { name: student.name }));
    } else if (res.status === "revoked") {
      toast.error(tf("os.c.revokedRow", { name: student.name }));
    } else if (res.status === "too_old") {
      toast.message(tf("os.c.tooOldRow", { name: student.name }));
    } else if (res.status === "dry_run") {
      toast.message(classnoteOn ? tf("os.c.dryRunRow", { name: student.name }) : tf("os.c.savedRow", { name: student.name }));
    } else if (res.status === "subject_off") {
      // 발송 대상 과목이 아님 — 저장만 됨. "발송 대기" 성공 오안내 방지(#2 확정).
      toast.message(tf("os.c.subjectOffRow", { name: student.name, subject: subjectName }));
    } else if (res.status === "report_optout") {
      // 미발송 반 게이트(서버판, 2026-08-19) — 화면 게이트를 지난 경로(stale 화면)도 서버가 막는다.
      toast.message(
        tf("os.c.optoutRow", {
          name: student.name,
          subject: subjectName,
          notice: reportOptoutNotice(lang),
        }),
      );
    } else if (res.status === "absent") {
      // 결석 게이트(#77 서버판) — 반 모호(attendanceRaw 미채움) 행 등 클라 게이트 사각을 서버가 막은 경우.
      toast.message(tf("os.c.absentRow", { name: student.name }));
    } else if (res.status === "no_attendance") {
      // 출결 미체크 게이트(서버판, 2026-08-17) — stale 화면 등 클라 게이트 사각을 서버가 막은 경우.
      toast.message(tf("os.c.uncheckedRow", { name: student.name }));
    } else if (res.status === "already_sent") {
      // 중복 게시 차단(서버판) — 화면 게이트를 지난 경로(stale 화면·다른 창에서 먼저 발송)도 서버가 막는다.
      toast.message(tf("os.c.alreadySentRow", { name: student.name, subject: subjectName }));
    } else if (res.status === "queued" && res.sendWindowHint) {
      // 발송 허용 시간창 밖 — 큐엔 정상 적재, 워커가 창 진입 시 자동 발송("왜 안 나가지?" 재발송 혼란 방지).
      toast.success(
        tf("os.c.queuedWindowRow", {
          name: student.name,
          subject: subjectName,
          hint: res.sendWindowHint,
        }),
      );
    } else {
      toast.success(tf("os.c.queuedRow", { name: student.name, subject: subjectName }));
    }
  }

  // 공유링크 취소(revoke) — 학부모 열람 즉시 차단. 대상은 그 과목의 현재 shareToken.
  async function revokeShare(subjectName: string) {
    if (readonlyBlocked()) return;
    if (!selected) return;
    const token = reports[selected.id]?.[subjectName]?.shareToken;
    if (!token) return;
    const student = selected;
    const res = await revokeShareLink(token);
    if (!res.ok) {
      toast.error(res.error ?? t("os.c.revokeFail"));
      return;
    }
    patchReport(student.id, subjectName, (r) => ({ ...r, revoked: true }));
    toast.success(tf("os.c.revoked", { subject: subjectName }));
  }

  // 공유링크 재발급(reissue) — 새 토큰. 옛 링크(카톡/문자/ClassNote 게시)는 즉시 무효화되므로 확인 후 실행.
  async function reissueShare(subjectName: string) {
    if (readonlyBlocked()) return;
    if (!selected) return;
    const token = reports[selected.id]?.[subjectName]?.shareToken;
    if (!token) return;
    if (!window.confirm(t("os.c.reissueConfirm"))) return;
    const student = selected;
    const res = await reissueShareLink(token);
    if (!res.ok || !res.shareToken) {
      toast.error(res.error ?? t("os.c.reissueFail"));
      return;
    }
    // 새 토큰 반영 + 취소·ClassNote 상태 초기화(재발급=미발송으로 되돌림).
    patchReport(student.id, subjectName, (r) => ({
      ...r,
      shareToken: res.shareToken,
      revoked: false,
      classnoteStatus: null, // 명시적 해제(undefined=미확인과 구분 — effectiveClassnoteStatus)
    }));
    toast.success(tf("os.c.reissued", { subject: subjectName }));
  }
  return { sendSubject, queueClassnote, sendRow, revokeShare, reissueShare };
}
