import { NextResponse } from "next/server";
import { z } from "zod";
import { saveJourney, journeyHistory } from "@/features/enrollment/journey/server";

/**
 * 전화·방문·등록 확인 기록 저장(POST) · 변경 이력(GET) — aywa-next 인계 이식(s2_0063).
 * 권한·상담 열람 범위·날짜 판정은 `journey/server.ts`가 다시 본다. 화면엔 한글 사유만 돌려준다(영문 원문은 로그로).
 */
const headers = { "Cache-Control": "private, no-store" };
const korean = (message: string | undefined) => (message && /[가-힣]/.test(message) ? message : null);

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return NextResponse.json({ error: "요청 출처를 확인해 주세요" }, { status: 403, headers });
  try {
    const text = await request.text();
    if (text.length > 20000) return NextResponse.json({ error: "기록을 짧게 나누어 주세요" }, { status: 400, headers });
    return NextResponse.json({ version: await saveJourney(JSON.parse(text)) }, { headers });
  } catch (e) {
    const message = e instanceof z.ZodError ? korean(e.issues[0]?.message) : korean(e instanceof Error ? e.message : undefined);
    if (!message) console.error("[enrollment.journey.save]", e);
    return NextResponse.json({ error: message ?? "저장하지 못했습니다. 입력값을 확인해 주세요" }, { status: 400, headers });
  }
}

export async function GET(request: Request) {
  try {
    return NextResponse.json({ history: await journeyHistory(new URL(request.url).searchParams.get("id") ?? "") }, { headers });
  } catch {
    return NextResponse.json({ error: "변경 이력 또는 열람 권한을 확인해 주세요" }, { status: 403, headers });
  }
}
