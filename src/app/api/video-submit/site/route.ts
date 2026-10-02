import { NextResponse } from "next/server";
import { pickClientIp } from "@/features/audit/server/login-log";
import { lookupSite, openSiteLink } from "@/features/video-submit/server/site";

/**
 * 숙제 영상 올리기 사이트(`/v`, 0330a) — 뒷 4자리 조회(`op: "lookup"`)와 고른 후보의 링크 열기(`op: "open"`).
 * 로그인 없음: 서버가 지점(Drive가 묶인 지점)·학생·반을 정하고, 시도 횟수를 IP 해시로 제한한다(원본 IP는 저장하지 않는다).
 * 라우트 핸들러인 이유는 제출 링크와 같다 — 주소가 고정이라 배포가 바뀌어도 열어 둔 화면이 길을 잃지 않는다.
 * 🔴 응답엔 학생·반 번호를 싣지 않는다(이름은 가운데를 가린다). 실패 원문도 싣지 않는다.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { op?: unknown; last4?: unknown; choice?: unknown } | null;
  // 플랫폼이 강제로 세팅하는 헤더를 먼저 본다 — `x-forwarded-for`의 첫 값은 앞단 구성에 따라 클라이언트가 지어낼 수 있다.
  const ip = pickClientIp(request.headers);
  const result = body?.op === "open"
    ? await openSiteLink({ last4: body.last4, choice: body.choice, ip })
    : await lookupSite({ last4: body?.last4, ip });
  return NextResponse.json(result, { status: !result.ok && result.code === "limit" ? 429 : 200, headers: { "Cache-Control": "no-store" } });
}
