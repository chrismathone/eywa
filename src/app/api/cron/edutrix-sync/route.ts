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
 *
 * 2026-07-10 승격(Edutrix 완전 종료 대비 — scripts/_edutrix_retire/full-import-reports.cjs와 필드 동형):
 *  ① 신규 행을 **리치 필드**로 적재(textbook_name→textbook · study_attitude→attitude ·
 *     notice(AI 학부모 멘트)→notes · makeup_class→makeup · classnote_sent_at→status 'success').
 *  ② 윈도 내 기존 행 **수정 전파**(구버전 한계였던 "Edutrix 수정 미반영" 해소) — 내용 diff 후
 *     변경분만 UPDATE(보통 0~수 건), 폭주 방지 상한 MAX_UPDATES(잔여는 다음 실행이 흡수).
 *  → 소등 날 수동 작업은 원본 아카이브(archive-edutrix.cjs) 재실행만 남는다(§10 체크리스트).
 * 발송 상태는 승격만: sent_at이 있고 현재 status가 NULL일 때만 'success'(eywa 측 상태 다운그레이드 금지).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OVERLAP_DAYS = 7;
const INSERT_CHUNK = 500;
const MAX_UPDATES = 300; // 수정 전파 상한(비정상 대량 diff 시 cron 타임아웃 방지 — 잔여는 다음 실행)

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
  textbook_name: string | null;
  study_attitude: string | null;
  notice: string | null;
  homework_today: string | null;
  makeup_class: boolean | null;
  classnote_sent_at: string | null;
  classes: NameRef;
};
const one = (v: NameRef): { name: string } | null => (Array.isArray(v) ? (v[0] ?? null) : v);

type ExistingRow = {
  id: string;
  edutrix_report_id: string;
  progress: string | null;
  exam_info: string | null;
  homework_score: string | null;
  teacher_name: string | null;
  textbook: string | null;
  attitude: string | null;
  notes: string | null;
  homework_today: string | null;
  makeup: boolean;
  classnote_sent_at: string | null;
  classnote_status: string | null;
};

/** Edutrix 원본 → eywa 컬럼 값(full-import-reports.cjs toRow와 동형 유지). */
function contentOf(rep: EdutrixReport) {
  return {
    progress: rep.progress || null,
    exam_info: rep.exam_info || null,
    homework_score: rep.assignment_score || null,
    teacher_name: extractTeacher(one(rep.classes)?.name ?? null),
    textbook: rep.textbook_name || null,
    attitude: rep.study_attitude || null,
    notes: rep.notice || null,
    homework_today: rep.homework_today || null,
    makeup: !!rep.makeup_class,
  };
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const eduUrl = process.env.EDUTRIX_SUPABASE_URL;
  const eduKey = process.env.EDUTRIX_SUPABASE_ANON_KEY;
  const TENANT = process.env.EDUTRIX_TENANT_ID;
  if (!eduUrl || !eduKey || !TENANT) {
    return NextResponse.json(
      { error: "EDUTRIX_SUPABASE_URL / EDUTRIX_SUPABASE_ANON_KEY / EDUTRIX_TENANT_ID 미설정" },
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

    const [eduRows, mappedStudents, existingRows] = await Promise.all([
      fetchAllPaged<EdutrixReport>((from, to) =>
        edu
          .from("reports")
          .select(
            "id, date, student_id, progress, exam_info, assignment_score, textbook_name, study_attitude, notice, homework_today, makeup_class, classnote_sent_at, classes(name)",
          )
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
      fetchAllPaged<ExistingRow>((from, to) =>
        admin
          .from("lesson_reports")
          .select(
            "id, edutrix_report_id, progress, exam_info, homework_score, teacher_name, textbook, attitude, notes, homework_today, makeup, classnote_sent_at, classnote_status",
          )
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
    const existingByRep = new Map(existingRows.map((r) => [r.edutrix_report_id, r] as const));
    const seenReportIds = new Set(existingByRep.keys());

    const inserts: Record<string, unknown>[] = [];
    const updates: { id: string; patch: Record<string, unknown> }[] = [];
    let unmatchedStudents = 0;
    let skippedExisting = 0;
    for (const rep of eduRows) {
      if (!rep.id || !rep.student_id) continue;
      const cur = existingByRep.get(rep.id);
      if (cur) {
        // 수정 전파 — 내용 diff(변경분만). 발송 상태는 승격만(sent_at 있고 status NULL → success).
        const next = contentOf(rep);
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(next)) {
          if ((cur as Record<string, unknown>)[k] !== v) patch[k] = v;
        }
        if (rep.classnote_sent_at && !cur.classnote_sent_at) {
          patch.classnote_sent_at = rep.classnote_sent_at;
          if (!cur.classnote_status) patch.classnote_status = "success";
        }
        if (Object.keys(patch).length) updates.push({ id: cur.id, patch });
        else skippedExisting++;
        continue;
      }
      // 같은 실행 내 중복 유입 방지 — fetchAllPaged가 비유니크 정렬키(date desc)로 range 페이징하므로
      // 페이지 경계에서 같은 report가 두 번 올 수 있음(중복 insert = 유니크 위반으로 청크 전체 실패).
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
      inserts.push({
        tenant_id: TENANT,
        student_id: eywaId,
        report_date: rep.date,
        ...contentOf(rep),
        source: "edutrix_import",
        edutrix_report_id: rep.id,
        classnote_sent_at: rep.classnote_sent_at || null,
        classnote_status: rep.classnote_sent_at ? "success" : null,
      });
    }

    for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
      const { error } = await admin.from("lesson_reports").insert(inserts.slice(i, i + INSERT_CHUNK));
      if (error) throw new Error(`lesson_reports insert: ${error.message}`);
    }
    const boundedUpdates = updates.slice(0, MAX_UPDATES);
    for (const u of boundedUpdates) {
      const { error } = await admin
        .from("lesson_reports")
        .update(u.patch)
        .eq("id", u.id)
        .eq("tenant_id", TENANT)
        .eq("source", "edutrix_import");
      if (error) throw new Error(`lesson_reports update: ${error.message}`);
    }

    return NextResponse.json({
      ok: true,
      windowStart,
      edutrixRows: eduRows.length,
      mappedStudents: byEdutrixId.size,
      inserted: inserts.length,
      updated: boundedUpdates.length,
      updateBacklog: updates.length - boundedUpdates.length,
      skippedExisting,
      unmatchedStudents,
    });
  } catch (e) {
    reportError(e, { scope: "cron.edutrix-sync" });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
