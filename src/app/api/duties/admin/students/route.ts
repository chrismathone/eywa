import { NextResponse } from "next/server";
import { kstToday } from "@/lib/date-kst";
import { getDutyAdminViewer } from "@/features/duties/server/admin-gate";
import { loadDutyStudents } from "@/features/duties/server/admin";
import { DUTY_KIND_KEYS } from "@/features/duties/kinds";
import { adminRange, parseAdminPeriod, periodsOf } from "@/features/duties/view-admin";
import { reportError } from "@/lib/observability/report-error";

/**
 * 학생 × 반 × 종류 집계(GET) — 매트릭스 칸·반 줄을 눌렀을 때(드릴다운)와 '학생별' 보기. 주소의 값은 믿지 않는다(uuid 모양 · 종류 목록).
 * 문·과목 범위는 `/api/duties/admin`과 같다.
 */
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | null) => (v && UUID.test(v) ? v : null);

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const today = kstToday();
  const period = parseAdminPeriod(q.get("period"), today);
  const kindRaw = q.get("kind");
  const kind = kindRaw && (DUTY_KIND_KEYS as readonly string[]).includes(kindRaw) ? kindRaw : null;
  try {
    const viewer = await getDutyAdminViewer();
    if (!viewer) return NextResponse.json({ error: "권한이 없습니다" }, { status: 403, headers: NO_STORE });
    const range = adminRange(period, today);
    // 과목 칩 = 학원 설정에 있는 과목 키만(아무 글자나 과목 조건으로 넘기지 않는다).
    const subjectRaw = q.get("subject");
    // 🔴 설정에 없는 키('기타 과목' 줄)도 그 과목으로 좁힌다 — 조건을 떼면 그 담당의 전 과목이 섞인다(리뷰 2026-11-10). 값은 과목 키 모양만 받고, 범위는 RPC의 p_subjects가 다시 건다.
    const subjectNone = subjectRaw === "none";
    const subject = subjectRaw && !subjectNone && /^[a-z0-9_]{1,40}$/.test(subjectRaw) ? subjectRaw : null;
    const ownerNone = q.get("owner") === "none";
    const data = await loadDutyStudents(viewer.user.tenantId, range.from, range.to, viewer.scope, periodsOf(period), { owner: uuidOrNull(q.get("owner")), ownerNone, kind, classId: uuidOrNull(q.get("class")), subject, subjectNone, studentId: uuidOrNull(q.get("student")) });
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.duties.admin.students" });
    return NextResponse.json({ error: "학생별 업무를 불러오지 못했습니다" }, { status: 500, headers: NO_STORE });
  }
}
