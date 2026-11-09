import "server-only";
import { unstable_rethrow } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeDbError, logDbError } from "@/lib/supabase/db-error";
import { isDirectReport, missingReportSchema, reportStatusLabel, type ReportListRow, type ReportStatus, type StudentSnapshot } from "../model";
import type { ArchiveRow } from "../archive-model";
import { canReadReport, reportViewer } from "./queries";
import { canReadArchive } from "./archives";
import { loadRefundSteps } from "./refund-steps";
import { loadRefundHolds } from "./refund-check";

/**
 * 퇴원 상세의 '퇴원보고서' 카드 — **한 학생**의 새 보고서와 기존 원본(원장 2026-10-23 *"퇴원보고서 연동"*).
 *
 * 🔴 보고서 전체 목록(`listReports`)을 거르지 않는다 — 완료 건을 200개까지만 읽어 학생별 연결이 빠진다. 학생 id로 좁혀 읽는다.
 * 🔴 열람 규칙은 보고서 화면의 것을 그대로 쓴다([[#77]]): 게이트 = `reportViewer`(메뉴 권한 · 실험실 판정 · 강사뷰),
 *    새 보고서 = `canReadReport`(참여자 · 강사는 본인 배정), 원본 = `canReadArchive`(강사는 본인 기록 · 관리자는 과목 범위).
 *    카드가 보이는 사람 = 링크가 열리는 사람이다.
 * ⚠️ 두 표는 RLS 정책이 0개라([[#104]]) 관리자 클라이언트로 읽고 **`tenant_id`를 직접 건다.**
 * ⚠️ 실패해도 퇴원 상세 전체를 깨뜨리지 않는다 — 준비 안 됨 · 조회 실패 · 실제 0건을 모양으로 가르고 카드만 안내한다.
 */

export type StudentReportItem = {
  id: string;
  /** 요청 묶음 — 담임별로 나뉜 보고서들이 같은 값을 가진다(묶음이 없던 옛 행은 자기 id). */
  groupId: string;
  status: ReportStatus;
  /** 보이는 상태 — 데스크 환불이 남았으면 '… · 데스크 환불 요청'(원장 2026-11-03 · 목록·상세와 같은 `reportStatusLabel`). */
  statusLabel: string;
  exitKind: "withdrawal" | "subject_end";
  subjects: string[];
  effectiveDate: string;
  teacherName: string | null;
  /** 관리자 바로 처리(강사 작성 없이, 원장 2026-10-23 · 0453a) — 카드가 담임 대신 이 표시를 단다. */
  direct: boolean;
};
export type StudentArchiveItem = {
  id: string;
  subject: string | null;
  exitDate: string | null;
  rawExitDate: string;
  teacherName: string;
  className: string;
};
export type StudentReportRecords =
  | { status: "hidden" }
  | { status: "not_ready" }
  | { status: "error" }
  | {
      status: "ok";
      reports: StudentReportItem[];
      archives: StudentArchiveItem[];
      /** 거르는 규칙 없이 전부 보는 사람(원장 · 강사뷰 아님 · 과목 범위 없음)인가 — 그때만 화면이 '없습니다'라고 단정한다. */
      complete: boolean;
    };

const REPORT_COLUMNS =
  "id,student_id,requested_by,teacher_id,manager_id,director_id,manager_ids,director_ids,exit_kind,subjects,effective_date,status,created_at,group_id,snapshot";
const ARCHIVE_COLUMNS = "id,subject,exit_date,raw_exit_date,teacher_name,class_name,mapped_teacher_id";
const PAGE = 200;

type DbError = { code?: string; message?: string } | null;
type Page<T> = PromiseLike<{ data: T[] | null; error: DbError }>;

/** 한 학생의 행을 끝까지(학생당 몇 건이지만 침묵 절단은 두지 않는다 — B2). 오류는 그대로 돌려준다. */
async function readAll<T>(run: (from: number, to: number) => Page<T>): Promise<{ rows: T[]; error: DbError }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) return { rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { rows, error: null };
  }
}

function failure(error: DbError, scope: string): StudentReportRecords {
  logDbError(error, scope);
  return missingReportSchema(error) || describeDbError(error, { fallback: "" }).kind === "schema"
    ? { status: "not_ready" }
    : { status: "error" };
}

