import { NextResponse } from "next/server";
import { getStudentHub } from "@/features/student-hub/server/query";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const data = await getStudentHub(id, new URL(request.url).searchParams.get("month") ?? undefined);
    if (!data) return NextResponse.json({ error: "학생 기록을 열람할 수 없습니다." }, { status: 404 });
    return NextResponse.json(data.graph, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    // 권한 게이트(requireAccess)는 redirect/notFound를 던진다 — 그것만 403. 그 밖(조회 실패 등)은 원인을 남기고 500(B16).
    const digest = typeof (e as { digest?: unknown })?.digest === "string" ? (e as { digest: string }).digest : "";
    if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) {
      return NextResponse.json({ error: "학생 통합 기록을 볼 권한이 없습니다." }, { status: 403 });
    }
    console.error("[api/students/knowledge] 조회 실패:", e);
    return NextResponse.json({ error: "학생 통합 기록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요." }, { status: 500 });
  }
}
