import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";
import { VIEW_RESET_PATH } from "@/lib/auth/view-preference";

/**
 * 미들웨어 세션 갱신(표준 @supabase/ssr 패턴) — **지속 로그인의 핵심**.
 *
 * 매 요청마다 server client로 `getClaims()`를 불러 (만료 임박) 토큰을 refresh하고, 그 refresh가
 * 발화하는 `setAll`로 **갱신된 auth 쿠키를 응답(Set-Cookie)에 실어** 브라우저에 되돌린다. 동시에
 * `request.cookies.set`으로 **요청 헤더도 갱신**해 `NextResponse.next({ request })`가 그 갱신 쿠키를
 * 다운스트림(같은 요청의 (shell)/layout getCurrentUser)에 전달 → RSC가 refresh된 토큰을 읽어
 * **이중 refresh(회전 토큰 재제출) 없음**. Server Component는 쿠키를 못 써서(server.ts setAll no-op)
 * 이 미들웨어가 유일하게 쿠키를 갱신·지속한다. 없으면 @supabase/ssr가 경고하는
 * "random logouts / early session termination"이 난다(탭 재오픈 로그아웃).
 *
 * ⚠️ **canonical 패턴 준수**: 변경된 `request`(쿠키·x-embed 헤더가 반영된)를 통째로 forward한다.
 * 헤더를 미리 복제(new Headers)해 넘기면 request.cookies.set이 그 복제본을 안 건드려 **stale 쿠키가
 * RSC로 전달**되는 잠복 레이스가 생긴다(적대리뷰 확정) → 반드시 request.headers를 직접 변형 + `{ request }` forward.
 *
 * ⚠️ 인증 게이트(리다이렉트)는 여전히 **쿠키 존재 여부**로만 판정한다 — getClaims 결과로 판정하지 않는다.
 * 과거(#10) middleware `getUser()`가 base64 쿠키 검증에 실패해 정상 로그인을 /login으로 튕겨 **로그인 루프**가
 * 났었다. getClaims 결과에 게이트를 걸지 않으면(존재 체크 + try/catch) 그 루프가 재발하지 않는다.
 * 진짜 검증은 (shell)/layout의 getCurrentUser가 담당(만료 쿠키면 그때 /login).
 */

