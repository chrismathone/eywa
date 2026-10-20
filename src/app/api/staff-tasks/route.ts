import { NextResponse } from "next/server";
import { getStaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { listTasks } from "@/features/staff-tasks/server/queries";
import { parseTaskFilter, TASK_KINDS } from "@/features/staff-tasks/kinds";
import { reportError } from "@/lib/observability/report-error";

/**
 * 할 일 목록(GET) — 공통 할 일 창이 누를 때 부른다. `scope=mine`(내가 맡은 일) · `scope=all`(현황 권한만 · `assignee`로 한 사람).
 * 사람 확인·권한은 `getStaffTaskViewer` 한 곳([[#77]]). 사람마다 다른 응답이라 캐시 금지.
 */
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const viewer = await getStaffTaskViewer();
    if (!viewer) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401, headers: NO_STORE });
    const all = params.get("scope") === "all";
    if (all && !viewer.canMonitor) return NextResponse.json({ error: "업무 처리 현황을 볼 권한이 없습니다" }, { status: 403, headers: NO_STORE });
    const assignee = params.get("assignee");
    const assigneeId = all ? (assignee && UUID.test(assignee) ? assignee : null) : viewer.user.id;
    const kind = params.get("kind");
    const list = await listTasks({
      tenantId: viewer.user.tenantId,
      assigneeId,
      filter: parseTaskFilter(params.get("filter")),
      kind: kind && kind in TASK_KINDS ? kind : null,
      page: Number(params.get("page") ?? 0) || 0,
    });
    return NextResponse.json(list, { headers: NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.staff-tasks.list" });
    return NextResponse.json({ error: "할 일을 불러오지 못했습니다" }, { status: 500, headers: NO_STORE });
  }
}