type ReportRow = ReportListRow & { snapshot: StudentSnapshot | null };

export async function loadStudentReportRecords(studentId: string): Promise<StudentReportRecords> {
  try {
    const viewer = await reportViewer();
    if (!viewer) return { status: "hidden" };
    const db = createAdminClient();
    const tenant = viewer.user.tenantId;
    const archivesVisible = !!viewer.teacherId || viewer.manage;
    const [reports, archives] = await Promise.all([
      readAll<ReportRow>((from, to) => {
        let q = db.from("withdrawal_reports").select(REPORT_COLUMNS).eq("tenant_id", tenant).eq("student_id", studentId);
        if (viewer.teacherId) q = q.eq("teacher_id", viewer.teacherId);
        return q.order("created_at", { ascending: false }).order("id").range(from, to) as unknown as Page<ReportRow>;
      }),
      archivesVisible
        ? readAll<ArchiveRow>((from, to) => {
            let q = db.from("withdrawal_report_archives").select(ARCHIVE_COLUMNS).eq("tenant_id", tenant).eq("mapped_student_id", studentId);
            if (viewer.teacherId) q = q.eq("mapped_teacher_id", viewer.teacherId);
            return q.order("exit_date", { ascending: false, nullsFirst: false }).order("id").range(from, to) as unknown as Page<ArchiveRow>;
          })
        : Promise.resolve({ rows: [] as ArchiveRow[], error: null }),
    ]);
    if (reports.error) return failure(reports.error, "withdrawal-reports.student-reports");
    if (archives.error) return failure(archives.error, "withdrawal-reports.student-archives");
    const readable = reports.rows.filter((r) => canReadReport(r, viewer));
    // 데스크 환불 단계(s2_0025)는 아직 처리 전인 보고서에만 의미가 있다 — 그런 보고서가 있을 때만 읽고, 못 읽으면 단계 없이.
    const open = readable.filter((r) => !["completed", "canceled", "blocked"].includes(r.status));
    const [steps, holds] = open.length
      ? await Promise.all([loadRefundSteps(tenant, open).catch(() => undefined), loadRefundHolds(tenant, open.map((r) => r.group_id)).catch(() => undefined)])
      : [undefined, undefined];
    // 환불 단계 조회 실패 — 승인 완료 칩을 '처리 확인 대기'라고 단정하지 않는다(리뷰 r3 R2-m10).
    const refundsFailed = open.length > 0 && (!steps || !holds);
    return {
      status: "ok",
      // 다 보는 사람만 '없습니다'를 단정한다 — 원장, 그리고 열람 과목 제한이 없는 관리자급(원장 2026-10-30 열람 확대).
      complete: !viewer.teacherId && (viewer.user.systemRole === "master" ? !viewer.scope : viewer.manage && !viewer.readScope),
      reports: readable
        .map((r) => ({
          id: r.id,
          groupId: r.group_id ?? r.id,
          status: r.status,
          // 형제 승인(리뷰 r3 R2-m2) — 이 학생의 보고서를 다 읽은 사람만(강사는 자기 보고서만 읽어 형제를 모른다 → 종전 글).
          statusLabel: reportStatusLabel(r, steps?.get(r.group_id ?? r.id) ?? [], !!r.group_id && !!holds?.has(r.group_id),
            viewer.teacherId ? undefined : reports.rows.some((q) => q.group_id && q.group_id === r.group_id && q.id !== r.id && ["requested", "revision", "manager_pending", "director_pending"].includes(q.status)) ? "pending"
              : refundsFailed ? "failed" : "done"),
          exitKind: r.exit_kind,
          subjects: r.subjects ?? [],
          effectiveDate: r.effective_date,
          teacherName: r.snapshot?.courses?.find((c) => c.teacherId === r.teacher_id)?.teacherName ?? null,
          direct: isDirectReport(r),
        })),
      archives: archives.rows
        .filter((a) => canReadArchive(a, viewer))
        .map((a) => ({
          id: a.id,
          subject: a.subject,
          exitDate: a.exit_date,
          rawExitDate: a.raw_exit_date,
          teacherName: a.teacher_name,
          className: a.class_name,
        })),
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[withdrawal-reports] 학생별 퇴원보고서 조회 실패", error);
    return { status: "error" };
  }
}
