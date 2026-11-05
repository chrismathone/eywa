"use client";

import { startTransition, useCallback, useMemo, useRef, useState } from "react";
import type { PeriodsConfig } from "@/features/timetable/lib/periods";
import type { MakeupCaseDetail } from "../server/read-types";
import { reloadMakeupCaseDetail } from "../server/actions";
import { CaseDetailReloadContext } from "./case-detail-context";
import { CaseRecords } from "./case-records";
import { CaseDecisions } from "./case-decisions";
import { ReserveForm } from "./reserve-form";
import { SessionOperations } from "./session-operations";
import { ReconciliationPanel } from "./reconciliation-panel";
import { writeLockedNote } from "@/lib/write-lock";

/** 쓰기가 아닌 표시용 권한 — 읽기로 내려도 그대로 둔다. */
const READ_PERMISSIONS = new Set(["read_billing"]);
const NO_ACTIONS = { record: false, submit: false, cancel: false, reschedule: false };
const READ_ONLY_BLOCKED = { record: "read_only", submit: "read_only", cancel: "read_only", reschedule: "read_only" };

/**
 * 쓰기 권한을 전부 내린 사본 — 서버 게이트(`canWriteTenant("makeups")`)가 거짓인데 DB가 쓰기를 열어 둔 경우를 덮는다.
 * DB `makeup_private.actor()`는 원장 역할을 덮어쓰기와 무관하게 '전체'로 보고, '다른 강사 뷰'(열람 전용)도 모른다 —
 * 그 둘에서 양식이 다 보였다가 저장 때 "보강 기록 변경 권한이 없습니다"로 거절됐다(원장 2026-11-05 읽기 권한 정리).
 * 참가자별 조작도 DB가 읽기 권한에 주는 것과 같은 사유(read_only)로 막아 안내 문구가 같게 나온다.
 */
export function withoutMakeupWrites(detail: MakeupCaseDetail): MakeupCaseDetail {
  return {
    ...detail,
    permissions: Object.fromEntries(Object.entries(detail.permissions).map(([key, value]) => [key, READ_PERMISSIONS.has(key) && value])),
    participants: detail.participants.map(participant => ({ ...participant,
      actions: { ...participant.actions, ...NO_ACTIONS }, blocked: { ...participant.blocked, ...READ_ONLY_BLOCKED } })),
  };
}

/**
 * Case detail sections over one copy of the case data. Commands here reload that copy (CommandForm "client" refresh)
 * instead of letting the action re-render the page, so a save never waits on a streamed page tree.
 * New server props (navigation, window refresh) replace the reloaded copy. Inputs keep their values across reloads
 * because the sections stay mounted.
 * canWrite = page.tsx가 서버 게이트와 같은 `canWriteTenant("makeups")`로 계산한 값. 거짓이면 쓰기 양식을 그리지 않는다.
 */
export function CaseDetailView({ initial, periods, actorId, reserveOn, canWrite, recordView = "attendance" }: {
  initial: MakeupCaseDetail; periods: PeriodsConfig; actorId: string; reserveOn: boolean; canWrite: boolean;
  recordView?: "teacher" | "attendance";
}) {
  const [state, setState] = useState({ base: initial, detail: initial, version: 0 });
  if (state.base !== initial) setState({ base: initial, detail: initial, version: state.version + 1 });
  const base = state.base === initial ? state.base : initial;
  const stored = state.base === initial ? state.detail : initial;
  // 다시 읽은 사본에도 같은 캡을 씌운다(DB 권한만 믿지 않는다).
  const detail = useMemo(() => canWrite ? stored : withoutMakeupWrites(stored), [canWrite, stored]);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const mine = (latest.current += 1);
    try {
      const next = await reloadMakeupCaseDetail({ case_id: base.case.id });
      if (!next.data) return false;
      const fresh = next.data;
      // Applied only to the server props it was started from, and only if no later read started since:
      // a slower older read, a read from the previous case after navigation, or newer server props all win over it.
      startTransition(() => setState(current => current.base === base && mine === latest.current && fresh.case.id === base.case.id
        ? { base, detail: fresh, version: current.version + 1 } : current));
      return true;
    } catch {
      return false;
    }
  }, [base]);
  const value = useMemo(() => ({ reload, version: state.version }), [reload, state.version]);
  const reserve = detail.case.reason !== "additional" && detail.permissions.reserve && detail.case.eligibility === "approved" && detail.case.lifecycle === "open" && reserveOn;
  return <CaseDetailReloadContext value={value}>
    {canWrite ? null : <p role="status" className="border-line rounded-md border p-3">{writeLockedNote("makeups")}</p>}
    <CaseRecords detail={detail} />
    <ReconciliationPanel detail={detail} />
    <CaseDecisions detail={detail} />
    {reserve ? <ReserveForm row={detail.case} periods={periods} /> : null}
    <SessionOperations detail={detail} periods={periods} actorId={actorId} recordView={recordView} />
  </CaseDetailReloadContext>;
}
