"use client";

import { useState } from "react";
import { notifyMakeupEffect } from "./makeup-effect-toast";
import { queueWriteTiming } from "../write-timing-store";
import type { SendMode, WriteView } from "../write-timing";
import { saveAndQueueClassnote, saveLessonReport } from "../server/actions";
import type { OneScreenStudent, Subject } from "../types";
import { jjDayKey, jjKnownSlots } from "../jj-day";
import { canRecompose, templateImageSlots } from "../english-draft";
import { READONLY_TEACHER_VIEW_ERROR } from "@/lib/auth/view-as-message";
import { cnSyncRequested } from "../classnote-match-live";
import type { SendClassAsk } from "./send-class-dialog";
import type { ReportTemplate } from "@/features/report-templates/defaults";
import type { ReportsState } from "../session-input";
import type { SubjectReport } from "./report-card";
import type { useEnglishJj } from "./use-english-jj";
import type { useLiveClassnoteMatch } from "./use-live-classnote-match";
import type { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import type { BulkVideo } from "./bulk-ops-types";
import { useReportSaveInput } from "./use-report-save-input";
import { useReportSaveEffects } from "./use-report-save-effects";

/**
 * 보고서 저장·발송 코어(카드·표·일괄·첨부 공용) — 수정 계획 P3-O 9/10, `onescreen-client.tsx`에서 옮김(동작 그대로).
 *
 * 저장 입력 조립(buildSaveInputFor — 발송 조건 pilotCheck·영상 과제 값을 서버에 함께 싣는다) → 저장(saveRecord) /
 * 저장+발송 대기(queueOne) → 응답 반영(영상 과제·마감 되돌림·진도 확정·배지). 반 정보 없는 보강 보고서는
 * 보낼 반을 묻는다(sendClassAsk — queueOne이 묻는 쪽이라 여기에 있다).
 * 🔴 최신 초안·학생 값은 **ref**로 읽는다(일괄 루프 중 편집·앞 행 반영 — 클릭 시점 스냅샷이면 유실, #10).
 * batch D: 저장 입력 조립 = use-report-save-input.ts · 응답 반영(진도 확정·영상 과제·마감) = use-report-save-effects.ts.
 */
export function useSendCore({
  ctx: { date, activeDate, readonlyView, showDailyTest, showCheckTest },
  refs: { reportsRef, studentsRef, trendOptOutRef },
  i18n: { t, tf },
  video: { videoHwSaveOk, videoHwPolicy, videoHwByOther, videoDueReady, submitLinkMode, videoHwStore },
  english: { jj, englishTemplatesRef, findTemplate, freshEnglishDraft, rowOutOfClass },
  rows: { patch, patchReport, latestStudent, writeView, boostClassnoteMatch },
}: {
  ctx: { date: string; activeDate: string; readonlyView: boolean; showDailyTest: boolean; showCheckTest: boolean };
  refs: {
    reportsRef: { readonly current: ReportsState };
    studentsRef: { readonly current: OneScreenStudent[] };
    trendOptOutRef: { readonly current: ReadonlySet<string> };
  };
  i18n: { t: ReturnType<typeof useSheetT>; tf: ReturnType<typeof useSheetTf> };
  /** 영상 과제 정책 묶음 — 일괄 적용과 같은 모양(bulk-ops-types.ts). */
  video: BulkVideo;
  english: {
    jj: ReturnType<typeof useEnglishJj>;
    englishTemplatesRef: { readonly current: ReportTemplate[] };
    findTemplate: (templateId: string | undefined, list?: readonly ReportTemplate[]) => ReportTemplate | null;
    freshEnglishDraft: (student: OneScreenStudent, subjectName: string) => { draft: string; autoDraft: string | undefined };
    rowOutOfClass: (student: OneScreenStudent, su: Subject | undefined) => boolean;
  };
  rows: {
    patch: (id: string, fn: (s: OneScreenStudent) => OneScreenStudent) => void;
    patchReport: (studentId: string, subjectName: string, fn: (r: SubjectReport) => SubjectReport) => void;
    latestStudent: (student: OneScreenStudent, subjectName: string) => OneScreenStudent;
    writeView: () => WriteView;
    boostClassnoteMatch: ReturnType<typeof useLiveClassnoteMatch>["boost"];
  };
}) {
  // 반 정보 없는 보강 보고서의 'ClassNote로 보낼 반' 고르기(A안) — 서버가 메인 수업을 못 정했을 때만 뜬다.
  const [sendClassAsk, setSendClassAsk] = useState<SendClassAsk | null>(null);
  const askSendClass = (ask: Omit<SendClassAsk, "resolve">) =>
    new Promise<string | null>((resolve) => setSendClassAsk({ ...ask, resolve }));
  // 저장 입력 조립(use-report-save-input.ts) · 응답 반영(use-report-save-effects.ts) — batch D에서 나눴다(본문 그대로).
  const { buildSaveInputFor } = useReportSaveInput({
    ctx: { date, activeDate, showDailyTest, showCheckTest },
    refs: { reportsRef, trendOptOutRef },
    video: { videoHwSaveOk, videoHwPolicy, videoHwByOther, videoDueReady, submitLinkMode, videoHwStore },
    english: { jj, freshEnglishDraft },
  });
  const { confirmProgressOnSave, applyKeptVideoHomework, applyVideoHomeworkDue } = useReportSaveEffects({
    studentsRef,
    i18n: { t, tf },
    videoHwStore,
    patch,
  });
  /**
   * 저장·발송·글 복사 직전 — 템플릿 글 그대로(다시 짤 글)이고 그 템플릿에 그림 칸이 있으면, 인재원 하루치가 오래됐을 때
   * (JJ_FRESH_MS) 새로 받는다. 수업 전에 받아 둔 '시험 0건'으로 다시 짜여 결과지 줄이 빠진 채 나가지 않게(적대 리뷰 2026-09-11).
   * 서버는 글에 자리 줄이 **있을 때만** 자료를 묶으므로, 줄을 정하는 이 순간의 자료가 곧 발송물을 정한다.
   */
  async function refreshJjBeforeOutput(student: OneScreenStudent, subjectName: string): Promise<boolean> {
    const su = student.subjects.find((x) => x.name === subjectName);
    if (su?.subjectKey !== "english") return false;
    const rep = reportsRef.current[student.id]?.[subjectName];
    const found = findTemplate(rep?.templateId, englishTemplatesRef.current);
    if (!found || !canRecompose(found, rep)) return false;
    const slots = templateImageSlots(found);
    if (!slots.length) return false;
    // 템플릿이 쓰는 그림 칸이 '없음'으로 알려져 있으면 **항상 새로** 받는다 — 내용을 잃는 건 그 방향뿐이다(3분 안에 받아 둔
    // '시험 0건'이어도 방금 본 시험이 있을 수 있다, 적대 재리뷰). 있음·모름은 신선도 규칙(3분, 실패는 1분)대로.
    // 미연결은 '방금 본 시험'이 있을 수 없어 강제하지 않는다(행마다 서버를 한 번 더 부를 이유가 없다, 적대 재리뷰).
    const cached = jj.cacheRef.current[jjDayKey(student.id, activeDate)];
    const known = cached?.status === "ok" ? jjKnownSlots(cached) : null;
    const force = !!known && slots.some((k) => known[k] === false);
    await jj.ensure(student.id, { outOfClass: rowOutOfClass(student, su), force });
    return true;
  }
  // ── 저장·발송 코어(카드·표 공용) — (학생,과목) 저장/큐잉 + reports state 반영. ──
  async function saveRecord(student: OneScreenStudent, subjectName: string, mode: SendMode = "single") {
    // 이중 방어(진입부들이 이미 막지만 새 진입부 대비) — 호출부가 res를 바로 쓰므로 실패 객체로 반환.
    if (readonlyView) return { ok: false, error: READONLY_TEACHER_VIEW_ERROR };
    const waited = await refreshJjBeforeOutput(student, subjectName);
    const built = buildSaveInputFor(waited ? latestStudent(student, subjectName) : student, subjectName);
    const res = await saveLessonReport(built.input);
    if (res.id) queueWriteTiming(res.id, activeDate, student.id, subjectName, { view: writeView(), mode, queued: false });
    applyKeptVideoHomework(student.id, subjectName, res);
    applyVideoHomeworkDue(student.id, subjectName, res);
    if (res.ok) {
      notifyMakeupEffect(res.makeupEffect);
      // shareToken 보존 → report-card가 학부모 공개 링크(/r/[token])를 노출·복사. 기존 첨부·상태는 유지(merge).
      // 🔴 **초안은 건드리지 않는다** — 저장은 화면 값을 DB로 옮기는 일이지 멘트를 새로 쓰는 일이 아니다.
      //    예전엔 `built.draft`를 되써 넣었고, 멘트가 빈 행에선 그게 **템플릿을 몰래 채우는 통로**였다
      //    (buildSaveInputFor 주석 — 4일치 발송분 22%가 강사가 쓴 적 없는 문장이었다).
      patchReport(student.id, subjectName, (r) => ({
        ...r,
        sent: true,
        shareToken: res.shareToken ?? r.shareToken,
      }));
      confirmProgressOnSave(student.id); // 보고서 저장=진도 확정(표 모드엔 확정 버튼이 없어 지표 0 고정되던 문제, #13)
    }
    return res;
  }
  async function queueOne(student: OneScreenStudent, subjectName: string, mode: SendMode = "single") {
    // 이중 방어 — saveRecord와 같은 이유(호출부 계약 유지: 실패 객체 반환).
    if (readonlyView) return { ok: false, error: READONLY_TEACHER_VIEW_ERROR };
    const waited = await refreshJjBeforeOutput(student, subjectName);
    const built = buildSaveInputFor(waited ? latestStudent(student, subjectName) : student, subjectName);
    let res = await saveAndQueueClassnote(built.input);
    // 반별 발송인데 보강 보고서의 보낼 반을 서버가 못 정했다(또는 보강 추가한 반에 반 보드가 없어 다른 반으로 가야 한다 —
    // 경고 한 줄과 함께 묻는다) — 강사가 고르면 그 반으로 다시 보낸다(저장은 이미 끝났다).
    if (res.status === "needs_class" && res.candidates?.length) {
      const picked = await askSendClass({
        studentName: student.name,
        candidates: res.candidates,
        defaultId: res.defaultClassId ?? null,
        makeupClassName: res.makeupClassName ?? null,
      });
      // 🔴 고른 반 = **새 보강 반**(원장 2026-09-30 *"보고서 반 = 출석부 반"*) — 저장이 출석부 칸도 그 반으로 옮기고 그 반으로 보낸다.
      //    '보낼 반'만 따로 적는 길(`classnoteClassId`)은 없앴다 — 보고서 반과 출석부 반이 갈렸다.
      if (picked) {
        const pickedName = res.candidates.find((c) => c.id === picked)?.name ?? null;
        res = await saveAndQueueClassnote({ ...built.input, makeupClassId: picked });
        // 저장이 받아들였을 때만(반을 거절하면 오류 문장만 돌아온다 — id가 없거나 ok=false + 그 문장) 카드의 보강 반을 바꾼다.
        if (res.ok || (res.id && res.status !== undefined)) {
          patch(student.id, (s) => ({
            ...s,
            subjects: s.subjects.map((x) =>
              x.name === subjectName ? { ...x, makeupClassId: picked, makeupClassName: pickedName ?? x.makeupClassName ?? null } : x,
            ),
          }));
        }
      }
    }
    // 작성 시간 기록(write-timing-store) — 저장된 보고서만(발송이 막혀도 저장됐으면 그때까지 쓴 시간이다).
    if (res.id) queueWriteTiming(res.id, activeDate, student.id, subjectName, { view: writeView(), mode, queued: res.ok });
    applyKeptVideoHomework(student.id, subjectName, res);
    applyVideoHomeworkDue(student.id, subjectName, res);
    // 보낼 반 안내는 강사뷰 언어로(서버 문장은 한국어 폴백) — status로 사전 키를 고른다.
    notifyMakeupEffect(res.makeupEffect);
    const sendClassKey =
      res.status === "board_missing"
        ? "os.c.boardMissing"
        : res.status === "board_enrolling"
          ? "os.c.boardEnrolling"
          : res.status === "board_enrolling_auto"
            ? "os.c.boardEnrollingAuto"
            : res.status === "board_class_pending"
              ? "os.c.boardClassPending"
              : res.status === "board_hold_recheck"
              ? "os.c.boardHoldRecheck"
              : res.status === "board_hold"
                ? "os.c.boardHold"
                : res.status === "board_hold_admin"
                ? "os.c.boardHoldAdmin"
                : res.status === "board_left"
                  ? "os.c.boardLeft"
                  : res.status === "no_class"
                    ? "os.c.noSendClass"
                    : res.status === "needs_class"
                      ? "os.c.chooseSendClass"
                      : res.status === "class_check_failed"
                        ? "os.c.sendClassCheckFail"
                        : null;
    // 배정 보류 안내는 사유(연동 PC가 적은 문장)를 끼운다 — 나머지 문장엔 자리가 없어 그대로다.
    if (!res.ok && sendClassKey) res = { ...res, error: tf(sendClassKey, { reason: res.boardHoldReason ?? "" }) };
    // 서버가 그 반 동기화를 요청했다 — 몇 분 동안 C.N 아이콘을 짧은 주기로 다시 본다(배정되면 새로고침 없이 체크로 바뀐다).
    if (cnSyncRequested(res.status)) boostClassnoteMatch();
    if (res.ok) {
      // ⚠️ 응답 status에는 DB 상태가 아닌 **결과 코드**도 섞여 있다(dry_run·subject_off·absent·already_sent).
      //    그중 `already_sent`를 그대로 배지 state에 넣으면 "success가 아니게" 되어 발송 가드가 스스로 풀린다
      //    → 그 행의 **실제** DB 상태인 success로 되돌려 저장한다.
      const badgeStatus = res.status === "already_sent" ? "success" : res.status;
      patchReport(student.id, subjectName, (r) => ({
        ...r,
        sent: true,
        shareToken: res.shareToken ?? r.shareToken,
        classnoteStatus: badgeStatus,
      }));
      confirmProgressOnSave(student.id);
    } else if (res.id) {
      // 저장은 됐는데 **발송만** 막힌 경우(그림 자리뿐인 영어 글 등) — 저장된 상태·공유 링크는 반영한다(적대 재리뷰).
      patchReport(student.id, subjectName, (r) => ({ ...r, sent: true, shareToken: res.shareToken ?? r.shareToken }));
      confirmProgressOnSave(student.id); // 저장은 됐다 — saveRecord와 같은 규약(보고서 저장 = 진도 확정)
    }
    return res;
  }
  return {
    sendClassAsk,
    setSendClassAsk,
    askSendClass,
    buildSaveInputFor,
    refreshJjBeforeOutput,
    applyKeptVideoHomework,
    applyVideoHomeworkDue,
    saveRecord,
    queueOne,
  };
}
