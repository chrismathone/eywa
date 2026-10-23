import { NextResponse } from "next/server";
import { isCellMemoSubject, isMondayYmd } from "@/features/timetable-cell-memo/rules";
import { loadWeekCellMemos } from "@/features/timetable-cell-memo/server/store";
import { memoSheetAccess } from "@/features/timetable-memo/server/access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { reportError } from "@/lib/observability/report-error";

/**
 * 시간표 칸 메모 조회(GET) — 영어 강사뷰가 **시간표가 뜬 뒤** 그 주 메모만 따로 읽는다(첫 그림을 막지 않게, B7).
 * 마운트·주 이동·창 포커스·다른 사람의 저장 신호(broadcast)에서 부른다.
 *
 * 🔴 서버 액션이 아니라 라우트인 이유: 저절로 도는 조회를 서버 액션으로 부르면 라우터 작업 큐와 엉킨다(gotchas #137).
 * 🔴 문 = 화면·저장과 같은 `memoSheetAccess`(#77) — 보기 = 시간표 열람 · 강사 화면 없음. 지점은 세션의 지점만(남의 지점 메모가 나올 길 없음).
 * 🔴 표가 아직 없으면(0395a 미적용) `unavailable` — 화면은 메모 없이 그대로다([[#95]]).
 * 응답은 사람·시점마다 다르므로 캐시 금지(`no-store`).
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const subject = params.get("subject") ?? "";
  const week = params.get("week") ?? "";
  if (!isCellMemoSubject(subject) || !isMondayYmd(week)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
    if (!(await memoSheetAccess(user)).canView) {
      return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
    }
    return NextResponse.json(await loadWeekCellMemos(user.tenantId, subject, week), { headers: NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.timetable.cellMemos", subject, week });
    return NextResponse.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}
