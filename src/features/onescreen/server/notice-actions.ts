"use server";

// 원스크린 강사 공지 발송 — 선택 학생(들)에게 ClassNote 개별 보드로 **독립 공지**를 게시(classnote_notices).
// 반 공지(report-admin/sendClassNotice)와 같은 레일·워커(POST /api/v1_2/reports/)지만 **강사 스코프**(본인 담당
// 활성 수강생만, 겸직 강사뷰 포함)로 인가하고 카드=1명·표=N명을 지원. 공지는 lesson_reports(수업 보고서)와
// **별개 글**이라 실보고서와 공존·누적한다(같은 날 보고서 + 공지 = 게시판에 글 2개).
//
// ⚠️ 안전(적대검증 반영):
// - 학원 **전체** 동명이인 가드(hasClassnoteNameCollision) — resolveNoticeTargets의 배치-로컬 동명이인 검사만으론
//   배치 밖 동명이인(다른 반 김민수)을 못 잡아 엉뚱한 보드로 갈 수 있음. 보고서 발송 경로와 동일 강도로 재검.
// - 개인화 태그는 **연동 PC 워커가 per-target 본문을 지원한 뒤에만** — 지원 전엔 구 워커가 '{{이름}}'을 리터럴로
//   게시하므로 태그가 있으면 발송 차단(rollout 가드). Phase 2에서 워커 지원 확인 후 해제.
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { hasClassnoteNameCollision } from "./scope";
import {
  resolveNoticeTargets,
  type NoticeCandidate,
  type NoticeSkip,
  type NoticeTarget,
} from "@/features/report-admin/notice-targets";
import { validateNoticeTemplate } from "@/features/report-admin/notice-render";
import { logAction } from "@/features/audit/server/log";

const BODY_MAX = 4000;
// 학원이(테스트 학생) 고정 타깃 — 실 학부모에게 안 가는 검증 경로(반 공지 TEST_TARGET과 동일 관례).
const TEST_TARGET = { studentName: "학원이", board: "(수학)학원이" };

export type OnescreenNoticeInput = {
  body: string;
  students: { studentId: string; subject: string | null }[]; // (학생, 과목) — 과목이 보드 prefix 결정. 카드=1건, 표=N건.
  test?: boolean; // 학원이 1명에게만(파이프라인 검증)
};

export type OnescreenNoticeResult = {
  ok: boolean;
  queued?: number;
  skipped?: NoticeSkip[];
  dryRun?: boolean;
  error?: string;
};

/**
 * 강사 공지 발송 — 선택 (학생, 과목) 대상에게 같은 본문을 개별 보드로 게시.
 * 인가: effectiveTeacherId(실 강사 or 겸직 강사뷰) 있으면 그 강사 담당 활성수강생만, 없으면(관리자뷰) canWriteTenant.
 * 발송 스위치 OFF면 dry-run(적재 안 함). 게시는 연동 PC 워커가 classnote_notices 큐를 폴링해 처리.
 */
