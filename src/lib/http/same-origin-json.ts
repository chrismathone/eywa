import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * 같은 출처에서 온 JSON 저장 요청만 받는 라우트 공용 껍데기(업무 작성센터 · 관찰 기록 · 조직·OKR · 스키마 스튜디오 · 2026-11-11).
 * - 출처가 다르면 403(다른 사이트가 로그인 쿠키로 저장을 일으키지 못하게).
 * - 본문이 `maxBytes`를 넘으면 나눠 저장하라는 안내(400) · 입력 검사 실패는 한글 안내(원문 코드를 화면에 내지 않는다).
 * - 저장 함수가 던진 한글 오류는 그대로 화면에 · 그 밖은 일반 문구 + 서버 로그.
 */
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function sameOriginJsonPost<T>(request: Request, maxBytes: number, scope: string, handle: (body: unknown) => Promise<T>) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "요청 출처를 확인해 주세요" }, { status: 403, headers: NO_STORE });
  try {
    const text = await request.text();
    if (text.length > maxBytes) return NextResponse.json({ error: "기록을 나누어 저장해 주세요" }, { status: 400, headers: NO_STORE });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "요청 내용을 확인해 주세요" }, { status: 400, headers: NO_STORE }); }
    return NextResponse.json(await handle(body), { headers: NO_STORE });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const own = e.issues.find((i) => /[가-힣]/.test(i.message))?.message; // 스키마가 직접 적은 한글 안내만 — zod 기본 영문은 내지 않는다
      return NextResponse.json({ error: own ?? "필수 항목과 입력 길이를 확인해 주세요" }, { status: 400, headers: NO_STORE });
    }
    const message = e instanceof Error && /[가-힣]/.test(e.message) ? e.message : "저장하지 못했습니다";
    if (message === "저장하지 못했습니다") console.error(`[${scope}]`, e);
    return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE });
  }
}
