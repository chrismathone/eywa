import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ManagementAccessError } from "./access";
import { managementErrorMessage } from "../errors";

/** 경영 분석 API 공용 — 응답은 저장하지 않는다(no-store). 쿠키 인증 변경 요청은 이 앱에서 온 것만 받는다. */
export const noStore = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export const sameOrigin = (request: Request) => request.headers.get("origin") === new URL(request.url).origin;
export const forbidden = () => noStore({ error: "접근 권한을 확인해 주세요" }, 403);
export const wrongOrigin = () => noStore({ error: "요청 출처를 확인해 주세요" }, 403);

/** 권한 오류는 403, 입력 오류(한국어 문구)는 400, 그 밖(라이브러리·DB 원문)은 일반 안내 + 서버 로그. */
export function failure(e: unknown, scope: string, zodMessage: string, fallback: string) {
  if (e instanceof ManagementAccessError) return forbidden();
  if (e instanceof z.ZodError || e instanceof SyntaxError) return noStore({ error: zodMessage }, 400);
  const message = managementErrorMessage(e, "");
  if (!message) console.error(`[${scope}]`, e);
  return noStore({ error: message || fallback }, message ? 400 : 500);
}
