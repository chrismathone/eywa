"use server";

// 반 공지 — eywa 반에서 학생을 골라 각 학생의 ClassNote 개별 보드로 일괄 게시(큐 적재까지만 담당).
// 실제 게시는 연동 PC 워커가 내부 API(POST /api/v1_2/reports/)로 처리. Edutrix NoticeWriteModal 패턴 계승.
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { resolveNoticeTargets, type NoticeCandidate, type NoticeSkip } from "../notice-targets";

export type NoticeClassOption = { id: string; name: string; subject: string | null; studentCount: number };

/** 공지 대상 반 옵션 — 활성 반(발송 opt-in 과목만) + 재원생 수. 읽기 게이트(viewer 포함). */
export async function getNoticeClassOptions(): Promise<{ ok: boolean; classes?: NoticeClassOption[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "권한이 없습니다" };
  const settings = await getTenantSettings();
  const allowed = settings.report.classnoteSubjects;
  if (!allowed.length) return { ok: true, classes: [] };

  const supabase = await createClient();
  const { data: classes, error } = await supabase
    .from("classes")
    .select("id, class_name, subject")
    .eq("is_active", true)
    .in("subject", allowed)
    .order("class_name");
  if (error) return { ok: false, error: error.message };
  const ids = (classes ?? []).map((c) => c.id as string);
  // 반별 재원생 수 — 활성 수강 rows(선택 반 한정, 수백 행 규모)로 집계. 학생 상태는 큐 적재 시 재검증.
  const enr = await fetchInChunks<{ class_id: string; student_id: string }>(ids, (chunk) =>
    supabase.from("enrollments").select("class_id, student_id").in("class_id", chunk).is("end_date", null),
  );
  const countByClass = new Map<string, number>();
  for (const e of enr) countByClass.set(e.class_id, (countByClass.get(e.class_id) ?? 0) + 1);
  return {
    ok: true,
    classes: (classes ?? [])
      .map((c) => ({
        id: c.id as string,
        name: c.class_name as string,
        subject: c.subject as string | null,
        studentCount: countByClass.get(c.id as string) ?? 0,
      }))
      .filter((c) => c.studentCount > 0),
  };
}

const BODY_MAX = 4000;
/** 학원이(테스트 학생) 고정 타깃 — 실 학부모에게 안 가는 검증 경로(Edutrix 관리자 테스트 반 패턴). */
const TEST_TARGET = { studentName: "학원이", board: "(수학)학원이" };

/**
 * 반 공지 큐 적재 — 선택 반들의 재원생을 타깃으로 해석(resolveNoticeTargets: 과목 opt-in·동명이인 제외)
 * 후 classnote_notices에 1행 insert. 발송 스위치 OFF면 dry-run(적재 안 함). test=true면 반 선택 무시하고
 * 학원이 1명에게만(파이프라인 검증용).
 */
export async function sendClassNotice(input: {
  classIds: string[];
  body: string;
  test?: boolean;
}): Promise<{ ok: boolean; queued?: number; skipped?: NoticeSkip[]; dryRun?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "공지 발송 권한이 없습니다" };
  const body = (input.body ?? "").trim();
  if (!body) return { ok: false, error: "공지 내용을 입력하세요" };
  if (body.length > BODY_MAX) return { ok: false, error: `공지가 너무 깁니다(최대 ${BODY_MAX}자)` };

  const supabase = await createClient();
  const settings = await getTenantSettings();

  let targets: { studentId: string | null; studentName: string; board: string }[] = [];
  let skipped: NoticeSkip[] = [];
  if (input.test) {
    // 테스트 학생은 탈원 처리라 반 해석 경로로 못 뽑힘 — 고정 타깃(보드·학부모 연결 실존 확인됨).
    targets = [{ studentId: null, ...TEST_TARGET }];
  } else {
    const classIds = (input.classIds ?? []).slice(0, 100);
    if (!classIds.length) return { ok: false, error: "대상 반을 선택하세요" };
    const { data: classes } = await supabase
      .from("classes")
      .select("id, subject")
      .in("id", classIds)
      .eq("is_active", true);
    const subjectByClass = new Map((classes ?? []).map((c) => [c.id as string, c.subject as string | null]));
    const enr = await fetchInChunks<{ class_id: string; student_id: string }>([...subjectByClass.keys()], (chunk) =>
      supabase.from("enrollments").select("class_id, student_id").in("class_id", chunk).is("end_date", null),
    );
    const studentIds = [...new Set(enr.map((e) => e.student_id))];
    const students = await fetchInChunks<{ id: string; name: string; classnote_name: string | null; status: string }>(
      studentIds,
      (chunk) => supabase.from("students").select("id, name, classnote_name, status").in("id", chunk),
    );
    const studentById = new Map(students.map((s) => [s.id, s]));
    const candidates: NoticeCandidate[] = [];
    for (const e of enr) {
      const s = studentById.get(e.student_id);
      if (!s || s.status !== "enrolled") continue; // 재원생만
      candidates.push({
        studentId: s.id,
        name: s.name,
        classnoteName: s.classnote_name,
        subject: subjectByClass.get(e.class_id) ?? null,
      });
    }
    const resolved = resolveNoticeTargets(candidates, settings.report.classnoteSubjects);
    targets = resolved.targets;
    skipped = resolved.skipped;
  }
  if (!targets.length) return { ok: false, error: "발송 가능한 학생이 없습니다", skipped };

  // 발송 안전 스위치 — OFF면 dry-run(큐 적재 안 함). 보고서 발송과 동일 스위치 공유.
  if (!settings.report.classnoteSendEnabled) return { ok: true, queued: 0, skipped, dryRun: true };

  const { error } = await supabase.from("classnote_notices").insert({
    tenant_id: user.tenantId,
    body,
    targets,
    created_by: user.id,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, queued: targets.length, skipped };
}

export type NoticeRow = {
  id: string;
  body: string;
  targetCount: number;
  status: string;
  results: { board: string; ok: boolean; note?: string }[] | null;
  error: string | null;
  createdAt: string;
  processedAt: string | null;
};

/** 최근 공지 이력(20건) — 상태·타깃별 결과. */
export async function listClassNotices(): Promise<{ ok: boolean; rows?: NoticeRow[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "권한이 없습니다" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("classnote_notices")
    .select("id, body, targets, status, results, error, created_at, processed_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      id: r.id as string,
      body: r.body as string,
      targetCount: Array.isArray(r.targets) ? r.targets.length : 0,
      status: r.status as string,
      results: (r.results as NoticeRow["results"]) ?? null,
      error: r.error as string | null,
      createdAt: r.created_at as string,
      processedAt: r.processed_at as string | null,
    })),
  };
}
