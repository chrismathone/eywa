/**
 * 표 일괄 발송의 **미리 보기** — 대상에서 빼는 행과 확인 창에 적을 줄(순수 · 수정 계획 P3-O batch D, `use-bulk-send.ts`에서 옮김 · 본문 그대로).
 * 부르는 쪽(use-bulk-send.ts)이 예전 순서대로 부른다: 이미 발송된 행 → (대상이 비면 알리고 멈춤) → 빼는 행·확인 줄 → 확인 창.
 * 최신 학생 값·초안은 부를 때 넘겨받은 함수·ref로 읽는다(예전 그대로 — 화면 스냅샷 `reports`와 ref를 섞어 쓰던 자리도 그대로).
 */
import { orderReportRows } from "./report-row-order";
import { isProgressOptionalReport } from "./jj-books";
import { CLASS_TAG_ALL } from "./class-tags";
import { needsMakeupCheck } from "./reserved-makeup";
import { pilotSendBlocks } from "./pilot-send-gate";
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
} from "./grid";
import type { ReportsState } from "./session-input";
import type { OneScreenStudent } from "./types";
import type { BulkView, LiveClassnoteStatus } from "./components/bulk-ops-types";
import type { useSheetTf } from "@/features/teacher-view/lang-context";

type Tf = ReturnType<typeof useSheetTf>;

/** 게이트 이전의 원본 행(표시 집합 × 반 필터)과 그중 이미 발송된 행 수 — 체크한 행이 있으면 그 행들 안에서. */
export function bulkSendAlreadySent({
  view: { visible, activeClassFilter, classTags, displaySettings },
  keys,
  liveClassnoteStatus,
}: {
  view: BulkView;
  keys: string[] | undefined;
  liveClassnoteStatus: LiveClassnoteStatus;
}) {
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
  return { allRows, keySet, alreadySentRows };
}

/** 대상에서 빼는 행(빈 멘트 · 새 보고서 조건 · 보강 확인 전)과 확인 창 줄 — 빠지는 행은 누구인지 적는다(소리 없는 제외 금지). */
export function planBulkSendExclusions(input: {
  rows: GridRow[];
  allRows: GridRow[];
  keySet: Set<string> | null;
  liveClassnoteStatus: LiveClassnoteStatus;
  /** 빈 멘트 판정은 화면 스냅샷(`reports`) · 진도 판정은 ref(예전 그대로). */
  reports: ReportsState;
  reportsRef: { readonly current: ReportsState };
  canEditAttendance: boolean;
  showDailyTest: boolean;
  showCheckTest: boolean;
  latestRow: (studentId: string, subjectName: string) => OneScreenStudent | null;
  tf: Tf;
}) {
  const { allRows, keySet, liveClassnoteStatus, reports, reportsRef, canEditAttendance, showDailyTest, showCheckTest, latestRow, tf } = input;
  let rows = input.rows;
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
  return {
    rows,
    absentRows,
    progressLine,
    uncheckedLine,
    gapLine,
    emptyMentRows,
    emptyMentLine,
    pilotBlockedRows,
    makeupBlockedRows,
    makeupLine,
    pilotLine,
  };
}

/** 확인 창 끝 줄 — 영어 옛 값 행(이름) · 결석 건수 · 이미 발송된 건수. */
export function bulkSendTailLines(
  outdatedRows: readonly { student: Pick<OneScreenStudent, "name"> }[],
  absentRows: number,
  alreadySentRows: number,
  tf: Tf,
) {
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
  return { aiStaleLine, absentLine, sentLine };
}
