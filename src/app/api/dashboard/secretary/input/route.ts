import { NextResponse } from "next/server";
import { readSecretaryInput } from "@/features/dashboard/instruments/secretary-schema";
import { captureSecretaryInput } from "@/features/dashboard/instruments/secretary-server";
import { getStaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { isTenantViewWriteBlocked } from "@/lib/auth/tenant-view";
import { viewAsTeacher } from "@/lib/auth/view-as";
import { reportError } from "@/lib/observability/report-error";

export const dynamic = "force-dynamic";

/**
 * 업무 비서 마지막 후보 남기기 — 화면의 숫자가 바뀔 때 보낸다(AI 호출 없음). 예약 정리(01:00 · 13:00)가 이 후보로 정리한다.
 * 읽기 전용 지점 보기 · 업무를 요청할 수 없는 사람은 남기지 않는다.
 */
export async function POST(request: Request) {
  const input = await readSecretaryInput(request);
  if (!input) return NextResponse.json({ ok: false }, { status: 400 });
  // 강사뷰(전체 · 읽기)에서는 남기지 않는다 — 업무 비서는 학원 대시보드 것이라 강사뷰 화면에 없다. 할 일 게이트가 대상 X를 돌려주므로
  // 직접 호출이나 다른 탭의 관리자뷰 자동 전송이 X 명의 후보를 덮었다(2026-11-05 강사뷰 적대 리뷰 중요).
  if (await viewAsTeacher()) return NextResponse.json({ ok: false }, { status: 403 });
  const viewer = await getStaffTaskViewer();
  if (!viewer || (await isTenantViewWriteBlocked())) return NextResponse.json({ ok: false }, { status: 403 });
  try {
    return NextResponse.json(await captureSecretaryInput(viewer, input));
  } catch (error) {
    reportError(error, { scope: "api.dashboard.secretary.input", tenantId: viewer.user.tenantId });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
