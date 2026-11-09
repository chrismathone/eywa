import { NextResponse } from "next/server";
import { getStudentHub } from "@/features/student-hub/server/query";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const data = await getStudentHub(id, new URL(request.url).searchParams.get("month") ?? undefined);
    if (!data) return NextResponse.json({ error: "학생 기록을 열람할 수 없습니다." }, { status: 404 });
    return NextResponse.json(data.graph, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return NextResponse.json({ error: "학생 통합 기록을 불러올 수 없습니다." }, { status: 403 }); }
}