export async function sendOnescreenNotice(input: OnescreenNoticeInput): Promise<OnescreenNoticeResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const body = (input.body ?? "").trim();
  if (!body) return { ok: false, error: "공지 내용을 입력하세요" };
  if (body.length > BODY_MAX) return { ok: false, error: `공지가 너무 깁니다(최대 ${BODY_MAX}자)` };

  // Phase 1 태그 하드 게이트 — 워커 per-target 개인화 미지원 상태에선 태그 발송 차단(구 워커가 리터럴 게시).
  const tv = validateNoticeTemplate(body);
  if (!tv.ok) return { ok: false, error: `지원하지 않는 태그: ${tv.unknown.map((t) => `{{${t}}}`).join(", ")}` };
  if (tv.hasTags)
    return { ok: false, error: "개인화 태그({{이름}} 등)는 연동 PC 업데이트 후 지원됩니다 — 지금은 일반 공지만 보낼 수 있어요" };

  const supabase = await createClient();
  const settings = await getTenantSettings();

  // ── 1. 대상 (학생,과목) 후보 해석 + 강사 스코프 ──
  let targets: NoticeTarget[] = [];
  let skipped: NoticeSkip[] = [];
  if (input.test) {
    // 탈원 테스트 학생이라 반 경로로 안 뽑힘 → 고정 타깃(보드 실존·실 학부모 없음). 동명이인 가드 불필요.
    targets = [{ studentId: "", studentName: TEST_TARGET.studentName, board: TEST_TARGET.board }];
  } else {
    const students = (input.students ?? []).filter((s) => s.studentId);
    if (!students.length) return { ok: false, error: "대상 학생을 선택하세요" };
    const studentIds = [...new Set(students.map((s) => s.studentId))];

    // 강사 스코프(겸직 포함) — effectiveTeacherId 있으면 그 강사 담당 활성수강생만, 없으면 canWriteTenant(관리자뷰).
    const teacherId = await effectiveTeacherId();
    let allowedIds: Set<string>;
    if (teacherId) {
      const { data: myClasses } = await supabase.from("classes").select("id").eq("teacher_id", teacherId);
      const myClassIds = (myClasses ?? []).map((c) => c.id as string);
      if (!myClassIds.length) return { ok: false, error: "담당 반이 없습니다" };
      const enr = await fetchInChunks<{ student_id: string }>(studentIds, (chunk) =>
        supabase
          .from("enrollments")
          .select("student_id")
          .in("class_id", myClassIds)
          .is("end_date", null)
          .in("student_id", chunk),
      );
      allowedIds = new Set(enr.map((e) => e.student_id));
    } else {
      if (!(await canWriteTenant(user.systemRole, "lesson_reports")))
        return { ok: false, error: "공지 발송 권한이 없습니다" };
      allowedIds = new Set(studentIds);
    }
    if (!allowedIds.size) return { ok: false, error: "담당 학생이 아닙니다" };

    const rows = await fetchInChunks<{
      id: string;
      name: string;
      classnote_name: string | null;
      status: string;
    }>([...allowedIds], (chunk) =>
      supabase.from("students").select("id, name, classnote_name, status").in("id", chunk),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const candidates: NoticeCandidate[] = [];
    for (const s of students) {
      if (!allowedIds.has(s.studentId)) continue;
      const stu = byId.get(s.studentId);
      if (!stu || stu.status !== "enrolled") continue; // 재원생만
      candidates.push({ studentId: stu.id, name: stu.name, classnoteName: stu.classnote_name, subject: s.subject });
    }
    const resolved = resolveNoticeTargets(candidates, settings.report.classnoteSubjects);
    skipped = resolved.skipped;

    // ⚠️ 학원 전체 동명이인 가드(적대검증 critical) — 배치 밖 동명이인이 있으면 엉뚱한 보드로 갈 수 있어 재검(청크 25).
    const survivors: NoticeTarget[] = [];
    for (let i = 0; i < resolved.targets.length; i += 25) {
      const slice = resolved.targets.slice(i, i + 25);
      const hits = await Promise.all(slice.map((t) => hasClassnoteNameCollision(supabase, t.studentId)));
      slice.forEach((t, j) => {
        if (hits[j]) skipped.push({ name: t.studentName, reason: "name_collision" });
        else survivors.push(t);
      });
    }
    targets = survivors;
  }
  if (!targets.length) return { ok: false, error: "발송 가능한 학생이 없습니다", skipped };

  // ── 2. 발송 안전 스위치(기본 OFF) — dry-run이면 적재 안 함 ──
  if (!settings.report.classnoteSendEnabled) return { ok: true, queued: 0, skipped, dryRun: true };

  const { data: inserted, error } = await supabase
    .from("classnote_notices")
    .insert({ tenant_id: user.tenantId, body, targets, created_by: user.id })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  // 감사 로그 — '발송 대기(큐 적재)'(실제 게시는 워커, 완료 아님). best-effort.
  await logAction({
    action: "classnote_notice_send",
    targetType: "classnote_notice",
    targetLabel: `대상 ${targets.length}명`,
    metadata: { noticeId: inserted?.id ?? null, targetCount: targets.length, source: "onescreen" },
  });

  return { ok: true, queued: targets.length, skipped };
}

