"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { getTenantSettings } from "@/features/owner/server/queries";
import { logAction } from "@/features/audit/server/log";
import { CLASS_NOTICE_BODY_MAX, CLASS_NOTICE_TITLE_MAX, type ClassNoticeRow } from "../class-notice";

/**
 * **반 단체 공지** — ClassNote 반 보드에 공지 1건(원장 2026-09-29 *"반 공지 혹은 원생 개별 공지로 구분"*).
 * 원생 개별 공지(학생마다 1:1 알림장)는 기존 `sendClassNotice`(notice-actions.ts) 그대로다.
 *
 * 🔴 큐(0304a)는 **서버만** 쓴다(admin) — 사용자 쓰기 정책이 없다. 워커가 보드 번호를 연결표(0302a)에서 다시 찾고,
 *    **보드 원아 = 그 반 재원생(매칭 확인)**을 대조한 뒤에만 보낸다(반 단체 공지는 보드에 남은 원아 전원에게 간다).
 * 테스트 발송 = `[수학] 테스트반`(학원* 원아만)으로만.
 */
export async function sendClassWideNotice(input: {
  classIds: string[];
  title: string;
  body: string;
  test?: boolean;
}): Promise<{ ok: boolean; queued?: number; skipped?: string[]; dryRun?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "공지 발송 권한이 없습니다" };
  const title = (input.title ?? "").trim();
  const body = (input.body ?? "").trim();
  if (!title) return { ok: false, error: "공지 제목을 입력하세요" };
  if (!body) return { ok: false, error: "공지 내용을 입력하세요" };
  if (title.length > CLASS_NOTICE_TITLE_MAX) return { ok: false, error: `제목이 너무 깁니다(최대 ${CLASS_NOTICE_TITLE_MAX}자)` };
  if (body.length > CLASS_NOTICE_BODY_MAX) return { ok: false, error: `공지가 너무 깁니다(최대 ${CLASS_NOTICE_BODY_MAX}자)` };

  const admin = createAdminClient();
  let targets: { classId: string; className: string }[] = [];
  const skipped: string[] = [];
  if (!input.test) {
    const classIds = [...new Set(input.classIds ?? [])].slice(0, 100);
    if (!classIds.length) return { ok: false, error: "대상 반을 선택하세요" };
    // 반 보드 연결(0302a)이 있는 반만 — 없으면 보낼 곳이 없다(반 이름으로 추측하지 않는다).
    const [{ data: cls, error: cErr }, { data: boards, error: bErr }] = await Promise.all([
      admin.from("classes").select("id, class_name").eq("tenant_id", user.tenantId).in("id", classIds),
      admin.from("classnote_class_boards").select("class_id").eq("tenant_id", user.tenantId).in("class_id", classIds),
    ]);
    if (cErr || bErr) return { ok: false, error: humanizeDbError((cErr ?? bErr)!.message, "조회") };
    const hasBoard = new Set((boards ?? []).map((b) => b.class_id as string));
    for (const c of cls ?? []) {
      if (hasBoard.has(c.id as string)) targets.push({ classId: c.id as string, className: c.class_name as string });
      else skipped.push(`${c.class_name}(ClassNote 반 연결 없음)`);
    }
    if (!targets.length) return { ok: false, error: "ClassNote 반 연결이 있는 반이 없습니다", skipped };
  } else {
    targets = [];
  }

  // 발송 안전 스위치 — 보고서·원생 개별 공지와 같은 스위치(OFF = 큐에 안 올린다).
  const settings = await getTenantSettings();
  if (!settings.report.classnoteSendEnabled) return { ok: true, queued: 0, skipped, dryRun: true };

  const { data: inserted, error } = await admin
    .from("classnote_class_notices")
    .insert({ tenant_id: user.tenantId, title, body, targets, is_test: !!input.test, created_by: user.id })
    .select("id")
    .single();
  if (error) return { ok: false, error: humanizeDbError(error.message, "발송") };

  await logAction({
    action: "classnote_notice_send",
    targetType: "classnote_notice",
    targetLabel: input.test ? "반 단체 공지 테스트" : `반 단체 공지 ${targets.length}개 반`,
    metadata: {
      noticeId: inserted?.id ?? null,
      source: "class_wide",
      test: !!input.test,
      classes: targets.map((t) => t.className),
    },
  });
  return { ok: true, queued: input.test ? 1 : targets.length, skipped };
}

/** 반 단체 공지 최근 20건 — 반 공지 탭 목록. */
export async function listClassWideNotices(): Promise<{
  ok: boolean;
  rows?: ClassNoticeRow[];
  /** ClassNote 반 보드 연결(0302a)이 있는 반 — 반 단체 공지를 보낼 수 있는 반. */
  boardClassIds?: string[];
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "권한이 없습니다" };
  const supabase = await createClient();
  const [{ data, error }, { data: boards }] = await Promise.all([
    supabase
      .from("classnote_class_notices")
      .select("id, title, targets, is_test, status, results, error, created_at, processed_at")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("classnote_class_boards").select("class_id"),
  ]);
  if (error) return { ok: false, error: humanizeDbError(error.message, "조회") };
  return {
    ok: true,
    boardClassIds: (boards ?? []).map((b) => b.class_id as string),
    rows: (data ?? []).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      classNames: r.is_test ? ["[수학] 테스트반"] : ((r.targets as { className: string }[] | null) ?? []).map((t) => t.className),
      isTest: !!r.is_test,
      status: r.status as string,
      failures: ((r.results as { className?: string; ok?: boolean; note?: string }[] | null) ?? [])
        .filter((x) => x && x.ok === false)
        .map((x) => `${x.className ?? "?"}: ${x.note ?? "실패"}`),
      error: (r.error as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
  };
}
