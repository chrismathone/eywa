"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { getTenantSettings } from "@/features/owner/server/queries";
import { logAction } from "@/features/audit/server/log";
import { CLASS_NOTICE_BODY_MAX, CLASS_NOTICE_TITLE_MAX, type ClassNoticeRow } from "../class-notice";
import { classnoteSendOn } from "@/features/owner/classnote-gate";
import { effectiveTeacherId, readonlyTeacherViewError } from "@/lib/auth/view-mode";
// 담당 반 판정 단일 소스(담당 반 ∪ 그날 위임 반) — classes.teacher_id를 직접 비교하지 않는다(0173a).
import { getTeachingClassIds } from "@/features/classes/server/delegation";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";

/**
 * **반 단체 공지** — ClassNote 반 보드에 공지 1건(원장 2026-09-29 *"반 공지 혹은 원생 개별 공지로 구분"*).
 * 원생 개별 공지(학생마다 1:1 알림장)는 기존 `sendClassNotice`(notice-actions.ts) 그대로다.
 *
 * 🔴 큐(0304a)는 **서버만** 쓴다(admin) — 사용자 쓰기 정책이 없다. 워커가 보드 번호를 연결표(0302a)에서 다시 찾고,
 *    **보드 원아 = 그 반 재원생(매칭 확인)**을 대조한 뒤에만 보낸다(반 단체 공지는 보드에 남은 원아 전원에게 간다).
 * 테스트 발송 = `[수학] 테스트반`(학원* 원아만)으로만.
 *
 * 인가(원장 2026-10-02 *"공지 발송 모드에서 반인지 개별인지를 선택하는 토글"* — 강사도 원스크린에서 반 공지를 보낸다):
 *  · 강사(겸직 강사뷰 포함) = **본인 담당 반(담임 ∪ 오늘 위임 반)만**. 그 밖의 반이 하나라도 섞이면 통째로 거절한다
 *    (조용히 빼면 "3개 반에 보냈다"가 2개 반이 된다). 원생 개별 공지(`sendOnescreenNotice`)와 같은 스코프.
 *  · 그 밖(관리자뷰) = 수업보고서 쓰기 권한. '다른 강사 뷰'(열람 전용)는 못 보낸다.
 */
export async function sendClassWideNotice(input: {
  classIds: string[];
  title: string;
  body: string;
  test?: boolean;
}): Promise<{ ok: boolean; queued?: number; skipped?: string[]; dryRun?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };
  const teacherId = await effectiveTeacherId();
  if (!teacherId && !(await canWriteTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "공지 발송 권한이 없습니다" };
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
    if (teacherId) {
      // 강사 = 본인 담당 반만(담임 ∪ 오늘 위임). 남의 반이 섞이면 통째로 거절 — 조용히 빼지 않는다.
      const mine = new Set((await getTeachingClassIds(await createClient(), teacherId)).all);
      if (!classIds.every((id) => mine.has(id))) return { ok: false, error: "담당 반에만 반 공지를 보낼 수 있습니다" };
    }
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
  if (!classnoteSendOn(settings)) return { ok: true, queued: 0, skipped, dryRun: true };

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
      source: teacherId ? "class_wide_onescreen" : "class_wide",
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

/**
 * 원스크린 공지 화면의 **반 공지** 재료 — 보낼 수 있는 반(ClassNote 반 보드가 연결된 내 반) + 내가 보낸 반 공지 이력.
 * 고를 수 있는 반은 `sendClassWideNotice`가 받아 주는 반과 **같은 규칙**이다(#77): 강사 = 담당 반(담임 ∪ 오늘 위임),
 * 그 밖 = 수업보고서 쓰기 권한으로 학원 전체. 반 보드 연결(0302a)이 없는 반은 보낼 곳이 없어 싣지 않는다.
 * 표가 아직 없으면(0302a·0304a 전) 빈 목록 — 화면이 반 공지를 감춘다(#95).
 */
export async function loadMyClassWideNotice(): Promise<{
  ok: boolean;
  classes?: { id: string; name: string; studentCount: number }[];
  rows?: ClassNoticeRow[];
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const teacherId = await effectiveTeacherId();
  if (!teacherId && !(await canWriteTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "공지 발송 권한이 없습니다" };
  const supabase = await createClient();
  const admin = createAdminClient();
  try {
    const myIds = teacherId ? (await getTeachingClassIds(supabase, teacherId)).all : null;
    if (myIds && !myIds.length) return { ok: true, classes: [], rows: [] };
    // 반 보드 연결이 있는 반(강사는 담당 반 안에서) — admin + tenant 필터(돌려주는 것은 반 이름뿐).
    // 🔴 id 목록은 청크로(B3) — 강사의 담당 반엔 종강 반까지 들어 있고 사무실은 지점 전체라, 한 번에 넣으면 주소가 길어 실패한다
    //    (실패를 빈 목록으로 삼키면 토글이 이유 없이 사라진다). 헬퍼는 실패를 던지고, 아래 catch가 '반 공지 없음'으로 떨어뜨린다.
    const [boards, { data: mine, error: nErr }] = await Promise.all([
      myIds
        ? fetchInChunks<{ class_id: string }>(myIds, (chunk) =>
            admin.from("classnote_class_boards").select("class_id").eq("tenant_id", user.tenantId).in("class_id", chunk),
          )
        : // 사무실 = 지점 전체 연결 — 보낼 수 있는 반의 목록으로 쓰이므로 전건을 페이지로 읽는다(1000행 절단 금지, B2).
          fetchAllPaged<{ class_id: string }>((from, to) =>
            admin.from("classnote_class_boards").select("class_id").eq("tenant_id", user.tenantId).order("class_id").range(from, to),
          ),
      supabase
        .from("classnote_class_notices")
        .select("id, title, targets, is_test, status, results, error, created_at")
        .eq("created_by", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    if (nErr) return { ok: true, classes: [], rows: [] };
    const classIds = boards.map((b) => b.class_id);
    if (!classIds.length) return { ok: true, classes: [], rows: [] };
    const [cls, enr] = await Promise.all([
      fetchInChunks<{ id: string; class_name: string }>(classIds, (chunk) =>
        admin.from("classes").select("id, class_name").eq("tenant_id", user.tenantId).eq("is_active", true).in("id", chunk),
      ),
      // 반별 재원 수(안내용) — 세는 데 쓰이므로 청크 × 페이징(B2).
      fetchAllPagedInChunks<{ id: string; class_id: string }>(classIds, (chunk, from, to) =>
        admin.from("enrollments").select("id, class_id").eq("tenant_id", user.tenantId).in("class_id", chunk).is("end_date", null).order("id").range(from, to),
      ),
    ]);
    const count = new Map<string, number>();
    for (const e of enr) count.set(e.class_id, (count.get(e.class_id) ?? 0) + 1);
    return {
      ok: true,
      classes: cls
        .map((c) => ({ id: c.id, name: c.class_name, studentCount: count.get(c.id) ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
      rows: (mine ?? []).map((r) => ({
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
  } catch (e) {
    console.error("[class-notice] 반 공지 재료 조회 실패", e instanceof Error ? e.message : e);
    return { ok: true, classes: [], rows: [] };
  }
}
