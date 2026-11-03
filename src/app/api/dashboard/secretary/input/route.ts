import { NextResponse } from "next/server";
import { readSecretaryInput } from "@/features/dashboard/instruments/secretary-schema";
import { captureSecretaryInput } from "@/features/dashboard/instruments/secretary-server";
import { getStaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { isTenantViewWriteBlocked } from "@/lib/auth/tenant-view";
import { reportError } from "@/lib/observability/report-error";

export const dynamic = "force-dynamic";

/**
 * 업무 비서 마지막 후보 남기기 — 화면의 숫자가 바뀔 때 보낸다(AI 호출 없음). 예약 정리(01:00 · 13:00)가 이 후보로 정리한다.
 * 읽기 전용 지점 보기 · 업무를 요청할 수 없는 사람은 남기지 않는다.
 */
export async function POST(request: Request) {
  const input = await readSecretaryInput(request);
  if (!input) return NextResponse.json({ ok: false }, { status: 400 });
  const viewer = await getStaffTaskViewer();
  if (!viewer || (await isTenantViewWriteBlocked())) return NextResponse.json({ ok: false }, { status: 403 });
  try {
    return NextResponse.json(await captureSecretaryInput(viewer, input));
  } catch (error) {
    reportError(error, { scope: "api.dashboard.secretary.input", tenantId: viewer.user.tenantId });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
