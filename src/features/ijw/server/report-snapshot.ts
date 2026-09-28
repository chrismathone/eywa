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
import { IJW_SCHEMAS, type IjwExamListItem, type IjwExamResult } from "../contract";
import { isMissingIjwColumn } from "../db-errors";
import { normalizeJjPick, parseJjSnapshot, snapshotFromDay, type JjReportSnapshot } from "../snapshot";
import { IJW_PATHS, ijwGet, type IjwFailure } from "./client";
import { localFailure } from "./links";

export type StudentJjDay =
  | { state: "unlinked" }
  /** `ijwId` = 짝은 알았는데 인재원 호출이 실패했을 때의 지금 짝(옛 짝 동결본을 가려내는 데 쓴다). */
  | { state: "error"; failure: IjwFailure; ijwId?: string }
  /** `options` = 고를 수 있는 결과지(2번 시험 목록, 단어장마다 마지막 제출·최신순) — 목록을 못 받았으면 빈 배열. */
  | { state: "ok"; snapshot: JjReportSnapshot; options: IjwExamListItem[] };

/**
 * 한 학생의 그날 인재원 자료(설명서 5번) + 고를 수 있는 결과지 목록(2번). 짝이 없으면 `unlinked`.
 *
 * `pick` — 강사가 고른 결과지(응시 id, 2026-09-28):
 * - `undefined` = 이 날짜에 **이미 저장해 둔 고르기**를 따른다(없으면 기본). 저장·발송이 고르기를 모르는 경로(일괄 발송·
 *   옛 화면)로 와도 고른 것이 풀리지 않게.
 * - `null` = 기본(그날 낸 응시 전부 — 종전 동작) · 배열 = 그 응시들(다른 날 것도 된다).
 * 🔴 고른 응시는 **이 학생의 것만** 받는다(결과지의 `student.id`가 짝과 다르면 버린다) — 화면이 보낸 id를 믿지 않는다([[#77]]).
 * 🔴 고른 것 중 하나라도 **못 받으면**(없는 응시 404 말고) 실패로 돌린다 — 일부만 붙은 결과지가 학부모에게 나가지 않게.
 */
export async function fetchStudentJjDay(
  tenantId: string,
  studentId: string,
  date: string,
  pick?: string[] | null,
): Promise<StudentJjDay> {
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
  // 하루치 · 시험 목록 · (모르면) 저장해 둔 고르기 — 서로 독립이라 함께(B4).
  const [res, list, saved] = await Promise.all([
    ijwGet(tenantId, IJW_PATHS.day(ijwId, date), IJW_SCHEMAS.day),
    ijwGet(tenantId, IJW_PATHS.studentExams(ijwId), IJW_SCHEMAS.studentExams),
    pick === undefined ? loadSavedJjPick(tenantId, ijwId, date) : Promise.resolve(null),
  ]);
  if (!res.ok) return { state: "error", failure: res, ijwId };
  const options = list.ok ? list.data.exams : [];
  const want = pick === undefined ? saved : normalizeJjPick(pick);
  let picked: { pick: string[]; exams: IjwExamResult[] } | null = null;
  if (want) {
    const got = await Promise.all(want.map((id) => ijwGet(tenantId, IJW_PATHS.examResult(id), IJW_SCHEMAS.examResult)));
    const exams: IjwExamResult[] = [];
    const kept: string[] = [];
    for (let i = 0; i < got.length; i++) {
      const r = got[i]!;
      if (!r.ok) {
        if (r.kind === "not_found") continue; // 지워진 응시 — 빼고 간다
        return { state: "error", failure: r, ijwId };
      }
      if (r.data.student.id !== ijwId) continue; // 남의 응시 — 버린다
      // 3번 응답의 `v`는 동결본을 다시 읽을 때 버려진다(스키마에 없는 키).
      exams.push({ ...r.data, attemptId: r.data.attemptId ?? want[i]! });
      kept.push(want[i]!);
    }
    picked = { pick: kept, exams };
  }
  return { state: "ok", snapshot: snapshotFromDay(res.data, new Date().toISOString(), picked), options };
}

/**
 * 이 학생·이 날짜 보고서에 **저장해 둔 고르기** — 없거나 기본이면 null. 던지지 않는다(못 읽으면 기본).
 * 🔑 짝(ijwId)으로 찾는다 — 동결본은 보고서마다 한 벌이고 영어 보고서는 학생·날짜마다 대개 하나다.
 */
async function loadSavedJjPick(tenantId: string, ijwId: string, date: string): Promise<string[] | null> {
  const admin = createAdminClient();
  try {
    const { data, error } = await admin
      .from("report_jj_snapshots")
      .select("payload")
      .eq("tenant_id", tenantId)
      .eq("ijw_student_id", ijwId)
      .eq("report_date", date)
      .limit(5);
    if (error) {
      if (!isMissingSnapshotTable(error)) reportError(error, { scope: "ijw", step: "snapshot-pick-load" });
      return null;
    }
    for (const row of (data ?? []) as { payload: unknown }[]) {
      const snap = parseJjSnapshot(row.payload);
      if (snap?.pick) return snap.pick;
    }
    return null;
  } catch (e) {
    reportError(e, { scope: "ijw", step: "snapshot-pick-load" });
    return null;
  }
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
