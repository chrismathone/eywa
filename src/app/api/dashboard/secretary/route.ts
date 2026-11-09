import { NextResponse } from "next/server";
import { readSecretaryInput } from "@/features/dashboard/instruments/secretary-schema";
import { askSecretary, loadSecretaryNote } from "@/features/dashboard/instruments/secretary-server";
import { getStaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { isTenantViewWriteBlocked } from "@/lib/auth/tenant-view";
import { viewAsTeacher } from "@/lib/auth/view-as";
import { reportError } from "@/lib/observability/report-error";

export const dynamic = "force-dynamic";
/** AI가 답하는 동안 기다린다(보통 10~30초). */
export const maxDuration = 60;

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/** 오늘 받은 정리와 돌린 시각들 — 화면이 뜬 뒤 따로 읽는다(GET · 셸이 저절로 부르는 조회는 서버 액션이 아니다 — #137). AI는 부르지 않는다. */
export async function GET() {
  try {
    const viewer = await getStaffTaskViewer();
    return NextResponse.json(viewer ? await loadSecretaryNote(viewer) : { enabled: false, note: null, runs: [] }, NO_STORE);
  } catch (error) {
    reportError(error, { scope: "api.dashboard.secretary" });
    return NextResponse.json({ enabled: false, note: null, runs: [] }, { status: 500, ...NO_STORE });
  }
}

/** 'AI로 정리' — 사람이 누를 때만. 화면이 보고 있는 후보를 그대로 받아 순서 · 이유만 다시 쓴다. */
export async function POST(request: Request) {
  const input = await readSecretaryInput(request);
  if (!input) return NextResponse.json({ error: "정리할 자료를 읽지 못했습니다. 화면을 새로고침해 주세요" }, { status: 400 });
  // 강사뷰(전체 · 읽기)에서는 정리하지 않는다 — 대상 X 명의로 AI를 부르고 X의 하루 상한을 쓴다(2026-11-05 강사뷰 적대 리뷰 중요).
  if (await viewAsTeacher()) return NextResponse.json({ error: "강사뷰에서는 오늘의 브리핑을 쓸 수 없습니다. 강사뷰를 끝내고 본인 화면에서 써 주세요" }, { status: 403 });
  const viewer = await getStaffTaskViewer();
  if (!viewer) return NextResponse.json({ error: "이 계정으로는 오늘의 브리핑을 쓸 수 없습니다" }, { status: 403 });
  if (await isTenantViewWriteBlocked()) return NextResponse.json({ error: "읽기 전용으로 보는 중에는 정리할 수 없습니다" }, { status: 403 });
  try {
    const result = await askSecretary(viewer, input);
    return result.ok ? NextResponse.json({ note: result.note }, NO_STORE) : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (error) {
    reportError(error, { scope: "api.dashboard.secretary.ask", tenantId: viewer.user.tenantId });
    // AI 오류는 generateJSON이 한글로 바꿔 던진다(키 · 한도 · 지점 라이선스). 한글이 아닌 원문은 화면에 내지 않는다.
    const message = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : "AI 정리를 하지 못했습니다. 잠시 뒤 다시 눌러 주세요";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
