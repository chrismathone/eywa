import { NextResponse } from "next/server";
import { getStaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { taskDetail } from "@/features/staff-tasks/server/queries";
import { reportError } from "@/lib/observability/report-error";

/** 할 일 하나 + 변경 이력(GET) — 맡은 사람 또는 현황 권한이 있는 사람만(아니면 없는 할 일과 똑같이 404). */
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const viewer = await getStaffTaskViewer();
    if (!viewer) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401, headers: NO_STORE });
    const detail = UUID.test(id) ? await taskDetail(viewer.user.tenantId, id, { userId: viewer.user.id, canMonitor: viewer.canMonitor }) : null;
    if (!detail) return NextResponse.json({ error: "할 일을 찾지 못했습니다" }, { status: 404, headers: NO_STORE });
    return NextResponse.json(detail, { headers: NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.staff-tasks.detail" });
    return NextResponse.json({ error: "할 일을 불러오지 못했습니다" }, { status: 500, headers: NO_STORE });
  }
}
