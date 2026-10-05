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

/**
 * Case detail sections over one copy of the case data. Commands here reload that copy (CommandForm "client" refresh)
 * instead of letting the action re-render the page, so a save never waits on a streamed page tree.
 * New server props (navigation, window refresh) replace the reloaded copy. Inputs keep their values across reloads
 * because the sections stay mounted.
 */
export function CaseDetailView({ initial, periods, actorId, reserveOn }: {
  initial: MakeupCaseDetail; periods: PeriodsConfig; actorId: string; reserveOn: boolean;
}) {
  const [state, setState] = useState({ base: initial, detail: initial });
  if (state.base !== initial) setState({ base: initial, detail: initial });
  const base = state.base === initial ? state.base : initial;
  const detail = state.base === initial ? state.detail : initial;
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
        ? { base, detail: fresh } : current));
      return true;
    } catch {
      return false;
    }
  }, [base]);
  const value = useMemo(() => ({ reload }), [reload]);
  const reserve = detail.permissions.reserve && detail.case.eligibility === "approved" && detail.case.lifecycle === "open" && reserveOn;
  return <CaseDetailReloadContext value={value}>
    <CaseRecords detail={detail} />
    <ReconciliationPanel detail={detail} />
    <CaseDecisions detail={detail} />
    {reserve ? <ReserveForm row={detail.case} periods={periods} /> : null}
    <SessionOperations detail={detail} periods={periods} actorId={actorId} />
  </CaseDetailReloadContext>;
}
