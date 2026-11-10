"use client";

import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import type { GridRow, RowAction } from "../grid";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent, Subject } from "../types";
import type { SubjectReport } from "./report-card";
import type { SendCore } from "./use-bulk-send";
import type { BulkI18n } from "./bulk-ops-types";

/**
 * 표 일괄 저장 — 수정 계획 P3-O batch D, `use-bulk-send.ts`에서 나눔(본문 그대로).
 * 대상은 `selectRows("save")` · 행마다 저장 코어를 **순차**로 부르고(병렬화 없음), 루프 중엔 `latestRow`로 최신 학생 값을 읽는다(#10).
 */
export function useBulkSave({
  sentRowCount,
  i18n: { t, tf },
  reportsRef,
  bulk: { bulkBusy, bulkGen, setBulkBusy },
  rows: { selectRows, latestRow },
  english: { englishTemplateNotReady, outdatedEnglishRows },
  saveRecord,
  readonlyBlocked,
}: {
  /** 이 날짜에 이미 학부모에게 나간 행 수 — 저장 대상이 없을 때 까닭을 적는다. */
  sentRowCount: number;
  i18n: BulkI18n;
  reportsRef: { readonly current: ReportsState };
  bulk: {
    bulkBusy: "save" | "send" | null;
    bulkGen: boolean;
    setBulkBusy: Dispatch<SetStateAction<"save" | "send" | null>>;
  };
  rows: {
    selectRows: (action: RowAction, keys?: string[]) => GridRow[];
    latestRow: (studentId: string, subjectName: string) => OneScreenStudent | null;
  };
  english: {
    englishTemplateNotReady: (rep: SubjectReport | undefined) => boolean;
    outdatedEnglishRows: <T extends { student: OneScreenStudent; subject: Subject }>(rows: readonly T[]) => T[];
  };
  saveRecord: SendCore["saveRecord"];
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
  return { saveAllVisible };
}
