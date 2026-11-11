import { NextResponse } from "next/server";
import { saveOkr, okrHistory } from "@/features/organization-okr/server";
import { sameOriginJsonPost } from "@/lib/http/same-origin-json";

/** 조직·OKR 저장·이력 — 권한·본인 판정은 organization-okr/server.ts · 표 organization_okr(s2_0050). */
export async function POST(request: Request) {
  return sameOriginJsonPost(request, 200000, "organization-okr", async (body) => ({ version: await saveOkr(body) }));
}

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try { return NextResponse.json({ history: await okrHistory(new URL(request.url).searchParams.get("id") ?? "") }, { headers }); }
  catch { return NextResponse.json({ error: "기록 또는 열람 권한을 확인해 주세요" }, { status: 403, headers }); }
}
