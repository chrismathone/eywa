"use client";

import { orderReportRows } from "../report-row-order";
import { isProgressOptionalReport } from "../jj-books";
import type { OneScreenStudent } from "../types";
import { CLASS_TAG_ALL } from "../class-tags";
import { buildGridRows, effectiveClassnoteStatus, isRowActionable, rowInClass, type RowAction } from "../grid";
import type { ReportsState } from "../session-input";
import type { useSheetLang } from "@/features/teacher-view/lang-context";
import type { BulkAttendance, BulkI18n, BulkRowSetters, BulkVideo, BulkView } from "./bulk-ops-types";
import { useBulkApply } from "./use-bulk-apply";
import { useBulkCopy } from "./use-bulk-copy";
import { usePrevImport } from "./use-prev-import";

export type { BulkRowSetters } from "./bulk-ops-types";

/**
 * 표 일괄 작업 — 대상 행 고르기(`selectRows`)·값 일괄 적용·맨 위 행 복사·이전 회차 가져오기(행·일괄)·멘트 가져오기 확인.
 * 수정 계획 P3-O 6/10, `onescreen-client.tsx`에서 옮김(동작 그대로). 일괄 저장·발송은 `use-bulk-send.ts`.
 * batch C: 값 일괄 적용 = use-bulk-apply.ts · 맨 위 행 복사 = use-bulk-copy.ts · 이전 회차 = use-prev-import.ts로 나눴다.
 *
 * ⚠️ `bulkBusy` state는 화면에 남는다 — 자동작성(useAutoWrite)·첨부(useReportAttachments)·카드 발송이 같은 잠금을 읽고,
 *    자동작성의 `bulkGen`을 이 훅이 받으므로(재진입 잠금) 이 훅이 소유하면 두 훅이 서로를 먼저 불러야 하는 순환이 생긴다.
 * ⚠️ 행 세터를 부르는 순서는 예전 그대로다 — 같은 학생 행을 차례로 patch하므로 순서를 바꾸면 결과가 달라질 수 있다.
 */
export function useBulkOps({
  view,
  ctx: { canEditAttendance, readonlyView, activeDate, lang },
  i18n,
  refs,
  bulk,
  video,
  attendance,
  makeupPrev,
  setters,
  readonlyBlocked,
}: {
  view: BulkView;
  ctx: { canEditAttendance: boolean; readonlyView: boolean; activeDate: string; lang: ReturnType<typeof useSheetLang> };
  i18n: BulkI18n;
  refs: { reportsRef: { readonly current: ReportsState }; studentsRef: { readonly current: OneScreenStudent[] } };
  bulk: { bulkBusy: "save" | "send" | null; bulkGen: boolean };
  video: BulkVideo;
  attendance: BulkAttendance;
  makeupPrev: { prevLoaded: ReadonlySet<string>; loadMakeupPrevAll: (ids: string[]) => Promise<void> };
  setters: BulkRowSetters;
  readonlyBlocked: () => boolean;
}) {
  const { visible, activeClassFilter, classTags, displaySettings } = view;
  const { reportsRef } = refs;
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
  const { prevCommentPlan, setPrevCommentPlan, importPrevFor, bulkImportPrev, applyPrevComments } = usePrevImport({
    view,
    readonlyView,
    i18n,
    refs,
    bulk,
    makeupPrev,
    setters,
    liveClassnoteStatus,
    readonlyBlocked,
  });
  const { bulkApplyValues } = useBulkApply({
    view,
    ctx: { readonlyView, activeDate, lang },
    i18n,
    video,
    attendance,
    setters,
    liveClassnoteStatus,
  });
  const { copyFirstRowDown } = useBulkCopy({ view, activeDate, i18n, setters, liveClassnoteStatus, readonlyBlocked });
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
