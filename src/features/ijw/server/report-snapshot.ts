import "server-only";

/**
 * 영어 보고서의 **인재원 자료 동결본** — 받기(5번 하루치) · 저장 · 읽기. 표 = 0261a `report_jj_snapshots`.
 *
 * 🔑 받는 곳은 서버뿐이다 — 클라이언트가 보낸 JSON을 학부모 그림 재료로 믿지 않는다([[#77]]).
 * 🔴 던지지 않는다 — 인재원이 꺼져 있거나 표가 아직 없어도(0261a 적용 전, [[#95]]) 보고서 저장·/r 열람은 산다.
 *    실패는 상태로 돌려주고, 카드는 그림 자리를 비운다.
 * ⚠️ admin 클라이언트는 RLS를 우회한다 → 모든 조회·쓰기에 tenant_id를 건다(tenant-guard.test.ts가 잠근다).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { IJW_SCHEMAS } from "../contract";
import { isMissingIjwColumn } from "../db-errors";
import { parseJjSnapshot, snapshotFromDay, type JjReportSnapshot } from "../snapshot";
import { IJW_PATHS, ijwGet, type IjwFailure } from "./client";
import { localFailure } from "./links";

export type StudentJjDay =
  | { state: "unlinked" }
  /** `ijwId` = 짝은 알았는데 인재원 호출이 실패했을 때의 지금 짝(옛 짝 동결본을 가려내는 데 쓴다). */
  | { state: "error"; failure: IjwFailure; ijwId?: string }
  | { state: "ok"; snapshot: JjReportSnapshot };

/** 한 학생의 그날 인재원 자료(설명서 5번). 짝이 없으면 `unlinked`. */
export async function fetchStudentJjDay(tenantId: string, studentId: string, date: string): Promise<StudentJjDay> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("students")
    .select("ijw_student_id")
    .eq("tenant_id", tenantId)
    .eq("id", studentId)
    .maybeSingle();
  if (error) {
    if (isMissingIjwColumn(error)) return { state: "unlinked" };
    return { state: "error", failure: localFailure(error, "jj-day") };
  }
  const ijwId = (data as { ijw_student_id: string | null } | null)?.ijw_student_id ?? null;
  if (!ijwId) return { state: "unlinked" };
  const res = await ijwGet(tenantId, IJW_PATHS.day(ijwId, date), IJW_SCHEMAS.day);
  if (!res.ok) return { state: "error", failure: res, ijwId };
  return { state: "ok", snapshot: snapshotFromDay(res.data, new Date().toISOString()) };
}

/** 표가 아직 없다(0261a 적용 전) — 코드와 문구 둘 다 본다(다른 실패를 "적용 전"으로 오인하지 않게). */
export function isMissingSnapshotTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /report_jj_snapshots.*does not exist|Could not find the table.*report_jj_snapshots/i.test(error.message ?? "");
}

export type SnapshotWrite = { ok: true } | { ok: false; reason: "missing_table" | "failed"; detail?: string };

/** 보고서 한 장의 동결본을 덮어쓴다(보고서를 다시 저장할 때마다 새로 받은 값으로). */
export async function saveReportJjSnapshot(
  tenantId: string,
  reportId: string,
  snapshot: JjReportSnapshot,
): Promise<SnapshotWrite> {
  const admin = createAdminClient();
  try {
    const { error } = await admin.from("report_jj_snapshots").upsert(
      {
        lesson_report_id: reportId,
        tenant_id: tenantId,
        ijw_student_id: snapshot.ijwId,
        report_date: snapshot.date,
        payload: snapshot,
        fetched_at: snapshot.fetchedAt,
      },
      { onConflict: "lesson_report_id" },
    );
    if (!error) return { ok: true };
    if (isMissingSnapshotTable(error)) return { ok: false, reason: "missing_table" };
    reportError(error, { scope: "ijw", step: "snapshot-save" });
    return { ok: false, reason: "failed", detail: error.message?.slice(0, 200) };
  } catch (e) {
    reportError(e, { scope: "ijw", step: "snapshot-save" });
    return { ok: false, reason: "failed", detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

/**
 * 보고서 한 장의 동결본을 지운다 — 짝이 끊긴 뒤 다시 저장하면 **옛 짝(다른 아이일 수도 있다)의 자료**가 이 학생 카드에
 * 남지 않게(적대 리뷰 2026-09-11 — 결과지엔 학생 이름이 없어 아무도 못 알아챈다). 던지지 않는다.
 */
export async function deleteReportJjSnapshot(tenantId: string, reportId: string): Promise<void> {
  const admin = createAdminClient();
  try {
    const { error } = await admin
      .from("report_jj_snapshots")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("lesson_report_id", reportId);
    if (error && !isMissingSnapshotTable(error)) reportError(error, { scope: "ijw", step: "snapshot-delete" });
  } catch (e) {
    reportError(e, { scope: "ijw", step: "snapshot-delete" });
  }
}

/**
 * 이 보고서의 동결본이 **지금 짝이 아닌 계정**의 것이면 지운다 — 짝을 고친 뒤 인재원이 잠깐 안 될 때 다시 저장해도
 * 옛 짝(다른 아이일 수 있다)의 자료가 남아 그려지지 않게(적대 재리뷰 2026-09-11). 같은 짝의 옛 자료는 남긴다. 던지지 않는다.
 */
export async function deleteReportJjSnapshotIfNot(tenantId: string, reportId: string, ijwId: string): Promise<void> {
  const admin = createAdminClient();
  try {
    const { error } = await admin
      .from("report_jj_snapshots")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("lesson_report_id", reportId)
      .neq("ijw_student_id", ijwId);
    if (error && !isMissingSnapshotTable(error)) reportError(error, { scope: "ijw", step: "snapshot-delete-other" });
  } catch (e) {
    reportError(e, { scope: "ijw", step: "snapshot-delete-other" });
  }
}

/** 보고서 한 장의 동결본 — 없거나(표 없음 포함) 모양이 어긋나면 null. 던지지 않는다. */
export async function loadReportJjSnapshot(tenantId: string, reportId: string): Promise<JjReportSnapshot | null> {
  const admin = createAdminClient();
  try {
    const { data, error } = await admin
      .from("report_jj_snapshots")
      .select("payload")
      .eq("tenant_id", tenantId)
      .eq("lesson_report_id", reportId)
      .maybeSingle();
    if (error) {
      if (!isMissingSnapshotTable(error)) reportError(error, { scope: "ijw", step: "snapshot-load" });
      return null;
    }
    return parseJjSnapshot((data as { payload: unknown } | null)?.payload);
  } catch (e) {
    reportError(e, { scope: "ijw", step: "snapshot-load" });
    return null;
  }
}
