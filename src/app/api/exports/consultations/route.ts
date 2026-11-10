import { logExportDownloadAs } from "@/features/exports/server/log-export";
import { secretMatches } from "@/lib/http/secret-compare";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maskName, maskText, pseudonym } from "@/features/consultations/export-masking";
import { visibleConsultationSummary } from "@/features/consultations/internal-link";
import { explainDbError } from "@/lib/supabase/db-error";

// 상담 텍스트 외부 AI 반출 API — 원장의 외부 챗봇("AI 사무실")이 읽는 읽기 전용 엔드포인트.
// 인증: Authorization: Bearer <CONSULT_EXPORT_TOKEN>(env). 미설정 시 503(기능 꺼짐), 불일치 401.
// 개인정보: 전화·주소·생년월일·주민번호 등 원시 PII 필드는 **SELECT 자체를 안 하고**, 본문 속
// 이름·연락처는 export-masking으로 치환한다(학생 식별은 안정 익명 코드 "학생#xxxxxx").
// B2: range 페이지네이션(limit≤200) — 전건 무페이징 fetch 금지.

const MAX_LIMIT = 200;

// select 문자열이 동적(string 타입)이라 supabase가 행 타입을 추론 못 함 — 여기서 명시.
type StudentRow = {
  id: string; student_id: string; consulted_at: string; category: string | null;
  subject: string | null; audience: string | null; summary: string | null; follow_up_action: string | null;
  ai_summary: string | null; transcription?: string | null;
};
type EnrollmentRow = {
  id: string; student_id: string | null; created_at: string; subject: string | null;
  consultation_path: string | null; outcome: string | null; prospect_name: string | null; prospect_grade: string | null;
  parent_name: string | null; parent_request: string | null; transcription?: string | null;
};

/**
 * 테넌트 전 직원 이름 — 상담 본문에 기록자("이현이" 등)·담당 강사 이름이 counselor_id 연결 없이
 * 텍스트로만 등장하는 경우가 많아(makeedu 이관분 실측), 전 직원 이름을 공통 마스킹 목록으로 쓴다.
 */
async function loadStaffNames(admin: ReturnType<typeof createAdminClient>, tenantId: string) {
  const { data, error } = await admin
    .from("users")
    .select("display_name")
    .eq("tenant_id", tenantId)
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((u) => u.display_name as string | null);
}

