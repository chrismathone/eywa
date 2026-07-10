import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { resolveEywaIdByEdutrixId } from "@/features/report-admin/edutrix-match";

/**
 * Edutrix 수업보고서 → lesson_reports 증분 동기화 cron.
 * ⚠️ 매칭 = students.edutrix_student_id ↔ reports.student_id (UUID). 이름 fan-out 금지(0094a).
 * 멱등 = edutrix_report_id (Edutrix reports.id). 미매핑 학생 보고서는 skip+카운트.
 */
export const dynamic = "force-dynamic";

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const OVERLAP_DAYS = 7;
const INSERT_CHUNK = 500;

function extractTeacher(className: string | null): string | null {
  if (!className) return null;
  const first = className.split(/[\s_]+/)[0] || "";
  const ex: Record<string, string> = { 김정은: "김은정" };
  return ex[first] || first || null;
}

type NameRef = { name: string } | { name: string }[] | null;
type EdutrixReport = {
  id: string;
  date: string;
  student_id: string | null;
  progress: string | null;
  exam_info: string | null;
  assignment_score: string | null;
  classes: NameRef;
};
const one = (v: NameRef): { name: string } | null => (Array.isArray(v) ? (v[0] ?? null) : v);

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

    const [eduRows, mappedStudents, existingReportIds] = await Promise.all([
      fetchAllPaged<EdutrixReport>((from, to) =>
        edu
          .from("reports")
          .select("id, date, student_id, progress, exam_info, assignment_score, classes(name)")
          .gte("date", windowStart)
          .order("date", { ascending: false })
          .range(from, to),
      ),
      fetchAllPaged<{ id: string; edutrix_student_id: string }>((from, to) =>
        admin
          .from("students")
          .select("id, edutrix_student_id")
          .eq("tenant_id", TENANT)
          .not("edutrix_student_id", "is", null)
          .range(from, to),
      ),
      fetchAllPaged<{ edutrix_report_id: string }>((from, to) =>
        admin
          .from("lesson_reports")
          .select("edutrix_report_id")
          .eq("tenant_id", TENANT)
          .eq("source", "edutrix_import")
          .not("edutrix_report_id", "is", null)
          .gte("report_date", windowStart)
          .range(from, to),
      ),
    ]);

    const byEdutrixId = new Map(
      mappedStudents.map((s) => [s.edutrix_student_id, s.id] as const),
    );
    const seenReportIds = new Set(
      existingReportIds.map((r) => r.edutrix_report_id).filter(Boolean),
    );

    const rows: Record<string, unknown>[] = [];
    let unmatchedStudents = 0;
    let skippedExisting = 0;
    for (const rep of eduRows) {
      if (!rep.id || !rep.student_id) continue;
      if (seenReportIds.has(rep.id)) {
        skippedExisting++;
        continue;
      }
      const eywaId = resolveEywaIdByEdutrixId(rep.student_id, byEdutrixId);
      if (!eywaId) {
        unmatchedStudents++;
        continue;
      }
      seenReportIds.add(rep.id);
      const teacher = extractTeacher(one(rep.classes)?.name ?? null);
      rows.push({
        tenant_id: TENANT,
        student_id: eywaId,
        report_date: rep.date,
        progress: rep.progress || null,
        exam_info: rep.exam_info || null,
        homework_score: rep.assignment_score || null,
        teacher_name: teacher,
        source: "edutrix_import",
        edutrix_report_id: rep.id,
      });
    }

    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const { error } = await admin.from("lesson_reports").insert(rows.slice(i, i + INSERT_CHUNK));
      if (error) throw new Error(`lesson_reports insert: ${error.message}`);
    }

    return NextResponse.json({
      ok: true,
      windowStart,
      edutrixRows: eduRows.length,
      mappedStudents: byEdutrixId.size,
      inserted: rows.length,
      skippedExisting,
      unmatchedStudents,
    });
  } catch (e) {
    reportError(e, { scope: "cron.edutrix-sync" });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
