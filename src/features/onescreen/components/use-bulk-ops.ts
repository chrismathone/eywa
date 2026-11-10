"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { beginWriteOrigin, withWriteOrigin } from "../write-timing-store";
import { ATTITUDE } from "../attitude";
import { orderReportRows } from "../report-row-order";
import { isProgressOptionalReport } from "../jj-books";
import { logOnescreenBulkApply } from "../server/bulk-log-actions";
import type { OneScreenStudent } from "../types";
import { CLASS_TAG_ALL } from "../class-tags";
import { isMathReportPilot, hasStoredUnderstanding } from "../math-report-pilot";
import type { DailyTestSkip } from "../math-report-pilot-sections";
import {
  buildGridRows,
  effectiveClassnoteStatus,
  isCopyTargetRow,
  isRowInputEditable,
  isRowActionable,
  planBulkApply,
  planPrevFill,
  planBulkPrevFill,
  planPrevComments,
  planCopyFirstRow,
  rowClassName,
  rowInClass,
  type BulkPatch,
  type PrevCommentPlan,
  type RowAction,
} from "../grid";
import { describeAttendanceSkips, planBulkAttendance, type BulkAttendanceStatus } from "../bulk-attendance";
import { setAttendanceBulk } from "@/features/attendance/server/actions";
import { resolveRowFields } from "../row-fields";
import type { DisplayOptions } from "../display-options";
import type { ReportsState } from "../session-input";
import type { SubjectReport } from "./report-card";
import { submitLinkChoosable } from "@/features/video-submit/link-choice";
import { planBulkVideoCheck } from "@/features/video-homework/bulk-check";
import type { VideoHomeworkStatus } from "@/features/video-homework/types";
import { isVideoHomeworkEnabled } from "@/features/video-homework/policy";
import type {
  useSubmitLinkMode,
  useVideoHomeworkOthersReport,
  useVideoHomeworkPolicy,
  useVideoHomeworkStore,
} from "@/features/video-homework/components/video-homework-provider";
import type { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/** 화면의 행 단위 세터 — 일괄 적용·맨 위 행 복사·이전 회차 가져오기가 행마다 부른다(행 편집과 같은 함수 · 순서 그대로). */
export type BulkRowSetters = {
  setAttitudeValue: (studentId: string, subjectName: string, a: string | null) => void;
  setAttitudeNoteFor: (studentId: string, subjectName: string, note: string) => void;
  setHomeworkValue: (studentId: string, subjectName: string, h: string) => void;
  setHomeworkMissReasonFor: (studentId: string, subjectName: string, reason: string) => void;
  setTextbookFor: (studentId: string, subjectName: string, text: string) => void;
  setHomeworkTodayFor: (studentId: string, subjectName: string, text: string) => void;
  setProgressFor: (studentId: string, subjectIndex: number, today: string) => void;
  setProgressModeFor: (studentId: string, subjectIndex: number, mode: string | null) => void;
  setAllUnderstandingFor: (studentId: string, subjectName: string, score: number) => void;
  toggleUnderstandingFor: (studentId: string, subjectName: string, lesson: string, off: boolean) => void;
  setNoteFor: (studentId: string, subjectName: string, text: string) => void;
  setMaxFor: (studentId: string, subjectName: string, which: "daily" | "check", v: number) => void;
  setScoreFor: (studentId: string, subjectName: string, which: "daily" | "check", v: number | null) => void;
  setTestSkipFor: (studentId: string, subjectName: string, skip: DailyTestSkip | null) => void;
  rememberVideoDue: (mode: "week" | "next") => void;
  patch: (id: string, fn: (s: OneScreenStudent) => OneScreenStudent) => void;
  patchReport: (studentId: string, subjectName: string, fn: (r: SubjectReport) => SubjectReport) => void;
};

/**
 * 표 일괄 작업 — 대상 행 고르기(`selectRows`)·값 일괄 적용·맨 위 행 복사·이전 회차 가져오기(행·일괄)·멘트 가져오기 확인.
 * 수정 계획 P3-O 6/10, `onescreen-client.tsx`에서 옮김(동작 그대로). 일괄 저장·발송은 `use-bulk-send.ts`.
 *
 * ⚠️ `bulkBusy` state는 화면에 남는다 — 자동작성(useAutoWrite)·첨부(useReportAttachments)·카드 발송이 같은 잠금을 읽고,
 *    자동작성의 `bulkGen`을 이 훅이 받으므로(재진입 잠금) 이 훅이 소유하면 두 훅이 서로를 먼저 불러야 하는 순환이 생긴다.
 * ⚠️ 행 세터를 부르는 순서는 예전 그대로다 — 같은 학생 행을 차례로 patch하므로 순서를 바꾸면 결과가 달라질 수 있다.
 */
export function useBulkOps({
  view: { visible, activeClassFilter, classTags, displaySettings },
  ctx: { canEditAttendance, readonlyView, activeDate, lang },
  i18n: { t, tf },
  refs: { reportsRef, studentsRef },
  bulk: { bulkBusy, bulkGen },
  video: { videoHwSaveOk, videoHwPolicy, videoHwByOther, videoDueReady, submitLinkMode, videoHwStore },
  attendance: { setAttPending, applyAttendanceLocal },
  makeupPrev: { prevLoaded, loadMakeupPrevAll },
  setters: {
    setAttitudeValue,
    setAttitudeNoteFor,
    setHomeworkValue,
    setHomeworkMissReasonFor,
    setTextbookFor,
    setHomeworkTodayFor,
    setProgressFor,
    setProgressModeFor,
    setAllUnderstandingFor,
    toggleUnderstandingFor,
    setNoteFor,
    setMaxFor,
    setScoreFor,
    setTestSkipFor,
    rememberVideoDue,
    patch,
    patchReport,
  },
  readonlyBlocked,
}: {
  view: {
    visible: OneScreenStudent[];
    activeClassFilter: string | null;
    classTags: readonly string[];
    displaySettings: { options: Pick<DisplayOptions, "sort"> };
  };
  ctx: { canEditAttendance: boolean; readonlyView: boolean; activeDate: string; lang: ReturnType<typeof useSheetLang> };
  i18n: { t: ReturnType<typeof useSheetT>; tf: ReturnType<typeof useSheetTf> };
  refs: { reportsRef: { readonly current: ReportsState }; studentsRef: { readonly current: OneScreenStudent[] } };
  bulk: { bulkBusy: "save" | "send" | null; bulkGen: boolean };
  video: {
    videoHwSaveOk: boolean;
    videoHwPolicy: ReturnType<typeof useVideoHomeworkPolicy>;
    videoHwByOther: ReturnType<typeof useVideoHomeworkOthersReport>;
    videoDueReady: boolean;
    submitLinkMode: ReturnType<typeof useSubmitLinkMode>;
    videoHwStore: ReturnType<typeof useVideoHomeworkStore>;
  };
  attendance: {
    setAttPending: Dispatch<SetStateAction<Set<string>>>;
    applyAttendanceLocal: (
      studentId: string,
      classId: string,
      raw: string | null,
      extra?: { note?: string | null; units?: number | null },
    ) => void;
  };
  makeupPrev: { prevLoaded: ReadonlySet<string>; loadMakeupPrevAll: (ids: string[]) => Promise<void> };
  setters: BulkRowSetters;
  readonlyBlocked: () => boolean;
}) {
  // '이전값 일괄 가져오기' 뒤 멘트 확인 대기 계획(null=다이얼로그 닫힘) — 확인해야만 학부모 문구를 채운다.
  const [prevCommentPlan, setPrevCommentPlan] = useState<PrevCommentPlan[] | null>(null);
  // 이 행의 **최신** ClassNote 상태 — 화면 state(방금 보낸 결과·워커 폴링 반영)가 로스터 스냅샷을 이긴다.
  // ⚠️ 로스터 값만 보면 "방금 보낸 건"을 모른 채 일괄 발송이 그 행을 다시 집는다(중복 게시).
  function liveClassnoteStatus(studentId: string, subjectName: string): string | null | undefined {
    return reportsRef.current[studentId]?.[subjectName]?.classnoteStatus;
  }
  // 표 일괄 작업 대상 — keys(체크된 행) 있으면 그 교집합, 없으면 표시 행 전체. 진도 필수 공통.
  // ⚠️ action별 판정(2-3, isRowActionable): save=결석 포함(기록 보존), send/autowrite=결석 제외(발송·AI 무의미).
  //    send는 **이미 발송된 행도 제외**(중복 게시 차단, 2026-07-22) — 최신 상태를 override로 넘긴다.
  function selectRows(action: RowAction, keys?: string[]) {
    const all = orderReportRows(buildGridRows(visible), displaySettings.options.sort, classTags.filter(tag => tag !== CLASS_TAG_ALL))
      .filter((r) => rowInClass(r.subject, activeClassFilter)) // 특정 반이면 그 반 행만(타 반 혼입 차단)
      .filter((r) =>
        isRowActionable(
          r.subject,
          action,
          effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus),
          {
            attendanceReadOnly: !canEditAttendance, // 출결 쓰기 권한 없음 = 미체크 게이트 해당 없음(P0-3)
            progressOptional: isProgressOptionalReport(r.subject, reportsRef.current[r.student.id]?.[r.subject.name]), // SRS 글은 진도 불필요
          },
        ),
      );
    if (!keys || keys.length === 0) return all;
    const set = new Set(keys);
    return all.filter((r) => set.has(r.key));
  }
  // 값 일괄 적용(1-2) — 선택(없으면 표시 전체) 행에 채워진 필드만 반영. 빈 필드=미적용(지우기 아님).
  // 대상은 진도 필터 없는 raw 행(발송가능 selectRows와 별개 경로) — 값 채우기는 진도와 무관.
  //
  // ⚠️ **출결만 즉시 서버에 쓴다**(2026-07-30). 나머지 칸은 화면 state를 고치고 자동저장 큐에 실리지만
  // 출결의 원장은 출석부(attendance_records)라, 여기서 화면만 바꾸면 출석부와 갈라진다. 그래서 셀 액션이
  // 아니라 **배치 액션 1회**(setAttendanceBulk)로 보낸다 — 30~40행을 셀 단위로 부르면 왕복이 그만큼 늘어
  // 반응속도(1순위)를 깎는다. 게이트(담당 반·수강생·수정 기간)는 그 액션이 집합 단위로 강제한다(#77).
  async function bulkApplyValues(
    keys: string[],
    patchFields: BulkPatch,
    onlyEmpty: boolean,
    progressSubjectKey: string,
    attendance: BulkAttendanceStatus | null = null,
    attendanceUnits = "", // 수업타임(시수) — 새로 만드는 출결 행에만(서버 setAttendanceBulk 규약)
    videoCheck: VideoHomeworkStatus | null = null, // 지난 영상 숙제 검사 — 출결처럼 즉시 기록(검사 칸이 있는 행만)
  ) {
    const all = orderReportRows(buildGridRows(visible), displaySettings.options.sort, classTags.filter(tag => tag !== CLASS_TAG_ALL)).filter((r) => rowInClass(r.subject, activeClassFilter));
    const keySet = new Set(keys);
    const rows = keys.length ? all.filter((r) => keySet.has(r.key)) : all;
    const plan = planBulkApply(
      rows.map((r) => {
        // 2026-10-02 추가 칸의 현재값은 **행 값**(row-fields.ts) — 표가 그리는 값과 같은 층을 본다.
        const rowEval = resolveRowFields(r.student, r.subject);
        return {
        studentId: r.student.id,
        subjectName: r.subject.name,
        subjectIndex: r.subjectIndex,
        subjectKey: r.subject.subjectKey ?? "math",
        today: r.subject.today ?? "",
        progressMode: r.subject.progressMode ?? null,
        // 이해도 단계(원장 2026-10-26) — 새 수학 보고서 행에만 넣는다 · '빈 칸만'은 아직 직접 매긴 점수가 없는 행에만.
        understandingOk: isMathReportPilot(r.student.id, r.subject.subjectKey),
        understandingStored: hasStoredUnderstanding(r.subject.today, r.subject.understanding),
        attitude: rowEval.attitude,
        attitudeNote: r.subject.attitudeNote ?? "",
        attitudeNoteOk: isMathReportPilot(r.student.id, r.subject.subjectKey),
        homeworkMissReason: r.subject.homeworkMissReason ?? "",
        dailyTestSkip: r.subject.dailyTestSkip ?? null,
        homework: rowEval.homework,
        textbook: r.subject.textbook ?? "",
        homeworkToday: r.subject.homeworkToday ?? "",
        note: rowEval.note,
        dailyScore: rowEval.tests.daily.score,
        dailyMax: rowEval.tests.daily.max,
        checkScore: rowEval.tests.check.score,
        checkMax: rowEval.tests.check.max,
        videoHomework: r.subject.videoHomework,
        videoSubmitLink: r.subject.videoSubmitLink,
        videoHomeworkDue: r.subject.videoHomeworkDue,
        // 행의 토글이 그려지는 조건과 같다(VideoHomeworkToggle · VideoSubmitLinkToggle) — 토글 없는 행엔 값을 넣지 않는다.
        // 다른 선생님이 처음 쓴 줄은 토글이 잠겨 있다 — 일괄 적용도 값을 넣지 않는다.
        videoOk:
          videoHwSaveOk && !!videoHwPolicy && !!r.subject.classId && !videoHwByOther(r.student.id, r.subject.classId) &&
          isVideoHomeworkEnabled(videoHwPolicy, { classId: r.subject.classId, subjectKey: r.subject.subjectKey ?? "math", grade: r.student.grade }),
        // 마감 — 행의 마감 토글과 같은 조건(영상 과제 토글이 있는 행 + 마감 칸 준비됨).
        dueOk:
          videoDueReady && videoHwSaveOk && !!videoHwPolicy && !!r.subject.classId && !videoHwByOther(r.student.id, r.subject.classId) &&
          isVideoHomeworkEnabled(videoHwPolicy, { classId: r.subject.classId, subjectKey: r.subject.subjectKey ?? "math", grade: r.student.grade }),
        linkOk:
          videoHwSaveOk && !videoHwByOther(r.student.id, r.subject.classId) &&
          submitLinkChoosable(submitLinkMode, videoHwPolicy, {
            classId: r.subject.classId, subjectKey: r.subject.subjectKey, grade: r.student.grade, studentName: r.student.name }),
        // 잠긴 행(발송 완료·결석)엔 값을 밀어 넣지 않는다 — 넣으면 강사가 **지울 수 없는 값**이 남는다.
        // ⚠️ 행 목록(rows)에서 빼지는 않는다: 아래 출결 일괄 적용이 같은 목록을 쓰는데 거기서 빠지면
        //    잘못 찍은 결석을 일괄로 되돌릴 수 없다(잠금의 유일한 탈출구를 막는 꼴).
        locked:
          readonlyView ||
          !isRowInputEditable(
            r.subject,
            effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus),
          ),
        };
      }),
      patchFields,
      onlyEmpty,
      progressSubjectKey,
    );
    // 값 칸은 먼저 즉시 반영(출결 왕복을 기다리게 하지 않는다). 작성 시간 기록엔 '일괄'로 센다(write-timing-store).
    const endBulkOrigin = beginWriteOrigin("bulk");
    try {
    for (const p of plan) {
      // 🔴 일괄 적용은 **보강 행에도** 적용한다(원장 2026-08-13) — "일괄 적용됐는데 보강만 적용 안 된다는건
      //    일괄 적용이 아님". 이후 강사가 행별로 고치는 건 강사 몫이다.
      if (p.set.attitude !== undefined) setAttitudeValue(p.studentId, p.subjectName, p.set.attitude);
      if (p.set.attitudeNote !== undefined) setAttitudeNoteFor(p.studentId, p.subjectName, p.set.attitudeNote);
      if (p.set.homework !== undefined) setHomeworkValue(p.studentId, p.subjectName, p.set.homework);
      if (p.set.homeworkMissReason !== undefined) setHomeworkMissReasonFor(p.studentId, p.subjectName, p.set.homeworkMissReason);
      if (p.set.textbook !== undefined) setTextbookFor(p.studentId, p.subjectName, p.set.textbook);
      if (p.set.homeworkToday !== undefined) setHomeworkTodayFor(p.studentId, p.subjectName, p.set.homeworkToday);
      if (p.set.today !== undefined) setProgressFor(p.studentId, p.subjectIndex, p.set.today);
      if (p.set.progressMode !== undefined) setProgressModeFor(p.studentId, p.subjectIndex, p.set.progressMode);
      // 이해도 — 진도 **다음에** 넣는다(같은 차례에 바꾼 진도의 소단원에 채워지게, setAllUnderstandingFor는 patch 안의 행 값을 읽는다).
      if (p.set.understanding !== undefined) setAllUnderstandingFor(p.studentId, p.subjectName, p.set.understanding);
      // 뺄 소단원(원장 2026-10-27) — 계획이 그 행 진도에 있는 것만 골라 왔다.
      for (const lesson of p.set.understandingOff ?? []) toggleUnderstandingFor(p.studentId, p.subjectName, lesson, true);
      // 2026-10-02 추가 칸 — 전부 **그 행에만**(행 값). 문항수를 먼저 바꾸고 점수를 넣는다(문항수 변경이 점수를 깎으므로).
      if (p.set.note !== undefined) setNoteFor(p.studentId, p.subjectName, p.set.note);
      if (p.set.dailyMax !== undefined) setMaxFor(p.studentId, p.subjectName, "daily", p.set.dailyMax);
      if (p.set.dailyScore !== undefined) setScoreFor(p.studentId, p.subjectName, "daily", p.set.dailyScore);
      if (p.set.checkMax !== undefined) setMaxFor(p.studentId, p.subjectName, "check", p.set.checkMax);
      if (p.set.checkScore !== undefined) setScoreFor(p.studentId, p.subjectName, "check", p.set.checkScore);
      // 일일 테스트 '안 봄'(원장 2026-10-27) — null이면 '봄'으로(이번에 점수를 넣은 행, grid.ts planBulkApply).
      if (p.set.dailyTestSkip !== undefined) setTestSkipFor(p.studentId, p.subjectName, p.set.dailyTestSkip);
      const { videoHomework: bulkVideoHw, videoSubmitLink: bulkVideoLink, videoHomeworkDue: bulkVideoDue } = p.set;
      if (bulkVideoDue !== undefined) rememberVideoDue(bulkVideoDue);
      if (bulkVideoHw !== undefined || bulkVideoLink !== undefined || bulkVideoDue !== undefined)
        patch(p.studentId, (s) => ({
          ...s,
          subjects: s.subjects.map((su) => (su.name === p.subjectName
            ? { ...su, ...(bulkVideoHw !== undefined ? { videoHomework: bulkVideoHw } : {}), ...(bulkVideoLink !== undefined ? { videoSubmitLink: bulkVideoLink } : {}),
              ...(bulkVideoDue !== undefined ? { videoHomeworkDue: bulkVideoDue } : {}),
              // 일괄로 영상 과제를 끈 행은 마감도 7일로(행 토글과 같은 규칙)
              ...(bulkVideoHw === false && su.videoHomeworkDue ? { videoHomeworkDue: "week" as const, videoHomeworkDueDate: undefined } : {}) }
            : su)),
        }));
    }
    } finally {
      endBulkOrigin();
    }
    const done: string[] = [];
    if (plan.length) {
      done.push(tf("os.c.doneRows", { n: plan.length }));
      // 감사로그 한 줄 — 값 칸만(출결·영상 검사는 그 저장 액션이 따로 남긴다). 글 내용은 안 싣는다.
      const planned = new Set(plan.map((p) => `${p.studentId}::${p.subjectName}`));
      void logOnescreenBulkApply({
        mode: "input",
        date: activeDate,
        rows: plan.length,
        classIds: rows.filter((r) => planned.has(`${r.student.id}::${r.subject.name}`)).map((r) => r.subject.classId),
        fields: [...new Set(plan.flatMap((p) => Object.keys(p.set)))],
      }).catch(() => {});
    }

    if (attendance) {
      // 팝오버가 미리보기에 쓴 것과 **같은 순수 계획**(같은 행·같은 규칙) — 화면 숫자와 실제가 어긋나지 않게.
      const attPlan = planBulkAttendance(
        rows.map((r) => ({
          studentId: r.student.id,
          classId: r.subject.classId,
          isMakeup: r.student.isMakeup,
          raw: r.subject.attendanceRaw,
        })),
        attendance,
        { onlyEmpty },
      );
      const why = describeAttendanceSkips(attPlan, lang);
      if (attPlan.cells.length === 0) {
        done.push(t("os.c.doneAttNone") + (why ? tf("os.c.doneAttSkip", { why }) : ""));
      } else {
        const attKeys = attPlan.cells.map((c) => `${c.studentId}::${c.classId}`);
        setAttPending((p) => {
          const n = new Set(p);
          attKeys.forEach((k) => n.add(k));
          return n;
        });
        try {
          const res = await setAttendanceBulk({
            sessionDate: activeDate,
            status: attendance,
            cells: attPlan.cells,
            // 수업타임(시수) — 결석엔 무의미(팝오버가 이미 안 보냄), 새로 만드는 행에만 적용된다.
            ...(attendanceUnits ? { units: attendanceUnits } : {}),
          });
          if ("error" in res) {
            toast.error(res.error);
          } else {
            // 서버가 실제로 기록한 셀만 화면에 반영 — 게이트에 걸려 빠진 셀을 '됐다'고 칠하지 않는다.
            // 시수는 **새로 만들어진(created) 행에만** 되그린다 — 갱신된 행은 기존 시수가 보존됐으므로
            // 입력값을 칠하면 화면과 DB가 갈린다(setAttendanceFor optimisticUnits와 같은 정규화: 1=null).
            const echoUnits = attendanceUnits
              ? (() => {
                  const n = Number(attendanceUnits.replace(",", "."));
                  return !Number.isFinite(n) || n === 1 ? null : n;
                })()
              : undefined;
            for (const c of res.applied)
              applyAttendanceLocal(
                c.studentId,
                c.classId,
                attendance,
                // 시수를 안 고른 일괄의 새 칸 = 서버가 넣은 수학 자동 시수(없으면 null=1, auto-units.ts).
                c.created ? { units: echoUnits !== undefined ? echoUnits : (c.autoUnits ?? null) } : undefined,
              );
            done.push(
              tf("os.c.doneAtt", { n: res.applied.length }) +
                (res.blocked ? tf("os.c.doneAttBlocked", { n: res.blocked }) : "") +
                (why ? tf("os.c.doneAttWhy", { why }) : ""),
            );
          }
        } catch {
          toast.error(t("os.c.attFail"));
        } finally {
          setAttPending((p) => {
            const n = new Set(p);
            attKeys.forEach((k) => n.delete(k));
            return n;
          });
        }
      }
    }
    // 지난 영상 숙제 검사 — 출결과 같은 성질(화면 state가 아니라 **즉시 기록**). 검사 칸이 보이는 행만(planBulkVideoCheck —
    // 팝오버가 그 줄을 그리는 조건과 같은 함수), 여러 칸을 한 왕복으로. 열람 전용 화면에선 하지 않는다(서버도 거절한다).
    if (videoCheck && videoHwStore && !readonlyView) {
      const targets = planBulkVideoCheck(
        rows.map((r) => ({
          classId: r.subject.classId, studentId: r.student.id, subjectKey: r.subject.subjectKey,
          grade: r.student.grade, homeworkDate: r.subject.prevReport?.date,
        })),
        videoHwStore,
        { status: videoCheck, onlyEmpty },
      );
      if (targets.length) {
        const res = await videoHwStore.changeMany(targets, videoCheck);
        done.push(tf("os.c.doneVideoCheck", { n: res.applied }) + (res.failed ? tf("os.c.doneVideoCheckFail", { n: res.failed }) : ""));
      }
    }
    if (done.length === 0) {
      toast.message(t("os.c.applyNone"));
      return;
    }
    toast.success(tf("os.c.applyDone", { list: done.join(" · ") }));
  }
  /**
   * 맨 위 행의 **수업 내용**(진도·교재·오늘 과제)을 아래 행 전부에 복사.
   * 대상 = 선택 행이 있으면 그 행들, 없으면 표시 전체(반 필터 반영) — 다른 일괄 작업과 같은 규약.
   * ⚠️ 점수·태도·과제 수행·학부모 문구는 **복사하지 않는다**(학생마다 다른 개별 사실 — grid.ts 주석 참조).
   */
  function copyFirstRowDown(keys: string[], overwrite: boolean) {
    return withWriteOrigin("bulk", () => copyFirstRowDownInner(keys, overwrite));
  }
  function copyFirstRowDownInner(keys: string[], overwrite: boolean) {
    if (readonlyBlocked()) return; // #103 세 뒷문 중 하나 — 잠긴 화면에 값을 밀어 넣는 경로
    const all = orderReportRows(buildGridRows(visible), displaySettings.options.sort, classTags.filter(tag => tag !== CLASS_TAG_ALL)).filter((r) => rowInClass(r.subject, activeClassFilter));
    const keySet = new Set(keys);
    const rows = keys.length ? all.filter((r) => keySet.has(r.key)) : all;
    const [first, ...rest] = rows;
    if (!first || rest.length === 0) {
      toast.message(t("os.c.copyNoRow"));
      return;
    }
    // 같은 반 판정의 열쇠 = 반 필터와 같은 반 이름(보강 행은 앵커 반). 반을 고른 보기에선 보이는 행이 전부 그 반이라
    // 모르는 행도 그 반으로 본다(종전과 같다) — '전체' 보기에서만 반이 다르거나 모르는 행을 건너뛴다.
    const classKeyOf = (r: (typeof rows)[number]) => rowClassName(r.subject) ?? activeClassFilter;
    const res = planCopyFirstRow(
      {
        subjectKey: first.subject.subjectKey ?? "math",
        // 같은 반 행에만 복사한다(원장 2026-10-15 — '전체' 보기에서 다른 반 빈 칸까지 채우던 것).
        classKey: classKeyOf(first),
        today: first.subject.today ?? "",
        progressMode: first.subject.progressMode ?? null,
        textbook: first.subject.textbook ?? "",
        homeworkToday: first.subject.homeworkToday ?? "",
      },
      rest.map((r) => ({
        studentId: r.student.id,
        subjectName: r.subject.name,
        subjectIndex: r.subjectIndex,
        subjectKey: r.subject.subjectKey ?? "math",
        classKey: classKeyOf(r),
        today: r.subject.today ?? "",
        progressMode: r.subject.progressMode ?? null,
        textbook: r.subject.textbook ?? "",
        homeworkToday: r.subject.homeworkToday ?? "",
        // 🔴 여기서 `isRowActionable(…,"save")`를 쓰면 안 된다(2026-07-23 원장 제보로 발견).
        //    그 판정은 **진도가 있어야 통과**(isReportEligible)라, 복사가 필요한 바로 그 행
        //    (진도가 빈 행)을 전부 대상에서 빼 버려 기능이 사실상 항상 0건이었다.
        //    게다가 제외 사유를 전부 "발송 완료"로 세어, 보고서가 한 건도 없는 반에서도
        //    "복사할 칸이 없습니다 — 발송 완료 6행"이라는 **거짓 문구**가 떴다.
        //    복사가 실제로 막혀야 하는 유일한 조건은 **이미 학부모에게 나간 행**이다.
        //    (세션 중 방금 보낸 건은 로스터 스냅샷이 모르므로 live 상태를 덮어 읽는다.)
        actionable: isCopyTargetRow(
          r.subject,
          effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus),
        ),
      })),
      { overwrite },
    );
    if (res.plan.length === 0) {
      // 왜 아무 일도 안 일어났는지 말해준다 — "눌렀는데 무반응"이 되지 않게.
      const why = [
        // ⚠️ 이 카운터엔 결석 행(2026-08-07)과 '수업보고서 미발송' 반 행(2026-08-19)도 들어온다 —
        //    사유를 하나로 단정하면 거짓말이 된다. 판정 자체가 `isRowInputEditable`(입력 잠김)이라
        //    **잠김**이 셋 다 참인 유일한 이름이다.
        res.skippedSent ? tf("os.c.copyWhyLocked", { n: res.skippedSent }) : "",
        res.skippedSubject ? tf("os.c.copyWhySubject", { n: res.skippedSubject }) : "",
        res.skippedClass ? tf("os.c.copyWhyClass", { n: res.skippedClass }) : "",
        res.skippedNoClass ? tf("os.c.copyWhyNoClass", { n: res.skippedNoClass }) : "",
        res.skippedFilled ? tf("os.c.copyWhyFilled", { n: res.skippedFilled }) : "",
      ].filter(Boolean);
      toast.message(
        why.length ? tf("os.c.copyNoneWhy", { why: why.join(" · ") }) : t("os.c.copyNeedFirst"),
      );
      return;
    }
    for (const p of res.plan) {
      if (p.set.today !== undefined) setProgressFor(p.studentId, p.subjectIndex, p.set.today);
      // 복습·문제풀이도 진도와 함께(원장 2026-10-27) — 진도 문장이 이 값으로 갈린다.
      if (p.set.progressMode !== undefined) setProgressModeFor(p.studentId, p.subjectIndex, p.set.progressMode);
      if (p.set.textbook !== undefined) setTextbookFor(p.studentId, p.subjectName, p.set.textbook);
      if (p.set.homeworkToday !== undefined) setHomeworkTodayFor(p.studentId, p.subjectName, p.set.homeworkToday);
    }
    // 감사로그 한 줄(칸 저장은 건마다 남기지 않는다 — bulk-log-actions.ts). 글 내용은 안 싣는다.
    void logOnescreenBulkApply({
      mode: "copy",
      date: activeDate,
      rows: res.plan.length,
      // 보강 행은 반 대신 앵커 반(보강을 넣은 수업)으로 적는다.
      classIds: [first, ...rest.filter((r) => res.plan.some((p) => p.studentId === r.student.id && p.subjectName === r.subject.name))]
        .map((r) => r.subject.classId ?? r.subject.makeupClassId ?? null),
      fields: [...new Set(res.plan.flatMap((p) => Object.keys(p.set)))],
    }).catch(() => {});
    const skipped = res.skippedSent + res.skippedSubject + res.skippedClass + res.skippedNoClass + res.skippedFilled;
    toast.success(
      tf("os.c.copyDone", { name: first.student.name, n: res.plan.length }) +
        (skipped
          ? tf("os.c.copySkipped", {
              n: skipped,
              why: [
                res.skippedSent ? tf("os.c.copySkipLocked", { n: res.skippedSent }) : "",
                res.skippedSubject ? tf("os.c.copySkipSubject", { n: res.skippedSubject }) : "",
                res.skippedClass ? tf("os.c.copySkipClass", { n: res.skippedClass }) : "",
                res.skippedNoClass ? tf("os.c.copySkipNoClass", { n: res.skippedNoClass }) : "",
                res.skippedFilled ? tf("os.c.copySkipFilled", { n: res.skippedFilled }) : "",
              ]
                .filter(Boolean)
                .join(", "),
            })
          : ""),
    );
  }
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
  return {
    prevCommentPlan,
    setPrevCommentPlan,
    liveClassnoteStatus,
    selectRows,
    bulkApplyValues,
    copyFirstRowDown,
    importPrevFor,
    bulkImportPrev,
    applyPrevComments,
  };
}
