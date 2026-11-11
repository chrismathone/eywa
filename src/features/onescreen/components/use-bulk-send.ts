"use client";

import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import type { SendMode } from "../write-timing";
import type { saveAndQueueClassnote, saveLessonReport } from "../server/actions";
import type { GridRow, RowAction } from "../grid";
import type { DisplayOptions } from "../display-options";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent, Subject } from "../types";
import type { SubjectReport } from "./report-card";
import type { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { bulkSendAlreadySent, bulkSendTailLines, planBulkSendExclusions } from "../bulk-send-preview";
import { createBulkSendTally } from "../bulk-send-result";
import { useBulkSave } from "./use-bulk-save";

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
 * batch D: 일괄 저장 = use-bulk-save.ts · 발송 미리 보기(빼는 행·확인 줄) = bulk-send-preview.ts · 결과 세기·문구 = bulk-send-result.ts.
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
  // 일괄 저장(use-bulk-save.ts) — batch D에서 나눴다(본문 그대로).
  const { saveAllVisible } = useBulkSave({
    sentRowCount,
    i18n: { t, tf },
    reportsRef,
    bulk: { bulkBusy, bulkGen, setBulkBusy },
    rows: { selectRows, latestRow },
    english: { englishTemplateNotReady, outdatedEnglishRows },
    saveRecord,
    readonlyBlocked,
  });
  // 일괄 발송 — 빼는 행·확인 줄은 bulk-send-preview.ts, 결과 세기·마지막 문구는 bulk-send-result.ts(순수 · 본문 그대로).
  // 여기는 순서만 쥔다: 이미 발송된 행 → (대상 없음) → 빼는 행 → (대상 없음) → 영어 목록 대기 → 확인 → 순차 발송 → 잠금 해제 → 한 줄 안내.
  async function sendAllVisible(keys?: string[]) {
    if (readonlyBlocked()) return;
    if (bulkBusy || bulkGen) return; // 재진입·중첩 방지(#10)
    let rows = selectRows("send", keys); // ⚠️ let — 아래 빈 멘트 절대 가드가 대상을 좁힌다

    const preSkipped = keys?.length ? keys.length - rows.length : 0; // 미선택=전체=0(음수 방지 #11)
    const { allRows, keySet, alreadySentRows } = bulkSendAlreadySent({
      view: { visible, activeClassFilter, classTags, displaySettings },
      keys,
      liveClassnoteStatus,
    });
    if (rows.length === 0) {
      toast.message(
        alreadySentRows
          ? tf("os.c.sendNoneSent", { n: alreadySentRows })
          : t("os.c.sendNone"),
      );
      return;
    }
    const {
      rows: sendable,
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
    } = planBulkSendExclusions({
      rows,
      allRows,
      keySet,
      liveClassnoteStatus,
      reports,
      reportsRef,
      canEditAttendance,
      showDailyTest,
      showCheckTest,
      latestRow,
      tf,
    });
    rows = sendable;
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
    const { aiStaleLine, absentLine, sentLine } = bulkSendTailLines(outdatedRows, absentRows, alreadySentRows, tf);
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
    const tally = createBulkSendTally();
    try {
      for (const r of rows) {
        const student = latestRow(r.student.id, r.subject.name) ?? r.student;
        const res = await queueOne(student, r.subject.name, "bulk");
        tally.add(res);
      }
    } finally {
      setBulkBusy(null);
    }
    toast.success(tally.message({ classnoteOn, alreadySentRows, preSkipped }, tf));
  }
  return { saveAllVisible, sendAllVisible };
}
