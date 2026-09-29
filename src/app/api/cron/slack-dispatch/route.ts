import { bearerMatches } from "@/lib/http/secret-compare";
import { NextResponse } from "next/server";
import { reportError } from "@/lib/observability/report-error";
import { drainAll } from "@/features/slack/server/dispatch";

/**
 * 슬랙 발송기 cron — **1분마다**(Vercel Pro). 앱 경로는 응답 뒤 `pokeSlack`이 이미 보냈고, 이 cron은
 * 워커·DB 트리거·스크립트가 넣은 사건, 재시도, 방해금지·요약 시각이 된 묶음을 맡는다(codex·grok 합의 2026-09-28).
 * 지점마다 리스를 잡으므로 poke와 겹쳐도 한 곳만 돈다. 연결된 지점이 없으면 조회 한 번으로 끝난다.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !bearerMatches(auth, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await drainAll());
  } catch (e) {
    reportError(e, { scope: "cron.slack-dispatch" });
    return NextResponse.json({ error: "slack dispatch failed" }, { status: 500 });
  }
}
