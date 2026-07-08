import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";

/**
 * Edutrix 수업보고서 → lesson_reports 증분 동기화 cron — Vercel cron이 매일 호출(vercel.json).
 * 학생 상세 '진도' 탭·시간표 hover "[진도]"·원스크린 로스터가 읽는 lesson_reports(edutrix_import)를
 * 자동 최신화한다(전엔 수동 스크립트만 있어 6/30에 멈춰 있었음 — 2026-07-09).
 *
 * Edutrix는 정식 Supabase API(anon read)라 makeedu와 달리 신뢰 IP·동기화 PC가 필요 없다 →
 * Vercel에서 직접. 인증·형태는 reconcile-transcriptions cron과 동일(Bearer CRON_SECRET).
 *
 * 증분 append(윈도우 겹침 + 중복 스킵) — 전체 delete+reinsert가 아니라서 활동로그(0084a 트리거)에
 * 쏟는 시스템 행이 "진짜 새 보고서" 수십 건 수준(invoices makeedu 동기화와 같은 수용 패턴).
 * ⚠️ 한계: Edutrix에서 **기존 보고서를 수정**한 건 여기로 전파 안 됨(중복 키에 내용 미포함) —
 * 정합 재구축이 필요하면 전체 리로드 스크립트(scripts/_poc_migration/import-lesson-reports.cjs) 실행.
 */
export const dynamic = "force-dynamic";

// 단일 테넌트 운영(injaewon) — import-lesson-reports.cjs와 동일 상수. 멀티테넌트화 시 user_integrations로 승격.
const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
// 늦게 입력된 보고서(며칠 지난 날짜로 backfill)를 놓치지 않는 겹침 윈도우.
const OVERLAP_DAYS = 7;
const INSERT_CHUNK = 500;

// Edutrix class_name 첫 토큰 = 담당 강사(import-lesson-reports.cjs extractTeacher와 동일 규칙 유지).
function extractTeacher(className: string | null): string | null {
  if (!className) return null;
  const first = className.split(/[\s_]+/)[0] || "";
  const ex: Record<string, string> = { 김정은: "김은정" };
  return ex[first] || first || null;
}

// students/classes 조인: supabase-js가 스키마 타입 없이는 배열로 추론하나 실제(many-to-one)는 객체 —
// 둘 다 수용하고 one()으로 정규화.
type NameRef = { name: string } | { name: string }[] | null;
type EdutrixReport = {
  date: string;
  progress: string | null;
  exam_info: string | null;
  assignment_score: string | null;
  students: NameRef;
  classes: NameRef;
};
const one = (v: NameRef): { name: string } | null => (Array.isArray(v) ? (v[0] ?? null) : v);

const dedupKey = (studentId: string, date: string, teacher: string | null) =>
  `${studentId}|${date}|${teacher ?? ""}`;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const eduUrl = process.env.EDUTRIX_SUPABASE_URL;
  const eduKey = process.env.EDUTRIX_SUPABASE_ANON_KEY;
  if (!eduUrl || !eduKey) {
    return NextResponse.json(
      { error: "EDUTRIX_SUPABASE_URL / EDUTRIX_SUPABASE_ANON_KEY 미설정" },
      { status: 500 },
    );
  }

  try {
    const admin = createAdminClient();
    const edu = createSupabaseClient(eduUrl, eduKey);

    // 워터마크: 기존 이식본의 최신 보고일 − 겹침. 행이 없으면 전체(최초 실행 = 풀 이식과 동일).
    const { data: latest } = await admin
      .from("lesson_reports")
      .select("report_date")
      .eq("tenant_id", TENANT)
      .eq("source", "edutrix_import")
      .order("report_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const windowStart = latest
      ? new Date(new Date(latest.report_date as string).getTime() - OVERLAP_DAYS * 86_400_000)
          .toISOString()
          .slice(0, 10)
      : "2000-01-01";

    // 독립 3조회 병렬(B4): Edutrix 윈도우 보고서 / eywa 학생 이름맵 / 윈도우 내 기존 이식 행(중복 스킵용).
    // 전부 fetchAllPaged — 1000행 silent 절단 방지(B2).
    const [eduRows, students, existing] = await Promise.all([
      fetchAllPaged<EdutrixReport>((from, to) =>
        edu
          .from("reports")
          .select("date, progress, exam_info, assignment_score, students(name), classes(name)")
          .gte("date", windowStart)
          .order("date", { ascending: false })
          .range(from, to),
      ),
      fetchAllPaged<{ id: string; name: string }>((from, to) =>
        admin.from("students").select("id, name").eq("tenant_id", TENANT).range(from, to),
      ),
      fetchAllPaged<{ student_id: string; report_date: string; teacher_name: string | null }>(
        (from, to) =>
          admin
            .from("lesson_reports")
            .select("student_id, report_date, teacher_name")
            .eq("tenant_id", TENANT)
            .eq("source", "edutrix_import")
            .gte("report_date", windowStart)
            .range(from, to),
      ),
    ]);

    const byName = new Map<string, string[]>();
    for (const s of students) {
      const arr = byName.get(s.name) ?? [];
      arr.push(s.id);
      byName.set(s.name, arr);
    }
    const seen = new Set(existing.map((r) => dedupKey(r.student_id, r.report_date, r.teacher_name)));

    const rows: Record<string, unknown>[] = [];
    let unmatchedNames = 0;
    let skippedExisting = 0;
    for (const rep of eduRows) {
      const name = one(rep.students)?.name;
      if (!name) continue;
      const ids = byName.get(name);
      if (!ids) {
        unmatchedNames++;
        continue;
      }
      const teacher = extractTeacher(one(rep.classes)?.name ?? null);
      for (const sid of ids) {
        const key = dedupKey(sid, rep.date, teacher);
        if (seen.has(key)) {
          skippedExisting++;
          continue;
        }
        seen.add(key); // 같은 응답 안 중복(동일 날짜·강사 재행)도 1회만
        rows.push({
          tenant_id: TENANT,
          student_id: sid,
          report_date: rep.date,
          progress: rep.progress || null,
          exam_info: rep.exam_info || null,
          homework_score: rep.assignment_score || null,
          teacher_name: teacher,
          source: "edutrix_import",
        });
      }
    }

    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const { error } = await admin.from("lesson_reports").insert(rows.slice(i, i + INSERT_CHUNK));
      if (error) throw new Error(`lesson_reports insert: ${error.message}`);
    }

    return NextResponse.json({
      ok: true,
      windowStart,
      edutrixRows: eduRows.length,
      inserted: rows.length,
      skippedExisting,
      unmatchedNames,
    });
  } catch (e) {
    reportError(e, { scope: "cron.edutrix-sync" });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