export async function GET(req: Request) {
  const secret = process.env.CONSULT_EXPORT_TOKEN?.trim();
  if (!secret) return NextResponse.json({ error: "export disabled (CONSULT_EXPORT_TOKEN not set)" }, { status: 503 });
  if (!secretMatches(req.headers.get("authorization"), `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "student"; // student(재원생 상담) | enrollment(등록상담)
  const since = url.searchParams.get("since"); // ISO 날짜 — 이 시각 이후 상담만
  const includeTranscript = url.searchParams.get("include") === "transcript";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), MAX_LIMIT);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  const admin = createAdminClient();
  // 단일 학원 전제 — 테넌트가 정확히 1개일 때만 자동 확정, 2개+면 env 명시 필요(타 학원 오노출 방지).
  const envTenant = process.env.CONSULT_EXPORT_TENANT_ID?.trim();
  let tenantId = envTenant ?? null;
  if (!tenantId) {
    const { data: tenants, error } = await admin.from("tenants").select("id").limit(2);
    if (error || !tenants?.length) return NextResponse.json({ error: "tenant lookup failed" }, { status: 500 });
    if (tenants.length > 1) {
      return NextResponse.json({ error: "multiple tenants — set CONSULT_EXPORT_TENANT_ID" }, { status: 503 });
    }
    tenantId = tenants[0].id as string;
  }

  // 반출 접속기록(보안 감사 2026-09-29) — **호출마다** 남긴다(첫 페이지만 남기면 offset을 1부터 줘서 기록을 피한다).
  // 조건(offset·limit 포함)은 metadata.filters에 원문으로 남는다.
  if (kind === "student" || kind === "enrollment") {
    await logExportDownloadAs(tenantId, "상담 반출 API", req, kind === "student" ? "원생 상담 반출" : "신규 콜&상담 반출");
  }

  if (kind === "student") {
    // select 문자열을 변수(string 타입)로 — 템플릿 리터럴을 인자에 직접 쓰면 supabase 타입 파서가
    // 동적 조각을 파싱 못 해 ParserError 타입이 된다.
    const cols: string = `id, student_id, consulted_at, category, subject, audience, summary, follow_up_action, ai_summary${includeTranscript ? ", transcription" : ""}`;
    let q = admin
      .from("student_consultations")
      .select(cols, { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("consulted_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (since) q = q.gte("consulted_at", since);
    const { data, error, count } = await q;
    if (error) return NextResponse.json({ error: explainDbError(error, { scope: "api.exports.consultations", fallback: "상담 기록을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message }, { status: 500 });
    const rows = (data ?? []) as unknown as StudentRow[];

    // 이름 마스킹 재료 — 관련 학생의 이름·학부모명 + 전 직원 이름. B4: 독립 조회 병렬.
    const ids = [...new Set(rows.map((r) => r.student_id))];
    const [studRes, staffNames] = await Promise.all([
      ids.length
        ? admin.from("students").select("id, name, parent_name").eq("tenant_id", tenantId).in("id", ids) // limit≤200이라 단일 .in 허용
        : Promise.resolve({ data: [], error: null }),
      loadStaffNames(admin, tenantId),
    ]);
    if (studRes.error) return NextResponse.json({ error: explainDbError(studRes.error, { scope: "api.exports.consultations", fallback: "상담 기록을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message }, { status: 500 });
    const nameMap = new Map<string, { name: string | null; parent: string | null }>();
    for (const s of studRes.data ?? []) nameMap.set(s.id as string, { name: s.name, parent: s.parent_name });

    const items = rows.map((r) => {
      const who = nameMap.get(r.student_id);
      const names = [who?.name, who?.parent, ...staffNames];
      return {
        id: r.id,
        kind: "student" as const,
        date: r.consulted_at,
        student: pseudonym(r.student_id),
        studentName: who?.name ? maskName(who.name) : null,
        category: r.category,
        subject: r.subject,
        audience: r.audience,
        text: maskText(visibleConsultationSummary(r.summary ?? ""), names),
        followUpAction: r.follow_up_action ? maskText(r.follow_up_action, names) : null,
        aiSummary: r.ai_summary ? maskText(r.ai_summary, names) : null,
        ...(includeTranscript && r.transcription ? { transcript: maskText(r.transcription, names) } : {}),
      };
    });
    return NextResponse.json({ kind, items, total: count ?? items.length, limit, offset });
  }

  if (kind === "enrollment") {
    const cols: string = `id, student_id, created_at, subject, consultation_path, outcome, prospect_name, prospect_grade, parent_name, parent_request${includeTranscript ? ", transcription" : ""}`;
    let q = admin
      .from("enrollment_consultations")
      .select(cols, { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (since) q = q.gte("created_at", since);
    const { data, error, count } = await q;
    if (error) return NextResponse.json({ error: explainDbError(error, { scope: "api.exports.consultations", fallback: "상담 기록을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message }, { status: 500 });
    const rows = (data ?? []) as unknown as EnrollmentRow[];
    const staffNames = await loadStaffNames(admin, tenantId); // 기록자 이름 마스킹(재원생 상담과 동일 이유)

    const items = rows.map((r) => {
      const names = [r.prospect_name, r.parent_name, ...staffNames];
      return {
        id: r.id,
        kind: "enrollment" as const,
        date: r.created_at,
        student: pseudonym(r.student_id ?? r.id),
        studentName: r.prospect_name ? maskName(r.prospect_name) : null,
        grade: r.prospect_grade,
        subject: r.subject,
        path: r.consultation_path,
        outcome: r.outcome,
        text: maskText(r.parent_request ?? "", names),
        ...(includeTranscript && r.transcription ? { transcript: maskText(r.transcription, names) } : {}),
      };
    });
    return NextResponse.json({ kind, items, total: count ?? items.length, limit, offset });
  }

  return NextResponse.json({ error: "kind must be 'student' or 'enrollment'" }, { status: 400 });
}
