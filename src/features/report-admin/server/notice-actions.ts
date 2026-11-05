"use server";

// 반 공지(원생 개별 공지) — aywa 반에서 학생을 골라 학생마다 1:1 알림장으로 일괄 게시(큐 적재까지만 담당).
// 실제 게시는 연동 PC 워커가 내부 API(POST /api/v1_2/reports/)로 처리. Edutrix NoticeWriteModal 패턴 계승.
// 🔴 수학은 **반 보드 경로**(원장 2026-10-02): 고른 반의 반 보드에서 그 학생 원아에게 1:1로(수업보고서와 같은 방식). 그 밖(영어)은 1인 보드.
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { reportError } from "@/lib/observability/report-error";
import { getTenantSettings } from "@/features/owner/server/queries";
import { logAction } from "@/features/audit/server/log";
import {
  flattenNoticeReportLinks,
  boardStudentName,
  noticePostedActions,
  type NoticeReportLink,
} from "@/features/onescreen/notice-links";
import type { NoticeSkip } from "../notice-targets";
import { classnoteModuleOn, classnoteSendOn } from "@/features/owner/classnote-gate";
import { prepareClassNotice } from "./prepare-class-notice";
import type { ClassNoticeInput, ClassNoticePreview } from "../class-notice-preview";

export type NoticeClassOption = {
  id: string;
  name: string;
  subject: string | null;
  studentCount: number;
  /**
   * '수업보고서 미발송' 반인가(0174a) — **여기서 거르지 않고 값만 싣는다.**
   * 이 함수는 **반 공지 탭과 직접 발송 탭이 공유**하는데 둘의 뜻이 다르다:
   * 직접 발송(리포트 카드 = 수업보고서)은 제외하고, **반 공지(학부모 공지)는 계속 보낼 수 있다**
   * — 토글 이름 그대로 '수업보고서' 미발송이지 '이 반엔 아무것도 안 보냄'이 아니다.
   */
  reportOptout: boolean;
  // 반별 재원생 — 개별 내용 입력 UI가 학생별 박스를 그리는 데 사용(공통은 body, 개별은 이 학생들에게만).
  students: { id: string; name: string; grade: string | null }[];
};

/** 공지 대상 반 옵션 — 활성 반(발송 opt-in 과목만) + 재원생 수. 읽기 게이트(viewer 포함). */
export async function getNoticeClassOptions(): Promise<{ ok: boolean; classes?: NoticeClassOption[]; error?: string }> {
  try {
    return await loadNoticeClassOptions();
  } catch (error) {
    reportError(error, { scope: "notice.class-options" });
    return { ok: false, error: "공지 대상 반 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요" };
  }
}

async function loadNoticeClassOptions(): Promise<{ ok: boolean; classes?: NoticeClassOption[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "권한이 없습니다" };
  const settings = await getTenantSettings();
  if (!classnoteModuleOn(settings)) return { ok: false, error: "사용할 수 없는 기능입니다" };
  const allowed = settings.report.classnoteSubjects;
  if (!allowed.length) return { ok: true, classes: [] };

  const supabase = await createClient();
  const classes = await fetchAllPaged<{ id: string; class_name: string; subject: string | null; report_optout: boolean | null }>((from, to) => supabase
    .from("classes")
    .select("id, class_name, subject, report_optout")
    .eq("is_active", true)
    .in("subject", allowed)
    .order("class_name").order("id").range(from, to));
  const ids = (classes ?? []).map((c) => c.id as string);
  // 반별 재원생 — 활성 수강 rows(선택 반 한정, 수백 행 규모). 학생 상태는 큐 적재 시 재검증.
  const enr = await fetchAllPagedInChunks<{ class_id: string; student_id: string }>(ids, (chunk, from, to) =>
    supabase.from("enrollments").select("class_id, student_id").in("class_id", chunk).is("end_date", null).order("id").range(from, to),
  );
  // 학생 이름·학년 — 개별 내용 입력 UI가 학생별 박스를 그리려면 로스터가 필요(수백 행, 청크 분할).
  const studentIds = [...new Set(enr.map((e) => e.student_id))];
  const studentRows = await fetchInChunks<{ id: string; name: string; grade: string | null }>(studentIds, (chunk) =>
    supabase.from("students").select("id, name, grade").in("id", chunk),
  );
  const studentById = new Map(studentRows.map((s) => [s.id, s]));
  const rosterByClass = new Map<string, NoticeClassOption["students"]>();
  for (const e of enr) {
    const s = studentById.get(e.student_id);
    if (!s) continue;
    const list = rosterByClass.get(e.class_id) ?? [];
    list.push({ id: s.id, name: s.name, grade: s.grade });
    rosterByClass.set(e.class_id, list);
  }
  return {
    ok: true,
    classes: (classes ?? [])
      .map((c) => {
        const roster = rosterByClass.get(c.id as string) ?? [];
        return {
          id: c.id as string,
          name: c.class_name as string,
          subject: c.subject as string | null,
          reportOptout: (c as { report_optout?: boolean | null }).report_optout === true,
          studentCount: roster.length,
          students: roster,
        };
      })
      .filter((c) => c.studentCount > 0),
  };
}

