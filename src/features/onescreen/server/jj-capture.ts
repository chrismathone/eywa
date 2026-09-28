import "server-only";

/**
 * 영어 보고서 저장 직후 — 그날 인재원 자료(설명서 5번 하루치)를 받아 **보고서에 묶어 둔다**(0261a `report_jj_snapshots`).
 * 학부모 카드(/r·PDF·ClassNote 캡처)는 이 묶음으로 그림 자리를 그린다.
 *
 * 🔴 던지지 않는다 — 저장은 이미 끝났다. 못 묶으면 강사에게 알릴 한국어 문장을 돌려준다(jj-capture-plan.ts).
 * ⚠️ `saveLessonReport`가 upsert 직후 **다른 후처리와 나란히** 시작하고 마지막에 기다린다(B4) — 수학은 부르지 않는다.
 * ⚠️ 권한은 호출부가 이미 확인했다(보고서를 쓸 수 있는 학생) — 여기선 학원(tenant) 경계만 건다(report-snapshot.ts).
 */
import {
  deleteReportJjSnapshot,
  deleteReportJjSnapshotIfNot,
  fetchStudentJjDay,
  saveReportJjSnapshot,
} from "@/features/ijw/server/report-snapshot";
import { jjCaptureWarning } from "../jj-capture-plan";

export async function captureReportJj(args: {
  tenantId: string;
  reportId: string;
  studentId: string;
  date: string;
  /** 강사가 고른 결과지(report-snapshot.ts `fetchStudentJjDay`) — `undefined` = 저장해 둔 고르기를 따른다. */
  pick?: string[] | null;
}): Promise<string | null> {
  try {
    const day = await fetchStudentJjDay(args.tenantId, args.studentId, args.date, args.pick);
    if (day.state === "unlinked") {
      // 🔴 짝이 끊겼으면 **예전에 묶어 둔 자료를 지운다** — 잘못 이은 짝의 자료가 이 학생 카드에 계속 그려지지 않게.
      await deleteReportJjSnapshot(args.tenantId, args.reportId);
      return jjCaptureWarning("unlinked");
    }
    if (day.state === "error") {
      // 받지는 못했어도 **지금 짝**은 안다 — 다른 짝의 옛 동결본은 지운다(같은 짝의 옛 자료는 남는다).
      if (day.ijwId) await deleteReportJjSnapshotIfNot(args.tenantId, args.reportId, day.ijwId);
      return jjCaptureWarning("fetch_failed");
    }
    const saved = await saveReportJjSnapshot(args.tenantId, args.reportId, day.snapshot);
    if (saved.ok) return null;
    return jjCaptureWarning(saved.reason === "missing_table" ? "not_ready" : "save_failed");
  } catch {
    return jjCaptureWarning("fetch_failed");
  }
}
