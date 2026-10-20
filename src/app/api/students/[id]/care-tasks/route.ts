import { NextResponse } from "next/server";
import { getCareTasks } from "@/features/student-care/server/tasks";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const filter = new URL(request.url).searchParams.get("filter") ?? "open";
  if (filter !== "open" && filter !== "closed") return NextResponse.json({ error: "조회 조건을 확인해 주세요." }, { status: 400, headers });
  try {
    const data = await getCareTasks((await params).id, filter);
    if (!data) return NextResponse.json({ error: "이 학생의 관련 업무를 열람할 수 없습니다." }, { status: 404, headers });
    return NextResponse.json(data, { headers });
  } catch {
    // Schema not yet applied and source failures are errors, never an empty/healthy result.
    return NextResponse.json({ error: "관련 업무를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요." }, { status: 503, headers });
  }
}
