"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/observability/report-error";
import { VIEW_RESET_PATH } from "@/lib/auth/view-preference";

/**
 * 최후의 오류 경계 — **루트 레이아웃이 던졌을 때**만 여기까지 온다(그 위엔 아무것도 없다).
 *
 * 🔴 이 컴포넌트는 루트 레이아웃을 **대체**하므로 `<html>`·`<body>`를 직접 그려야 한다. 그래서
 *    앱의 CSS 토큰(폰트·색 변수)에 기댈 수 없고, 여기서만 인라인 스타일을 쓴다(디자인 규약의 예외).
 * ⚠️ 개발 중에는 Next의 오류 오버레이가 먼저 뜨므로 이 화면은 **프로덕션에서만** 보인다.
 * ⚠️ 평소 화면 오류는 `(shell)/error.tsx`가 받는다 — 여기까지 오면 셸 자체(인증·설정 조회)가 깨진 것이다.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError(error, { scope: "app.globalError", digest: error.digest });
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f4f4f1",
          color: "#121212",
          fontFamily:
            "Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            padding: "40px 24px",
            textAlign: "center",
            background: "#ffffff",
            borderRadius: 16,
            boxShadow: "0 0 0 1px rgba(29,29,31,0.14)",
          }}
        >
          <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>에이와를 여는 데 문제가 생겼습니다</p>
          <p style={{ marginTop: 8, fontSize: 14, color: "#121212" }}>
            잠시 뒤 다시 시도해 주세요. 계속 같은 화면이면 원장님께 알려 주세요.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 20,
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 600,
              color: "#ffffff",
              background: "#363c41",
              border: "none",
              borderRadius: 10,
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
          <p style={{ marginTop: 16, fontSize: 14 }}>
            <a href={VIEW_RESET_PATH} target="_top" style={{ color: "#363c41", textDecoration: "underline" }}>
              원래 화면으로 돌아가기
            </a>
          </p>
          {error.digest ? (
            <p style={{ marginTop: 16, fontSize: 11, color: "#121212" }}>오류 번호 {error.digest}</p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
