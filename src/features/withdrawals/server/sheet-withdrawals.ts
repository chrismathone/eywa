import "server-only";
import { reportWarning } from "@/lib/observability/report-error";
import { mergeSheetWithdrawals } from "../sheet-withdrawals";
import { loadSheetExits, loadStudentNames } from "./sheet-teachers";
import type { WindowWithdrawal } from "./window";

/**
 * 운영실 퇴원 줄에 퇴원생 관리 차트를 입힌다(`sheet-withdrawals.ts`). 시트를 못 읽거나 쓰지 않는 지점이면 받은 줄 그대로.
 * 학생 이름 조회가 실패하면 시트를 입히지 않는다(과목만 끊은 줄을 퇴원으로 부풀리지 않게) — 경고를 남긴다.
 */
export async function withSheetWithdrawals(rows: Promise<WindowWithdrawal[]>, tenantId: string, today: string, from: string): Promise<WindowWithdrawal[]> {
  const [list, records] = await Promise.all([rows, loadSheetExits(tenantId)]);
  if (!records?.length) return list;
  try {
    return mergeSheetWithdrawals(list, records, { today, from, names: await loadStudentNames(tenantId) });
  } catch (e) {
    reportWarning("운영실 퇴원 줄 시트 맞춤 실패", { scope: "withdrawals.sheetWithdrawals", message: e instanceof Error ? e.message : String(e) });
    return list;
  }
}