export type OnescreenNoticeRow = {
  id: string;
  body: string;
  targetCount: number;
  status: string;
  error: string | null;
  createdAt: string;
  processedAt: string | null;
};

/** 내가 보낸 공지 이력(20건) — 대기건 수정/삭제 UI의 소스. created_by=본인만. */
export async function listMyOnescreenNotices(): Promise<{ ok: boolean; rows?: OnescreenNoticeRow[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("classnote_notices")
    .select("id, body, targets, status, error, created_at, processed_at")
    .eq("created_by", user.id)
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
      error: r.error as string | null,
      createdAt: r.created_at as string,
      processedAt: r.processed_at as string | null,
    })),
  };
}

// 대기(queued) 상태에서만 수정/삭제 — 워커가 집어(processing 이상)가면 불가. ownership=created_by(본인 공지만).
// 0행 = 이미 발송 처리됨/미소유/없음을 구분해 타입 결과로 반환(UI가 '게시취소'로 전환 유도). status='queued' 원자 가드로 레이스 방지.
type MutateResult = { ok: boolean; reason?: "already_sent" | "forbidden" | "not_found"; error?: string };

async function explainZeroRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  noticeId: string,
  userId: string,
): Promise<MutateResult> {
  const { data: row } = await supabase
    .from("classnote_notices")
    .select("status, created_by")
    .eq("id", noticeId)
    .maybeSingle();
  if (!row) return { ok: false, reason: "not_found", error: "공지를 찾을 수 없습니다" };
  if (row.created_by !== userId) return { ok: false, reason: "forbidden", error: "본인이 보낸 공지만 관리할 수 있습니다" };
  return {
    ok: false,
    reason: "already_sent",
    error: "이미 발송 처리되어 수정·삭제할 수 없습니다 — 게시된 공지는 게시취소를 이용하세요",
  };
}

/** 대기 공지 본문 수정 — status='queued' + 본인만. 태그 게이트 동일 적용(Phase1). */
export async function editQueuedNotice(noticeId: string, newBody: string): Promise<MutateResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const body = (newBody ?? "").trim();
  if (!body) return { ok: false, error: "공지 내용을 입력하세요" };
  if (body.length > BODY_MAX) return { ok: false, error: `공지가 너무 깁니다(최대 ${BODY_MAX}자)` };
  const tv = validateNoticeTemplate(body);
  if (!tv.ok) return { ok: false, error: `지원하지 않는 태그: ${tv.unknown.map((t) => `{{${t}}}`).join(", ")}` };
  if (tv.hasTags) return { ok: false, error: "개인화 태그는 연동 PC 업데이트 후 지원됩니다 — 지금은 일반 공지만 가능해요" };

  const supabase = await createClient();
  const { data } = await supabase
    .from("classnote_notices")
    .update({ body })
    .eq("id", noticeId)
    .eq("created_by", user.id)
    .eq("status", "queued")
    .select("id");
  if (!data || data.length === 0) return explainZeroRows(supabase, noticeId, user.id);
  await logAction({
    action: "classnote_notice_edit",
    targetType: "classnote_notice",
    targetLabel: "대기 공지 수정",
    metadata: { noticeId },
  });
  return { ok: true };
}

/** 대기 공지 삭제 — status='queued' + 본인만(게시 전이라 학부모 미도달). */
export async function deleteQueuedNotice(noticeId: string): Promise<MutateResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const supabase = await createClient();
  const { data } = await supabase
    .from("classnote_notices")
    .delete()
    .eq("id", noticeId)
    .eq("created_by", user.id)
    .eq("status", "queued")
    .select("id");
  if (!data || data.length === 0) return explainZeroRows(supabase, noticeId, user.id);
  await logAction({
    action: "classnote_notice_delete",
    targetType: "classnote_notice",
    targetLabel: "대기 공지 삭제",
    metadata: { noticeId },
  });
  return { ok: true };
}