/** Read-only recipient preview with the same write permission as send. */
export async function previewClassNotice(input: ClassNoticeInput): Promise<{ ok: true; preview: ClassNoticePreview } | { ok: false; error: string }> {
  const prepared = await prepareClassNotice({ ...input, test: false });
  if (!prepared.ok) return prepared;
  const { targets, skipped, fingerprint, commonAttachments } = prepared;
  const ids = new Set(targets.map((t) => t.studentId));
  return { ok: true, preview: {
    fingerprint, classCount: new Set(input.classIds).size, studentCount: ids.size,
    individualCount: [...ids].filter((id) => id && input.individual?.[id]?.trim()).length,
    attachmentCount: commonAttachments.length,
    targets: targets.map((t) => ({ name: t.studentName, className: t.className })), skipped,
  } };
}

export async function sendClassNotice(input: ClassNoticeInput): Promise<{ ok: boolean; queued?: number; skipped?: NoticeSkip[]; dryRun?: boolean; error?: string }> {
  const prepared = await prepareClassNotice(input);
  if (!prepared.ok) return prepared;
  const { user, supabase, settings, body, targets, skipped, commonAttachments, fingerprint } = prepared;
  if (!input.test && input.previewFingerprint !== fingerprint)
    return { ok: false, error: "발송 대상 또는 내용이 달라졌습니다. 발송 대상을 다시 확인하세요", skipped };
  if (!targets.length) return { ok: false, error: "발송 가능한 학생이 없습니다", skipped };

  // 발송 안전 스위치 — OFF면 dry-run(큐 적재 안 함). 보고서 발송과 동일 스위치 공유.
  if (!classnoteSendOn(settings)) return { ok: true, queued: 0, skipped, dryRun: true };

  const { data: inserted, error } = await supabase
    .from("classnote_notices")
    .insert({
      tenant_id: user.tenantId,
      body,
      targets,
      created_by: user.id,
      ...(commonAttachments.length ? { attachments: commonAttachments } : {}),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: humanizeDbError(error.message, "발송") };

  // 감사 로그 — '발송 대기(큐 적재)'(실제 게시는 연동 PC 워커). best-effort. source=class(반 공지 경로).
  await logAction({
    action: "classnote_notice_send",
    targetType: "classnote_notice",
    targetLabel: `대상 ${targets.length}명`,
    metadata: {
      noticeId: inserted?.id ?? null,
      targetCount: targets.length,
      source: "class",
      commonAttachments: commonAttachments.length,
      classRouteTargets: targets.filter((t) => t.classId).length,
      englishRoomTargets: targets.filter((t) => t.classId && t.subject === "english").length,
    },
  });

  return { ok: true, queued: targets.length, skipped };
}

export type NoticeRow = {
  id: string;
  body: string;
  targetCount: number;
  status: string;
  /**
   * 실패 표시용 — board는 보드명이라 화면에선 학생 이름(studentName)으로 보여준다.
   * ⚠️ `ok`는 **선택**이다 — 게시 결과에만 있고 수정·회수 결과엔 없다(모양 3종은 `notice-failures.ts` 참조).
   *    실패 집계는 반드시 `noticeFailures()`로 — `!x.ok`는 수정·회수를 전건 실패로 뒤집는다.
   */
  results: { board: string; studentName: string; ok?: boolean; note?: string }[] | null;
  /** 게시된 글 주소 + 학생 이름 — '#1 #2'로는 누구 글인지 알 수 없어 이름으로 되붙인다. */
  reportLinks: NoticeReportLink[];
  /** 게시취소(회수 일부 실패면 남은 글 다시)·제자리 수정 가능 여부 — 원스크린 발송자 화면과 같은 판정(F1·F2). */
  canRevoke: boolean;
  canEdit: boolean;
  error: string | null;
  createdAt: string;
  processedAt: string | null;
};

/** 최근 공지 이력(20건) — 상태·타깃별 결과. */
export async function listClassNotices(): Promise<{ ok: boolean; rows?: NoticeRow[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "권한이 없습니다" };
  if (!classnoteModuleOn(await getTenantSettings())) return { ok: false, error: "사용할 수 없는 기능입니다" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("classnote_notices")
    .select("id, body, targets, status, results, error, created_at, processed_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { ok: false, error: humanizeDbError(error.message, "조회") };
  return {
    ok: true,
    rows: (data ?? []).map((r) => {
      // 워커 results[]는 보드명 기준 — targets[]로 학생 이름을 되붙인다(못 찾으면 보드명에서 과목 접두어만 벗김).
      const nameByBoard = new Map<string, string>();
      if (Array.isArray(r.targets)) {
        for (const t of r.targets as Array<Record<string, unknown>>) {
          if (typeof t?.board === "string" && typeof t?.studentName === "string")
            nameByBoard.set(t.board, t.studentName);
        }
      }
      const results = (r.results as Array<{ board: string; ok?: boolean; note?: string }> | null) ?? null;
      return {
        id: r.id as string,
        body: r.body as string,
        targetCount: Array.isArray(r.targets) ? r.targets.length : 0,
        status: r.status as string,
        results: results
          ? results.map((x) => ({
              ...x,
              studentName: nameByBoard.get(x.board) ?? boardStudentName(x.board ?? ""),
            }))
          : null,
        reportLinks: flattenNoticeReportLinks(r.results, r.targets),
        ...noticePostedActions(r.status as string, r.results, r.targets),
        error: r.error as string | null,
        createdAt: r.created_at as string,
        processedAt: r.processed_at as string | null,
      };
    }),
  };
}
