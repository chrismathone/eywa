"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { ingestReport } from "./ingest";
import { explainDbError } from "@/lib/supabase/db-error";

type BackfillResult = {
  ok: boolean;
  scanned?: number;
  ingested?: number;
  skipped?: number;
  error?: string;
};

/**
 * 진도 컨테이너 백필 — 테넌트의 과거 math 수업보고서를 report_date ASC로 순회하며 ingest(멱등).
 * 원장·사무실(students write)만. ingest는 progress_events.report_id로 멱등이라 재실행 안전.
 * (on-save ingest와 동일 코어. 대량이면 서버 액션 타임아웃 유의 — 필요 시 배치/스크립트로.)
 */
export async function backfillProgressContainers(opts?: { dryRun?: boolean }): Promise<BackfillResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  // ⚠️ canWriteTenant는 async — await 없으면 Promise truthy라 권한 검사가 항상 통과(역할 게이트 무력화).
  if (!(await canWriteTenant(user.systemRole, "students"))) return { ok: false, error: "권한이 없습니다" };

  const supabase = await createClient();
  // 테넌트 math 보고서 date ASC(같은 날 created_at ASC) — RLS 스코프. 페이지네이션(기본 1000행 캡 회피).
  const rows: {
    id: string;
    student_id: string;
    report_date: string;
    subject: string | null;
    progress: string | null;
    teacher_name: string | null; // 진도 점프 경고의 "같은 선생님" 축(2026-08-20)
  }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("lesson_reports")
      .select("id, student_id, report_date, subject, progress, teacher_name")
      .or("subject.eq.math,subject.is.null") // math(네이티브) + null(legacy 임포트) — ingest가 positionOf로 실질 필터
      .order("report_date", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, error: explainDbError(error, { scope: "progress.backfill-actions.backfillProgressContainers", fallback: "보고서를 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  if (opts?.dryRun) return { ok: true, scanned: rows.length, ingested: 0, skipped: rows.length };

  let ingested = 0;
  let skipped = 0;
  for (const r of rows) {
    const res = await ingestReport(supabase, {
      id: r.id,
      tenantId: user.tenantId,
      studentId: r.student_id,
      reportDate: r.report_date,
      subject: r.subject,
      progress: r.progress,
      teacherName: r.teacher_name,
    });
    if (res.skipped) skipped++;
    else ingested++;
  }
  return { ok: true, scanned: rows.length, ingested, skipped };
}
