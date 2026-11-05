import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getShellView } from "@/lib/auth/view-mode";
import { getClassnoteMatchVersion, loadClassnoteMatch } from "@/features/onescreen/server/classnote-match";
import { pickCnForRoster } from "@/features/onescreen/classnote-match";
import { parseCnLiveQuery, type CnLiveResponse } from "@/features/onescreen/classnote-match-live";
import { reportError } from "@/lib/observability/report-error";

/**
 * 원스크린 C.N 아이콘 **새로고침 없는 갱신**(GET) — 원장 2026-11-04 *"선생님이 여전히 새로고침하지않으면 '미매칭'인 상태를 보고 있네"*.
 * 원스크린이 화면이 보일 때만 60초마다(동기화를 요청한 직후엔 15초마다) 부른다(classnote-match-live.ts).
 *
 *  · `known` = 화면이 쥔 버전. 서버는 매칭 표 **버전만** 가볍게 보고(행을 받지 않는다) 같으면 버전만 돌려준다.
 *  · 다르면 페이지 첫 렌더와 **같은 함수**(`loadClassnoteMatch` → `pickCnForRoster`)로 그 날짜·그 반들 몫을 만들어 준다.
 *  · 전체 조회가 실패하면 지도를 주지 않는다 — 일시 오류로 화면의 아이콘이 통째로 사라지지 않게(화면은 지난 값 그대로).
 *
 * 🔴 왜 서버 액션이 아니라 라우트인가: 저절로 도는 조회는 라우터 작업 큐를 지나면 안 된다(gotchas #137 — 벨과 같은 결).
 * 게이트 = 페이지와 같다(로그인 · 강사 화면). 조회는 사용자 클라이언트(RLS — 그 지점 행만). `classes`는 화면이 지금 그린 반이다 —
 * 남의 반 id를 적어도 RLS가 이미 보여 주는 범위(지점 단위 읽기 정책) 밖은 나오지 않는다. 사람마다 다른 응답이라 캐시 금지.
 * ⚠️ `/api`는 proxy 매처 밖이다 — 세션 확인은 getCurrentUser(getClaims)가 한다(벨 라우트와 같다).
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  const q = parseCnLiveQuery(new URL(request.url).searchParams);
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ version: null } satisfies CnLiveResponse, { status: 401, headers: NO_STORE });
    if ((await getShellView()) !== "teacher") {
      return NextResponse.json({ version: null } satisfies CnLiveResponse, { status: 403, headers: NO_STORE });
    }
    const version = await getClassnoteMatchVersion();
    if (version === null || version === q.known) return NextResponse.json({ version } satisfies CnLiveResponse, { headers: NO_STORE });
    const loaded = await loadClassnoteMatch(q.date);
    if (loaded.map.version === undefined) return NextResponse.json({ version: null } satisfies CnLiveResponse, { headers: NO_STORE });
    const body: CnLiveResponse = { version: loaded.map.version, map: pickCnForRoster(loaded, q.classIds) };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.onescreen.classnote-match" });
    return NextResponse.json({ version: null } satisfies CnLiveResponse, { status: 500, headers: NO_STORE });
  }
}
