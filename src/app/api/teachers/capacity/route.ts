import { NextResponse } from "next/server";
import { z } from "zod";
import { saveTeacherCapacity, TeacherHubError } from "@/features/teacher-hub/server";

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** 강사 통합 기록의 '현재 학생 배정 여력' 저장 — 원장 · 이번 달만(s2_0055). 쿠키 인증 변경이라 이 앱에서 온 요청만 받는다. */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply({ error: "요청 출처를 확인해 주세요" }, 403);
  try {
    const body = await request.text();
    if (body.length > 6000) throw new TeacherHubError("입력 길이를 확인해 주세요");
    return reply({ saved: await saveTeacherCapacity(JSON.parse(body)) });
  } catch (e) {
    if (e instanceof z.ZodError || e instanceof SyntaxError) return reply({ error: "학생 수·근거·기준 월을 확인해 주세요" }, 400);
    if (e instanceof TeacherHubError) return reply({ error: e.message }, e.status);
    console.error("[api/teachers/capacity]", e);
    return reply({ error: "저장하지 못했습니다" }, 500);
  }
}
