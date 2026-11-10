"use client";

import { toast } from "sonner";
import { beginWriteOrigin } from "../write-timing-store";
import { orderReportRows } from "../report-row-order";
import { logOnescreenBulkApply } from "../server/bulk-log-actions";
import { CLASS_TAG_ALL } from "../class-tags";
import { buildGridRows, planBulkApply, rowInClass, type BulkPatch } from "../grid";
import { describeAttendanceSkips, planBulkAttendance, type BulkAttendanceStatus } from "../bulk-attendance";
import { setAttendanceBulk } from "@/features/attendance/server/actions";
import { planBulkVideoCheck } from "@/features/video-homework/bulk-check";
import type { VideoHomeworkStatus } from "@/features/video-homework/types";
import { bulkApplyTargetOf, echoAttendanceUnits } from "../bulk-apply-plan";
import type { useSheetLang } from "@/features/teacher-view/lang-context";
import type { BulkAttendance, BulkI18n, BulkRowSetters, BulkVideo, BulkView, LiveClassnoteStatus } from "./bulk-ops-types";

/**
 * 값 일괄 적용(표 '일괄 입력') — 수정 계획 P3-O(batch C), `use-bulk-ops.ts`에서 나눔(본문 그대로).
 * 값 칸은 행 세터로 **예전 순서대로** 넣고(같은 학생 행을 차례로 patch한다), 출결·지난 영상 숙제 검사는 그 뒤 **즉시 기록**한다.
 */
export function useBulkApply({
  view: { visible, activeClassFilter, classTags, displaySettings },
  ctx: { readonlyView, activeDate, lang },
  i18n: { t, tf },
  video: { videoHwSaveOk, videoHwPolicy, videoHwByOther, videoDueReady, submitLinkMode, videoHwStore },
  attendance: { setAttPending, applyAttendanceLocal },
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
  },
  liveClassnoteStatus,
}: {
  view: BulkView;
  ctx: { readonlyView: boolean; activeDate: string; lang: ReturnType<typeof useSheetLang> };
  i18n: BulkI18n;
  video: BulkVideo;
  attendance: BulkAttendance;
  setters: Omit<BulkRowSetters, "patchReport">;
  liveClassnoteStatus: LiveClassnoteStatus;
}) {
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
    // 행마다 같은 판정 재료 — 대상 한 줄 만들기는 순수 함수(bulk-apply-plan.ts).
    const targetCtx = { videoHwSaveOk, videoHwPolicy, videoHwByOther, videoDueReady, submitLinkMode, readonlyView, liveClassnoteStatus };
    const plan = planBulkApply(
      rows.map((r) => bulkApplyTargetOf(r, targetCtx)),
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
            const echoUnits = echoAttendanceUnits(attendanceUnits);
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
  return { bulkApplyValues };
}