// Paths that the marketing landing serves — accessible without auth
const PUBLIC_PATHS = new Set(["/"]);

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // 현재 경로를 x-pathname 요청 헤더로 승격 — (shell)/layout이 await headers()로 읽어 **뷰-경로 정합성 가드**에
  // 쓴다(RSC 레이아웃은 pathname을 직접 못 받음, gotchas #29). 강사 뷰에서 관리자 페이지가 미니셸로 감싸지는
  // 것을 막는다. ⚠️ request.headers를 직접 변형해야 아래 NextResponse.next({ request }) forward에 함께 실린다.
  request.headers.set("x-pathname", pathname);

  const isPublicAsset = pathname.startsWith("/_next") || pathname === "/favicon.ico";
  // /api/* 라우트 (webhook 포함)는 자체 인증 (시크릿 헤더 등) 사용 — 세션 갱신 불필요.
  const isApiRoute = pathname.startsWith("/api/");
  // 복구는 뷰 쿠키만 지우는 공개 경로다. 만료된 세션·인증 조회 장애도 출구를 막으면 안 된다.
  if (isPublicAsset || isApiRoute || pathname === VIEW_RESET_PATH) {
    return NextResponse.next({ request });
  }

  // Stage Manager가 메뉴를 임베드할 때 붙이는 ?embed=1을 x-embed 요청 헤더로 승격.
  // (shell)/layout이 await headers()로 읽어 사이드바/헤더 없는 크롬리스로 렌더한다.
  // ⚠️ request.headers를 직접 변형해야 아래 `NextResponse.next({ request })` forward에 함께 실린다.
  if (request.nextUrl.searchParams.get("embed") === "1") {
    request.headers.set("x-embed", "1");
  }

  // ── 세션 갱신: getClaims가 refresh를 유발하면 setAll이 갱신 쿠키를 요청·응답 양쪽에 반영한다. ──
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // 요청 쿠키 갱신(=request.headers 변형) → 같은 요청의 RSC가 refresh된 토큰을 읽음.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          // 변경된 request를 통째로 forward(canonical) + 응답 Set-Cookie(브라우저용).
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  try {
    // 로컬 JWT 검증(getCurrentUser와 동일) — 만료 임박이면 refresh → setAll이 갱신 쿠키를 요청·응답에 실음.
    // 결과값은 게이트에 쓰지 않는다(위 #10 루프 회피). 검증 불가(콜드/비호환)면 쿠키 보존한 채 통과.
    await supabase.auth.getClaims();
  } catch {
    // no-op — 게이트는 아래 쿠키 존재 체크라 세션이 살아있으면 통과, 죽었으면 layout이 /login.
  }

  const isAuthRoute = pathname.startsWith("/login");
  if (isAuthRoute) {
    return response;
  }

  // Public routes (marketing landing) — let everyone through.
  //
  // /kiosk* (무인 출석 키오스크)도 비로그인 통과 — 실제 보안은 디바이스 토큰(httpOnly 쿠키)으로
  // 페이지·API가 직접 검증한다. ⚠️ "/kiosk"·"/kiosk/…"만 공개. "/kiosk-settings"(원장 전용,
  // (shell))는 startsWith에 걸리지 않도록 정확/슬래시 매칭으로 제외한다.
  const isKioskPublic = pathname === "/kiosk" || pathname.startsWith("/kiosk/");
  // /intake/* (학부모 QR 공개 접수)도 비로그인 통과 — 실제 보안은 접수 토큰을 페이지·서버액션이
  // admin client로 직접 검증한다(토큰이 테넌트를 해석). "/intake"·"/intake/…"만 공개.
  const isIntakePublic = pathname === "/intake" || pathname.startsWith("/intake/");
  // /r/* (학부모 공개 수업 보고서 링크)도 비로그인 통과 — 실제 보안은 share_token을 페이지가 admin
  // client로 단건 조회해 검증한다(전역 유니크 토큰이 테넌트를 해석). "/r"·"/r/…"만 공개.
  const isReportPublic = pathname === "/r" || pathname.startsWith("/r/");
  // /v/* (숙제 영상 제출 링크, 0325a) — 학부모가 로그인 없이 연다. 보안은 페이지·업로드 라우트가 토큰(해시 조회·7일·끊김)을
  // admin client로 직접 검증한다(토큰이 지점·학생·반을 정한다). "/v"·"/v/…"만 공개.
  const isVideoSubmitPublic = pathname === "/v" || pathname.startsWith("/v/");
  // /staff-intake/* (직원 등록 QR)도 비로그인 통과 — 보안은 등록 토큰(활성·만료·상한)을 페이지와
  // 서버액션이 admin client로 직접 검증한다. ⚠️ "/staff-intake"·"/staff-intake/…"만 — "/staff"(직원관리,
  // 사무실 전용)는 여기 걸리면 안 되므로 정확/슬래시 매칭이다.
  const isStaffIntakePublic = pathname === "/staff-intake" || pathname.startsWith("/staff-intake/");
  // /seat/* (랩실 공개 출석부) — 비로그인 통과. 실제 보안은 PIN httpOnly 쿠키.
  // ⚠️ "/seat"·"/seat/…"만. "/attendance/seat"(로그인 셸)은 여기 걸리면 안 된다.
  const isSeatPublic = pathname === "/seat" || pathname.startsWith("/seat/");
  // /academy/* (학원 공개 랜딩 — 관객은 학부모)도 비로그인 통과. 읽기 전용 홍보면이라
  // 보호할 데이터가 없다(학원명만 getPublicBranding으로 읽는다).
  // ⚠️ "/academy"·"/academy/…"만 — 정확/슬래시 매칭으로 다른 경로가 딸려오지 않게 한다.
  const isAcademyPublic = pathname === "/academy" || pathname.startsWith("/academy/");
  // /inventory/asset/* (기기에 붙은 QR 라벨이 가리키는 자산 상세) — 비로그인 통과. 원장 2026-09-03
  // *"seat/jj처럼 비로그인자도 볼 수 있게"*. 읽기 전용 화면이고 쓰기 경로는 하나도 안 딸려 온다.
  // 🔴 **이 한 갈래만 연다** — `/inventory`(목록)·`/inventory/qr/print`(라벨 시트)·엑셀·편집 액션은
  //    그대로 로그인+권한이어야 하므로 `"/inventory/asset/"` **접두**로만 매칭한다("/inventory"로 열면
  //    자산 대장 전체가 공개된다). `/api/*`는 위에서 이미 빠지지만 QR 이미지 라우트는 자체 게이트가 있다.
  const isAssetPublic = pathname === "/inventory/asset" || pathname.startsWith("/inventory/asset/");
  // /expired (공용 '링크 만료' 안내, 원장 2026-10-01) — 기간이 지난 학부모 링크(/r·/intake…)가 307로 보내는 곳이라
  // 비로그인 통과가 **필수**다(막히면 만료 링크를 연 학부모가 로그인 화면으로 간다). 안내문뿐이고 데이터·쓰기 경로는 없다.
  // ⚠️ 정확 매칭 — 하위 경로는 없다(`/expired-…` 같은 다른 경로가 딸려오지 않게).
  const isLinkExpiredPublic = pathname === "/expired";
  if (
    PUBLIC_PATHS.has(pathname) ||
    isKioskPublic ||
    isIntakePublic ||
    isReportPublic ||
    isVideoSubmitPublic ||
    isStaffIntakePublic ||
    isSeatPublic ||
    isAcademyPublic ||
    isAssetPublic ||
    isLinkExpiredPublic
  ) {
    return response;
  }

  // Cheap auth gate — 쿠키 존재만 확인(진짜 검증은 layout의 getCurrentUser).
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
  if (!hasAuthCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Restore the exact view/filter after login — keeping only pathname would drop the query.
    url.search = "";
    url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  return response;
}
