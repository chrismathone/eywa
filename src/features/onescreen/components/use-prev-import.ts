"use client";

import { useState } from "react";
import { toast } from "sonner";
import { withWriteOrigin } from "../write-timing-store";
import { ATTITUDE } from "../attitude";
import { orderReportRows } from "../report-row-order";
import type { OneScreenStudent } from "../types";
import { CLASS_TAG_ALL } from "../class-tags";
import { isMathReportPilot } from "../math-report-pilot";
import {
  buildGridRows,
  effectiveClassnoteStatus,
  isRowInputEditable,
  planPrevFill,
  planBulkPrevFill,
  planPrevComments,
  rowInClass,
  type PrevCommentPlan,
} from "../grid";
import { resolveRowFields } from "../row-fields";
import type { ReportsState } from "../session-input";
import type { BulkI18n, BulkRowSetters, BulkView, LiveClassnoteStatus } from "./bulk-ops-types";

/**
 * 이전 회차 가져오기(행·일괄)와 멘트 가져오기 확인 — 수정 계획 P3-O(batch C), `use-bulk-ops.ts`에서 나눔(본문 그대로).
 * 멘트는 확인 다이얼로그(`prevCommentPlan`)를 거쳐서만 채운다.
 */
export function usePrevImport({
  view: { visible, activeClassFilter, classTags, displaySettings },
  readonlyView,
  i18n: { t, tf },
  refs: { reportsRef, studentsRef },
  bulk: { bulkBusy, bulkGen },
  makeupPrev: { prevLoaded, loadMakeupPrevAll },
  setters: { setProgressFor, setAttitudeValue, setHomeworkValue, setHomeworkTodayFor, patchReport },
  liveClassnoteStatus,
  readonlyBlocked,
}: {
  view: BulkView;
  readonlyView: boolean;
  i18n: BulkI18n;
  refs: { reportsRef: { readonly current: ReportsState }; studentsRef: { readonly current: OneScreenStudent[] } };
  bulk: { bulkBusy: "save" | "send" | null; bulkGen: boolean };
  makeupPrev: { prevLoaded: ReadonlySet<string>; loadMakeupPrevAll: (ids: string[]) => Promise<void> };
  setters: Pick<BulkRowSetters, "setProgressFor" | "setAttitudeValue" | "setHomeworkValue" | "setHomeworkTodayFor" | "patchReport">;
  liveClassnoteStatus: LiveClassnoteStatus;
  readonlyBlocked: () => boolean;
}) {
  // '이전값 일괄 가져오기' 뒤 멘트 확인 대기 계획(null=다이얼로그 닫힘) — 확인해야만 학부모 문구를 채운다.
  const [prevCommentPlan, setPrevCommentPlan] = useState<PrevCommentPlan[] | null>(null);
  // 이전 회차 가져오기(1-3) — 그 행의 **빈 칸만** 채움(진도·태도·과제·오늘 과제).
  // ⚠️ 특이사항은 채우지 않음 — prevReport.note는 학부모 발송 본문(notes)이라 특이사항이 아니다.
  function importPrevFor(student: OneScreenStudent, subjectName: string) {
    return withWriteOrigin("prev", () => importPrevForInner(student, subjectName));
  }
  function importPrevForInner(student: OneScreenStudent, subjectName: string) {
    if (readonlyBlocked()) return; // 참고행 '가져오기' — LOCK_FS 밖 버튼이라 여기서 끊는다
    const idx = student.subjects.findIndex((su) => su.name === subjectName);
    const su = student.subjects[idx];
    if (!su || bulkGen || bulkBusy || !isRowInputEditable(su, effectiveClassnoteStatus(liveClassnoteStatus(student.id, subjectName), su.classnoteStatus))) return;
    const rowEval = resolveRowFields(student, su);
    const fill = planPrevFill({
      prev: su.prevReport,
      current: {
        today: su.today,
        attitude: rowEval.attitude,
        homework: rowEval.homework,
        homeworkToday: su.homeworkToday ?? "",
      },
      attitudes: ATTITUDE,
    });
    const count = Object.keys(fill).length;
    if (!count) {
      toast.message(t("os.c.prevFillNone"));
      return;
    }
    if (fill.today !== undefined) setProgressFor(student.id, idx, fill.today);
    if (fill.attitude !== undefined) setAttitudeValue(student.id, subjectName, fill.attitude);
    if (fill.homework !== undefined) setHomeworkValue(student.id, subjectName, fill.homework);
    if (fill.homeworkToday !== undefined) setHomeworkTodayFor(student.id, subjectName, fill.homeworkToday);
    toast.success(tf("os.c.prevFillOne", { n: count }));
  }
  // 이전 회차 **일괄** 가져오기(G5 얕은판) — 표시(또는 선택) 전 행에 planPrevFill을 돌려 빈 칸만 채운다.
  // bulkApplyValues 대칭(대상 선정 규약 동일: keys 미선택=표시 전체, rowInClass 필터). 행별 importPrevFor와
  // 같은 순수 계획 함수를 쓰므로 특이사항·교재 제외(발송 본문 오염 방지·roster 자동 승계) 결정이 자동 준수된다.
  // "평소와 같음" 기본값의 얕은 구현 — 강사는 일괄로 깔고 달라진 학생만 손댄다(깊은판 provenance는 G4에서).
  // ⚠️ 멘트(학부모 문구)만 예외로 **확인 다이얼로그**를 거친다 — 나머지 칸은 강사가 오늘 값을 고르는 입력이지만
  // 멘트는 직전에 이미 학부모에게 나간 문장이라, 오늘 진도·점수와 어긋난 채 그대로 발송될 위험이 있다(원장 지시 07-21).
  function bulkImportPrev(keys?: string[]) {
    return withWriteOrigin("prev", () => bulkImportPrevInner(keys));
  }
  function bulkImportPrevInner(keys?: string[]) {
    if (readonlyBlocked() || bulkGen || bulkBusy) return;
    const all = orderReportRows(buildGridRows(visible), displaySettings.options.sort, classTags.filter(tag => tag !== CLASS_TAG_ALL)).filter((r) => rowInClass(r.subject, activeClassFilter));
    const keySet = new Set(keys ?? []);
    const rows = keySet.size ? all.filter((r) => keySet.has(r.key)) : all;
    // 선택된 수업 행별 현재값으로 계획한다. 다른 반·보강 행과 평가값을 공유하지 않는다.
    const plan = planBulkPrevFill(
      rows.flatMap((r) => {
        const subjectIndex = r.student.subjects.findIndex((su) => su.name === r.subject.name);
        const su = r.student.subjects[subjectIndex];
        if (!su) return [];
        return [
          {
            studentId: r.student.id,
            subjectName: r.subject.name,
            subjectIndex,
            prev: su.prevReport,
            current: {
              today: su.today,
              attitude: resolveRowFields(r.student, su).attitude,
              homework: resolveRowFields(r.student, su).homework,
              homeworkToday: su.homeworkToday ?? "",
            },
            // 잠긴 행(발송 완료·결석)은 채우지 않는다(위 일괄 적용과 같은 이유).
            locked:
              readonlyView ||
              !isRowInputEditable(
                su,
                effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), su.classnoteStatus),
              ),
          },
        ];
      }),
      ATTITUDE,
    );
    // 멘트는 별도 계획 — 초안이 빈 행 중 직전 멘트가 있는 것만. 적용은 아래 확인 다이얼로그 뒤에.
    // 🔴 영어 행은 뺀다 — 영어 글은 템플릿이 **지난 회차 진도·점수**까지 담은 전문이라, 가져오면 오늘 기록과 다른 글이
    //    그대로 나간다(적대 재리뷰 2026-09-10). 영어는 자동작성·다시 채우기로 새로 만든다.
    const commentPlan = planPrevComments(
      rows.filter((r) => r.subject.subjectKey !== "english" && isRowInputEditable(r.subject, effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus))).map((r) => ({
        studentId: r.student.id,
        subjectName: r.subject.name,
        prevNote: r.student.subjects.find((su) => su.name === r.subject.name)?.prevReport?.note,
        // ⚠️ 초안은 ref에서 — 진행 중이던 자동작성이 방금 채운 멘트를 클릭 시점 스냅샷이 못 봐 덮어쓰는 것 방지(#10).
        currentDraft: reportsRef.current[r.student.id]?.[r.subject.name]?.draft ?? "",
      })),
    );
    // 보강 학생은 이전 회차를 따로 불러와야 채워진다 — 안 불러온 학생이 대상에 있으면 알리고 그 자리에서 불러오게 한다(원장 2026-10-27).
    const makeupPending = [...new Set(rows.filter((r) => r.student.isMakeup && !prevLoaded.has(r.student.id)).map((r) => r.student.id))];
    if (makeupPending.length) {
      toast.message(tf("os.c.makeupPrevPending", { n: makeupPending.length }), {
        action: { label: t("os.c.makeupPrevLoadNow"), onClick: () => void loadMakeupPrevAll(makeupPending) },
      });
    }
    if (!plan.length && !commentPlan.length) {
      if (!makeupPending.length) toast.message(t("os.c.prevFillNone"));
      return;
    }
    let filledCells = 0;
    for (const p of plan) {
      if (p.set.today !== undefined) setProgressFor(p.studentId, p.subjectIndex, p.set.today);
      // 🔴 일괄 적용은 **보강 행에도** 적용한다(원장 2026-08-13) — "일괄 적용됐는데 보강만 적용 안 된다는건
      //    일괄 적용이 아님". 이후 강사가 행별로 고치는 건 강사 몫이다.
      if (p.set.attitude !== undefined) setAttitudeValue(p.studentId, p.subjectName, p.set.attitude);
      if (p.set.homework !== undefined) setHomeworkValue(p.studentId, p.subjectName, p.set.homework);
      if (p.set.homeworkToday !== undefined) setHomeworkTodayFor(p.studentId, p.subjectName, p.set.homeworkToday);
      filledCells += Object.keys(p.set).length;
    }
    if (plan.length) {
      toast.success(tf("os.c.prevFillMany", { rows: plan.length, cells: filledCells }));
    }
    if (commentPlan.length) setPrevCommentPlan(commentPlan); // → 확인 다이얼로그
  }
  /** 확인 다이얼로그 '멘트도 가져오기' — 계획대로 초안만 채운다(다른 칸은 위에서 이미 처리됨). */
  function applyPrevComments() {
    return withWriteOrigin("prev", () => applyPrevCommentsInner());
  }
  function applyPrevCommentsInner() {
    const plan = prevCommentPlan ?? [];
    setPrevCommentPlan(null);
    if (!plan.length) return;
    // 🔴 복사 삽입도 autoDraft 스냅샷을 함께 남긴다(0214a, 적대 리뷰 확정) — 직전 회차 문구는 AI 유래일 수
    //    있고 아니어도 "지금 직접 쓴" 문장이 아니다. setDraftFor(초안만)로 넣으면 그대로 저장 시 manual로
    //    오표기돼 말투 코퍼스가 오염된다(중복 유입 포함). 스냅샷을 남기면 그대로=auto, 고치면=auto_edited.
    for (const p of plan) {
      const su = studentsRef.current.find(s => s.id === p.studentId)?.subjects.find(s => s.name === p.subjectName);
      if (!su || !isRowInputEditable(su, effectiveClassnoteStatus(liveClassnoteStatus(p.studentId, p.subjectName), su.classnoteStatus))) continue;
      // 수학 보고서 시범 — 지난 글을 옮겨 넣으면 '자동작성 글'로 잡혀 발송 게이트를 지난다. 시범 대상은 자동작성만.
      if (isMathReportPilot(p.studentId, su.subjectKey)) continue;
      // 지난 회차 글은 AI 원문이 아니다(선생님이 직접 쓴 글일 수 있다) — 자동작성 원문(0370a)으로 싣지 않게 표시.
      patchReport(p.studentId, p.subjectName, r => r.draft.trim() ? r : ({ ...r, draft: p.comment, autoDraft: p.comment, autoDraftTemplate: true }));
    }
    toast.success(tf("os.c.prevComments", { n: plan.length }));
  }
  return { prevCommentPlan, setPrevCommentPlan, importPrevFor, bulkImportPrev, applyPrevComments };
}
