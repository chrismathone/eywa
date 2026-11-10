"use client";

import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import type { SendMode } from "../write-timing";
import type { saveAndQueueClassnote, saveLessonReport } from "../server/actions";
import { orderReportRows } from "../report-row-order";
import { isProgressOptionalReport } from "../jj-books";
import { isBoardBlockedStatus, isBoardWaitStatus } from "../send-class";
import { CLASS_TAG_ALL } from "../class-tags";
import { isPilotGateError } from "../math-report-pilot";
import { needsMakeupCheck } from "../reserved-makeup";
import { MAKEUP_CHECK_REQUIRED_ERROR } from "@/features/attendance/makeup-check-error";
import { pilotSendBlocks } from "../pilot-send-gate";
import { hasTextBesidesMarkers } from "@/features/report-templates/image-slots";
import {
  buildGridRows,
  effectiveClassnoteStatus,
  isAlreadySent,
  isAttendanceUnchecked,
  isRowActionable,
  isReportEligible,
  rowInClass,
  summarizeSendGaps,
  type GridRow,
  type RowAction,
} from "../grid";
import type { DisplayOptions } from "../display-options";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent, Subject } from "../types";
import type { SubjectReport } from "./report-card";
import type { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/** 저장·발송 코어(카드·표 공용) — 화면의 같은 함수를 넘긴다(열람 전용이면 `{ ok: false, error }`를 돌려준다). */
export type SendCore = {
  saveRecord: (
    student: OneScreenStudent,
    subjectName: string,
    mode?: SendMode,
  ) => Promise<Awaited<ReturnType<typeof saveLessonReport>>>;
  queueOne: (
    student: OneScreenStudent,
    subjectName: string,
    mode?: SendMode,
  ) => Promise<Awaited<ReturnType<typeof saveAndQueueClassnote>>>;
};

/**
 * 표 일괄 저장·일괄 발송 — 수정 계획 P3-O 6/10, `onescreen-client.tsx`에서 옮김(동작 그대로).
 * 대상은 `selectRows`(use-bulk-ops.ts)와 같은 판정이고, 행마다 저장·발송 코어를 **순차**로 부른다(병렬화 없음).
 * 루프 중엔 `latestRow`로 그 행의 최신 학생 값을 읽는다(#10 — 클릭 시점 스냅샷으로 되돌리지 않게).
 */
export function useBulkSend({
  view: { visible, activeClassFilter, classTags, displaySettings },
  ctx: { canEditAttendance, classnoteOn, showDailyTest, showCheckTest, sentRowCount },
  i18n: { t, tf },
  state: { reports, reportsRef },
  bulk: { bulkBusy, bulkGen, setBulkBusy },
  rows: { selectRows, liveClassnoteStatus, latestRow },
  english: { englishTemplateNotReady, outdatedEnglishRows },
  core: { saveRecord, queueOne },
  readonlyBlocked,
}: {
  view: {
    visible: OneScreenStudent[];
    activeClassFilter: string | null;
    classTags: readonly string[];
    displaySettings: { options: Pick<DisplayOptions, "sort"> };
  };
  ctx: { canEditAttendance: boolean; classnoteOn: boolean; showDailyTest: boolean; showCheckTest: boolean; sentRowCount: number };
  i18n: { t: ReturnType<typeof useSheetT>; tf: ReturnType<typeof useSheetTf> };
  state: { reports: ReportsState; reportsRef: { readonly current: ReportsState } };
  bulk: {
    bulkBusy: "save" | "send" | null;
    bulkGen: boolean;
    setBulkBusy: Dispatch<SetStateAction<"save" | "send" | null>>;
  };
  rows: {
    selectRows: (action: RowAction, keys?: string[]) => GridRow[];
    liveClassnoteStatus: (studentId: string, subjectName: string) => string | null | undefined;
    latestRow: (studentId: string, subjectName: string) => OneScreenStudent | null;
  };
  english: {
    englishTemplateNotReady: (rep: SubjectReport | undefined) => boolean;
    outdatedEnglishRows: <T extends { student: OneScreenStudent; subject: Subject }>(rows: readonly T[]) => T[];
  };
  core: SendCore;
  readonlyBlocked: () => boolean;
}) {
  async function saveAllVisible(keys?: string[]) {
    if (readonlyBlocked()) return;
    if (bulkBusy || bulkGen) return; // 재진입·중첩 방지(#10)
    const rows = selectRows("save", keys);
    const skipped = keys?.length ? keys.length - rows.length : 0; // 미선택=전체=0(음수 방지 #11)
    if (rows.length === 0) {
      // 발송 완료건은 수정 금지라 저장 대상에서도 빠진다 — "왜 아무것도 저장이 안 되지"의 답을 준다.
      toast.message(
        sentRowCount
          ? tf("os.c.saveNoneSent", { n: sentRowCount })
          : t("os.c.saveNone"),
      );
      return;
    }
    // 영어 행 중 AI 인사말·코멘트가 옛 값 기준인 행 — 저장하면 학부모 링크·인쇄에 그대로 보이니 **누구인지** 적고 묻는다.
    // 영어 행의 템플릿 목록이 아직 오는 중이면 잠깐 미룬다(곧 다시 짤 수 있게 된다 — 지금 '그대로'를 권하지 않는다).
    if (
      rows.some(
        (r) =>
          r.subject.subjectKey === "english" &&
          englishTemplateNotReady(reportsRef.current[r.student.id]?.[r.subject.name]),
      )
    ) {
      toast.message(t("os.tpl.loading"));
      return;
    }
    // 🔴 일괄 확인은 '확인됨'으로 적지 않는다 — 이름이 5명까지만 적히는 창 하나로 이후 행별 복사·발송 확인까지 꺼지면 안 된다.
    const outdatedRows = outdatedEnglishRows(rows);
    const aiStaleNames = [...new Set(outdatedRows.map((r) => r.student.name))];
    if (
      aiStaleNames.length &&
      !window.confirm(
        tf("os.tpl.bulkSaveOutdated", {
          n: aiStaleNames.length,
          names: aiStaleNames.slice(0, 5).join(", "),
          more: aiStaleNames.length > 5 ? tf("os.c.lineMore", { n: aiStaleNames.length - 5 }) : "",
        }),
      )
    )
      return;
    setBulkBusy("save");
    let ok = 0;
    let fail = 0;
    let jjWarn = 0; // 영어 그림 자료를 못 묶은 저장(저장은 성공) — 행마다 토스트를 쌓지 않고 한 줄로 센다
    try {
      for (const r of rows) {
        const student = latestRow(r.student.id, r.subject.name) ?? r.student;
        const res = await saveRecord(student, r.subject.name, "bulk");
        if (res.ok) ok++;
        else fail++;
        if (res.ok && res.warning) jjWarn++;
      }
    } finally {
      setBulkBusy(null);
    }
    toast.success(
      tf("os.c.saveDone", { n: ok }) +
        (fail ? tf("os.c.saveFailN", { n: fail }) : "") +
        (skipped ? tf("os.c.saveSkipped", { n: skipped }) : "") +
        (jjWarn ? tf("os.tpl.jjWarnBulk", { n: jjWarn }) : ""),
    );
  }
  async function sendAllVisible(keys?: string[]) {
    if (readonlyBlocked()) return;
    if (bulkBusy || bulkGen) return; // 재진입·중첩 방지(#10)
    let rows = selectRows("send", keys); // ⚠️ let — 아래 빈 멘트 절대 가드가 대상을 좁힌다

    const preSkipped = keys?.length ? keys.length - rows.length : 0; // 미선택=전체=0(음수 방지 #11)
    // 발송 후보 중 **이미 발송된 행** — 아래 안내에 쓰고, rows에는 이미 빠져 있다.
    // ⚠️ 이 수치는 "일괄 발송을 다시 눌러도 안 나가는 이유"라 반드시 보여준다(무언 제외 = 사고 은폐).
    // ⚠️ `selectRows`로 세면 **항상 0**이 된다 — 발송 완료건은 save 게이트에서도 이미 빠지기 때문
    //    (2026-07-22 '수정도 금지'로 강화된 뒤의 함정). 그래서 게이트 이전의 원본 행에서 센다.
    const allRows = orderReportRows(buildGridRows(visible), displaySettings.options.sort, classTags.filter(tag => tag !== CLASS_TAG_ALL)).filter((r) => rowInClass(r.subject, activeClassFilter));
    const keySet = keys?.length ? new Set(keys) : null;
    const alreadySentRows = allRows.filter(
      (r) =>
        (!keySet || keySet.has(r.key)) &&
        r.subject.attendanceRaw !== "absent" &&
        isAlreadySent(effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus)),
    ).length;
    if (rows.length === 0) {
      toast.message(
        alreadySentRows
          ? tf("os.c.sendNoneSent", { n: alreadySentRows })
          : t("os.c.sendNone"),
      );
      return;
    }
    // 발송 전 누락 안내(2-4) — 차단 아님("누락=생략" 철학 유지). 누락은 고유 학생 수 기준.
    // ⚠️ 결석 제외는 **행(과목) 단위 건수** — 다과목 학생은 결석 반 과목만 빠지고 다른 과목은 발송되므로
    //    "N명 제외"로 쓰면 오안내(리뷰 확정). 발송 단위=행(lesson_reports 1건)이라 "건"이 정확.
    const absentRows = allRows.filter(
      (r) => (!keySet || keySet.has(r.key)) && r.subject.attendanceRaw === "absent",
    ).length;
    // 진도 미입력 제외(2026-07-28 김민찬 사례) — 멘트까지 다 써놓고 진도만 빠진 행이 **소리 없이** 빠지면
    // 강사는 발송된 줄 알고, 학부모는 못 받는다. 제외라는 사실 + **누구인지**를 confirm에서 알린다.
    const noProgressRows = allRows.filter(
      (r) =>
        (!keySet || keySet.has(r.key)) &&
        r.subject.attendanceRaw !== "absent" &&
        !isAlreadySent(effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus)) &&
        !isReportEligible(r.subject, isProgressOptionalReport(r.subject, reportsRef.current[r.student.id]?.[r.subject.name])),
    );
    const noProgressNames = [...new Set(noProgressRows.map((r) => r.student.name))];
    const progressLine = noProgressRows.length
      ? tf("os.c.lineProgress", {
          n: noProgressRows.length,
          names: noProgressNames.slice(0, 5).join(", "),
          more:
            noProgressNames.length > 5
              ? tf("os.c.lineMore", { n: noProgressNames.length - 5 })
              : "",
        })
      : "";
    // 출결 미체크 제외(2026-08-17 원장 지시) — 진도·멘트와 같은 규약: 소리 없는 제외 금지, 누구인지 명시.
    // "미체크만 아니면 발송됐을 행" = autowrite 판정(진도 있음·미발송·결석 아님)과 정확히 같은 집합이라
    // 게이트 함수를 재사용한다(조건 체인을 손으로 복제하면 게이트가 바뀔 때 이 카운트만 조용히 어긋난다, #89류).
    // 진도 미입력 행은 위 progressLine이 이미 셌으므로 여기 안 겹친다(한 행 중복 계수 방지).
    const uncheckedRows = allRows.filter(
      (r) =>
        canEditAttendance && // 출결 쓰기 권한 없음 = 게이트 해당 없음(P0-3) — 제외 안내도 하지 않는다
        (!keySet || keySet.has(r.key)) &&
        isRowActionable(r.subject, "autowrite", effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus), {
          progressOptional: isProgressOptionalReport(r.subject, reportsRef.current[r.student.id]?.[r.subject.name]),
        }) &&
        isAttendanceUnchecked(r.subject),
    );
    const uncheckedNames = [...new Set(uncheckedRows.map((r) => r.student.name))];
    const uncheckedLine = uncheckedRows.length
      ? tf("os.c.lineUnchecked", {
          n: uncheckedRows.length,
          names: uncheckedNames.slice(0, 5).join(", "),
          more:
            uncheckedNames.length > 5
              ? tf("os.c.lineMore", { n: uncheckedNames.length - 5 })
              : "",
        })
      : "";
    const gaps = summarizeSendGaps(rows, { dailyEnabled: showDailyTest, checkEnabled: showCheckTest });
    const gapLine =
      gaps.missingAttitude || gaps.missingTest
        ? tf("os.c.lineGap", { attitude: gaps.missingAttitude, test: gaps.missingTest })
        : "";
    // 🔴 빈 멘트 절대 가드(원장 지시 2026-07-28) — 멘트 없는 행은 **발송 대상에서 제외**한다(워커
    // 최종 관문도 무조건 차단 — 이날 빈 보고서 22건이 학부모에게 노출된 사고). confirm에 누구인지 명시.
    // 영어 글의 그림·사진 자리 줄뿐인 행도 빈 멘트다(서버 isSlotOnlyEnglishNotes와 같은 판정 — hasTextBesidesMarkers).
    const emptyMentRows = rows.filter((r) => !hasTextBesidesMarkers(reports[r.student.id]?.[r.subject.name]?.draft));
    rows = rows.filter((r) => hasTextBesidesMarkers(reports[r.student.id]?.[r.subject.name]?.draft));
    const emptyMentNames = [...new Set(emptyMentRows.map((r) => r.student.name))];
    const emptyMentLine = emptyMentRows.length
      ? tf("os.c.lineMent", {
          n: emptyMentRows.length,
          names: emptyMentNames.slice(0, 5).join(", "),
          more:
            emptyMentNames.length > 5
              ? tf("os.c.lineMore", { n: emptyMentNames.length - 5 })
              : "",
        })
      : "";
    // 새 보고서 조건(자동작성 다시 · 사랑의 한마디 · 시험 없음/숙제 미제출 사유) — 행별 발송 버튼과 **같은 판정**(pilot-send-gate.ts).
    // 원장 2026-10-26 *"표로 일괄입력할 때 문제"* — 일괄 발송만 이 조건을 안 봐서 사유 없는 글·옛 출결이 적힌 글이 나갔다. 제외 + 누구인지.
    const pilotBlockedRows = rows.filter((r) => pilotSendBlocks(latestRow(r.student.id, r.subject.name) ?? r.student, r.subject.name, reportsRef.current[r.student.id]?.[r.subject.name]).length > 0);
    if (pilotBlockedRows.length) {
      const blockedKeys = new Set(pilotBlockedRows.map((r) => r.key));
      rows = rows.filter((r) => !blockedKeys.has(r.key));
    }
    // 보강 진행 여부 확인 전 줄 — 행별 발송 버튼은 막는데(send-gate `mkcheck`) 일괄 발송만 안 걸러 서버 거절이 '실패'로 섞였다
    //   (2026-10-27 표 일괄 점검). 버튼과 **같은 판정**(needsMakeupCheck)으로 미리 빼고 누구인지 알린다.
    const makeupBlockedRows = rows.filter((r) => {
      const st = latestRow(r.student.id, r.subject.name) ?? r.student;
      return needsMakeupCheck(st.subjects.find((s) => s.name === r.subject.name) ?? r.subject);
    });
    if (makeupBlockedRows.length) {
      const blockedKeys = new Set(makeupBlockedRows.map((r) => r.key));
      rows = rows.filter((r) => !blockedKeys.has(r.key));
    }
    const makeupBlockedNames = [...new Set(makeupBlockedRows.map((r) => r.student.name))];
    const makeupLine = makeupBlockedRows.length
      ? tf("os.c.lineMakeupCheck", {
          n: makeupBlockedRows.length,
          names: makeupBlockedNames.slice(0, 5).join(", "),
          more: makeupBlockedNames.length > 5 ? tf("os.c.lineMore", { n: makeupBlockedNames.length - 5 }) : "",
        })
      : "";
    const pilotBlockedNames = [...new Set(pilotBlockedRows.map((r) => r.student.name))];
    const pilotLine = pilotBlockedRows.length
      ? tf("os.c.linePilot", {
          n: pilotBlockedRows.length,
          names: pilotBlockedNames.slice(0, 5).join(", "),
          more: pilotBlockedNames.length > 5 ? tf("os.c.lineMore", { n: pilotBlockedNames.length - 5 }) : "",
        })
      : "";
    if (rows.length === 0) {
      if (pilotBlockedRows.length || makeupBlockedRows.length) toast.message(`${t("os.c.sendNone")}${pilotLine}${makeupLine}`);
      else toast.message(tf("os.c.sendNoneMent", { n: emptyMentRows.length }));
      return;
    }
    // 영어 행 중 AI 코멘트가 고치기 전 값으로 쓰인 행 — 막지 않고 **누구인지** 알린다(위 줄들과 같은 규약).
    // 저장 직전 재조립은 사실 줄만 새로 쓰므로, 여기서 안 알리면 점수와 코멘트가 서로 다른 글이 나간다.
    // 영어 행의 템플릿 목록이 아직 오는 중이면 잠깐 미룬다(곧 다시 짤 수 있게 된다 — 지금 '그대로'를 권하지 않는다).
    if (
      rows.some(
        (r) =>
          r.subject.subjectKey === "english" &&
          englishTemplateNotReady(reportsRef.current[r.student.id]?.[r.subject.name]),
      )
    ) {
      toast.message(t("os.tpl.loading"));
      return;
    }
    // 🔴 일괄 확인은 '확인됨'으로 적지 않는다 — 이름이 5명까지만 적히는 창 하나로 이후 행별 복사·발송 확인까지 꺼지면 안 된다.
    const outdatedRows = outdatedEnglishRows(rows);
    const aiStaleNames = [...new Set(outdatedRows.map((r) => r.student.name))];
    const aiStaleLine = aiStaleNames.length
      ? tf("os.tpl.lineOutdated", {
          n: aiStaleNames.length,
          names: aiStaleNames.slice(0, 5).join(", "),
          more: aiStaleNames.length > 5 ? tf("os.c.lineMore", { n: aiStaleNames.length - 5 }) : "",
        })
      : "";
    const absentLine = absentRows ? tf("os.c.lineAbsent", { n: absentRows }) : "";
    const sentLine = alreadySentRows
      ? tf("os.c.lineSent", { n: alreadySentRows })
      : "";
    if (
      !window.confirm(
        tf("os.c.sendConfirm", {
          n: rows.length,
          lines: `${emptyMentLine}${pilotLine}${makeupLine}${progressLine}${uncheckedLine}${gapLine}${aiStaleLine}${absentLine}${sentLine}`,
        }),
      )
    )
      return;
    setBulkBusy("send");
    let queued = 0;
    let blocked = 0;
    let skipped = 0;
    let subjectOff = 0; // 발송 대상 과목 아님(저장만) — '발송 대기'로 뭉뚱그리지 않고 명시(#2 확정)
    let absentSkip = 0; // 서버 결석 게이트에 걸린 행(클라 사전 필터의 사각 — 반 모호 행 등)
    let uncheckedSkip = 0; // 서버 출결 미체크 게이트에 걸린 행(stale 화면 등 클라 게이트 사각)
    let optoutSkip = 0; // 서버 '수업보고서 미발송' 반 게이트에 걸린 행(2026-08-19)
    let sentSkip = 0; // 서버 중복 게시 가드에 걸린 행(다른 창에서 먼저 보낸 경우 등)
    let dry = 0;
    let fail = 0;
    let noClass = 0; // 반별 발송인데 보낼 반이 없어 막힌 행(원장 2026-09-30 — 담당 반이 없으면 발송 불가)
    let boardWait = 0; // 반 보드 배정·재확인을 기다리는 행(방금 배정된 신입 등 — 배정된 뒤 다시 보내면 된다, 2026-10-03)
    let jjWarn = 0; // 영어 그림 자료를 못 묶은 행(저장은 성공)
    let makeupSkip = 0; // 보강 진행 여부 확인 전이라 서버가 거절한 행(저장은 됐다)
    let pilotSkip = 0; // 새 보고서 조건(자동작성·사랑의 한마디·사유)에 걸려 서버가 거절한 행 — 화면 판정 뒤에 값이 바뀐 경우
    let windowHint = ""; // 발송 허용 시간창 밖 큐잉 — 마지막 응답의 창 라벨(테넌트 단일 설정이라 동일)
    try {
      for (const r of rows) {
        const student = latestRow(r.student.id, r.subject.name) ?? r.student;
        const res = await queueOne(student, r.subject.name, "bulk");
        if (res.ok && res.warning) jjWarn++;
        if (!res.ok) {
          // 반 보드에 배정되는 중이면 '실패'가 아니라 '기다림'으로 센다. 보류·반을 떠난 학생은 보낼 반이 없는 것이다.
          if (isBoardWaitStatus(res.status)) boardWait++;
          else if (res.status === "no_class" || isBoardBlockedStatus(res.status)) noClass++;
          // 새 보고서 조건에 걸려 서버가 거절(저장은 됐다) — '실패'로 뭉치지 않고 이유를 따로 센다(원장 2026-10-26).
          else if (isPilotGateError(res.error)) pilotSkip++;
          // 보강 진행 여부 확인 전(화면 판정 뒤에 예약이 생긴 경우 등) — 서버가 거절, 저장은 됐다.
          else if (res.error === MAKEUP_CHECK_REQUIRED_ERROR) makeupSkip++;
          else fail++;
        } else if (res.status === "queued") {
          queued++;
          if (res.sendWindowHint) windowHint = res.sendWindowHint;
        } else if (res.status === "dry_run") dry++;
        else if (res.status === "subject_off") subjectOff++;
        else if (res.status === "name_conflict" || res.status === "revoked" || res.status === "recall_pending") blocked++;
        else if (res.status === "absent") absentSkip++; // 서버 결석 게이트(클라 사전 필터를 지난 반 모호 행 등)
        else if (res.status === "no_attendance") uncheckedSkip++; // 서버 출결 미체크 게이트(stale 화면 등)
        else if (res.status === "report_optout") optoutSkip++; // 서버 미발송 반 게이트(2026-08-19)
        else if (res.status === "already_sent") sentSkip++; // 서버 중복 게시 가드(클라 게이트를 지난 stale 행)
        else skipped++; // processing/too_old
      }
    } finally {
      setBulkBusy(null);
    }
    toast.success(
      (dry ? (classnoteOn ? tf("os.c.bulkDry", { n: dry }) : tf("os.c.bulkSavedOnly", { n: dry })) : "") +
        (!classnoteOn && queued === 0
          ? ""
          : windowHint
            ? tf("os.c.bulkQueuedWindow", { n: queued, hint: windowHint })
            : tf("os.c.bulkQueued", { n: queued })) +
        (subjectOff ? tf("os.c.bulkSubjectOff", { n: subjectOff }) : "") +
        (absentSkip ? tf("os.c.bulkAbsent", { n: absentSkip }) : "") +
        (uncheckedSkip ? tf("os.c.bulkUnchecked", { n: uncheckedSkip }) : "") +
        (optoutSkip ? tf("os.c.bulkOptout", { n: optoutSkip }) : "") +
        (alreadySentRows || sentSkip
          ? tf("os.c.bulkSent", { n: alreadySentRows + sentSkip })
          : "") +
        (blocked ? tf("os.c.bulkBlocked", { n: blocked }) : "") +
        (skipped ? tf("os.c.bulkSkipped", { n: skipped }) : "") +
        (preSkipped ? tf("os.c.bulkPreSkipped", { n: preSkipped }) : "") +
        (jjWarn ? tf("os.tpl.jjWarnBulk", { n: jjWarn }) : "") +
        (boardWait ? tf("os.c.bulkBoardWait", { n: boardWait }) : "") +
        (noClass ? tf("os.c.bulkNoClass", { n: noClass }) : "") +
        (pilotSkip ? tf("os.c.bulkPilot", { n: pilotSkip }) : "") +
        (makeupSkip ? tf("os.c.bulkMakeupCheck", { n: makeupSkip }) : "") +
        (fail ? tf("os.c.bulkFail", { n: fail }) : ""),
    );
  }
  return { saveAllVisible, sendAllVisible };
}
