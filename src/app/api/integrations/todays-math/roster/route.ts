import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { isAuthorized, NO_STORE_HEADERS, type RosterResponse } from "@/features/integrations/todays-math/contract";
import { fetchRoster } from "@/features/integrations/todays-math/service";

/**
 * 오늘의수학 연계 — 명단. **읽기 전용, Bearer TODAYS_MATH_API_KEY 전용.**
 *
 * 활성 수학반 재원생 전부(전 학년 — 거르는 곳은 소비자의 출제 게이트다).
 * 연락처·성적·상담·수납은 주지 않는다. `total` 은 소비자의 «다 받았나» 검증용.
 *
 * 캐시 금지 — 학생 명단이라 CDN·프록시 어디에도 남으면 안 된다(force-dynamic 은
 * Next 캐시를, no-store 헤더는 그 밖을 막는다).
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
    // 테넌트 미설정 = 무엇을 줄지 정해지지 않은 것. 조용히 전체를 주는 쪽으로
    // 내려가면 안 된다 — admin 클라이언트는 RLS 를 우회한다.
    return NextResponse.json({ error: "tenant not configured" }, { status: 503, headers: NO_STORE_HEADERS });
  }

  try {
    const students = await fetchRoster(createAdminClient(), tenantId);
    const body: RosterResponse = {
      generatedAt: new Date().toISOString(),
      total: students.length,
      students,
    };
    return NextResponse.json(body, { headers: NO_STORE_HEADERS });
  } catch (e) {
    reportError(e, { scope: "integrations.todays-math", step: "roster" });
    return NextResponse.json({ error: "roster 조회 실패" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
