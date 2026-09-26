import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureOptedIn } from "@/lib/license/server";
import { reportError } from "@/lib/observability/report-error";
import {
  decodeCursor,
  isAuthorized,
  nextCursorFor,
  NO_STORE_HEADERS,
  type ProgressResponse,
} from "@/features/integrations/todays-math/contract";
import { fetchProgressPage } from "@/features/integrations/todays-math/service";

/**
 * 오늘의수학 연계 — 진도 피드. **읽기 전용, Bearer TODAYS_MATH_API_KEY 전용.**
 *
 * 증분(since)이 **일부러 없다** — 보고서의 85.6% 가 수업일 이틀 뒤 이후 작성이고
 * `updated_at` 이 없어 어떤 증분 기준도 늦게 쓴 보고서를 영영 놓친다(실측
 * 2026-08-21). 항상 전량을, (report_date, created_at, id) ASC 고정 정렬로,
 * 500행 페이지로 준다. 소비자는 순서대로 적용하고 (보고서, 단원) 멱등 upsert
 * + 매일 전량 재실행으로 수렴한다.
 *
 * 커서는 불투명 토큰(contract.ts) — 못 읽으면 400. 조용히 처음부터 다시 주면
 * 소비자는 «중복 전량»을 받고도 성공으로 읽는다.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const key = process.env.TODAYS_MATH_API_KEY;
  if (!key) {
    // 키 미설정 = **기능이 꺼진 것**(503). 401 과 구분한다 — 같으면 소비자가
    // «내 키가 틀렸다»와 «아직 배포가 안 됐다»를 못 가른다(상담 반출 선례).
    return NextResponse.json({ error: "not configured" }, { status: 503, headers: NO_STORE_HEADERS });
  }
  if (!isAuthorized(req.headers.get("authorization"), key)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  }
  const tenantId = process.env.TODAYS_MATH_TENANT_ID;
  if (!tenantId) {
    return NextResponse.json({ error: "tenant not configured" }, { status: 503, headers: NO_STORE_HEADERS });
  }
  // 지점 스위치(슈퍼관리자 '오늘의 수학 연결', 기본 꺼짐) — 끈 지점의 명단·진도는 나가지 않는다(원장 2026-09-26).
  // 키가 맞아도 막는다: 연결을 끊는 곳이 한 군데(스위치)여야 한다. 503 = "꺼진 것"(키 오류 401과 구분 — 위와 같은 규약).
  if (!(await isFeatureOptedIn(tenantId, "todays_math"))) {
    return NextResponse.json({ error: "disabled for tenant" }, { status: 503, headers: NO_STORE_HEADERS });
  }

  const offset = decodeCursor(new URL(req.url).searchParams.get("cursor"));
  if (offset === null) {
    return NextResponse.json({ error: "bad cursor" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const { rows, total } = await fetchProgressPage(createAdminClient(), tenantId, offset);
    const body: ProgressResponse = {
      total,
      rows,
      nextCursor: nextCursorFor(offset, rows.length),
    };
    return NextResponse.json(body, { headers: NO_STORE_HEADERS });
  } catch (e) {
    reportError(e, { scope: "integrations.todays-math", step: "progress" });
    return NextResponse.json({ error: "progress 조회 실패" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
