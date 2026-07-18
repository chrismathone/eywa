"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { canManageSheetSync, SHEET_ACCESS_DENIED_MSG } from "@/features/integrations/server/sheet-access";
import { canManageTimetableImport, TIMETABLE_IMPORT_DENIED_MSG } from "./import-access";
import { kstToday } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { EDIT_SHEET_NAME, parseEditSheet, rowsToEditRows } from "@/features/timetable/import/parse";
import { computeImportDiff, importDiffHash } from "@/features/timetable/import/diff";
import { getTenantSettings } from "@/features/owner/server/queries";
import { readSheetTabRows } from "@/features/integrations/google-sheets";
import { sheetsProvider, supportsTimetableImport } from "@/features/integrations/sheets-provider";
import {
  claimSheetSyncLease,
  releaseSheetSyncLease,
  SHEET_SYNC_BUSY_MSG,
  type SheetSyncLease,
} from "@/features/integrations/server/sheet-sync-lease";
import type {
  ClassRef,
  EnrollmentSnapshotRow,
  ImportDiff,
  StudentRef,
} from "@/features/timetable/import/types";

type Ctx = {
  current: EnrollmentSnapshotRow[];
  classes: ClassRef[];
  students: StudentRef[];
};

async function loadContext(): Promise<Ctx> {
  const supabase = await createClient();
  const enr = await fetchAllPaged<{
    id: string;
    class_id: string;
    student_id: string;
    start_date: string | null;
    class?: { class_name?: string; subject?: string } | { class_name?: string; subject?: string }[];
    student?:
      | { name?: string; school?: string | null; grade?: string | null }
      | { name?: string }[];
  }>((from, to) =>
    supabase
      .from("enrollments")
      .select(
        "id, class_id, student_id, start_date, class:class_id ( class_name, subject ), student:student_id ( name, school, grade )",
      )
      .is("end_date", null)
      .range(from, to),
  );
  const current: EnrollmentSnapshotRow[] = enr.map((e) => {
    const cls = (Array.isArray(e.class) ? e.class[0] : e.class) as
      | { class_name?: string; subject?: string }
      | undefined;
    const stu = (Array.isArray(e.student) ? e.student[0] : e.student) as
      | { name?: string; school?: string | null; grade?: string | null }
      | undefined;
    return {
      enrollmentId: e.id,
      studentId: e.student_id,
      studentName: stu?.name ?? "",
      school: stu?.school ?? null,
      grade: stu?.grade ?? null,
      classId: e.class_id,
      className: cls?.class_name ?? "",
      subject: cls?.subject ?? "",
      startDate: e.start_date ?? null,
    };
  });

  const cls = await fetchAllPaged<{ id: string; class_name: string; subject: string }>((from, to) =>
    supabase.from("classes").select("id, class_name, subject").eq("is_active", true).range(from, to),
  );
  const classes: ClassRef[] = cls.map((c) => ({
    classId: c.id,
    className: c.class_name,
    subject: c.subject,
  }));

  const stu = await fetchAllPaged<{
    id: string;
    name: string;
    school: string | null;
    grade: string | null;
  }>((from, to) => supabase.from("students").select("id, name, school, grade").range(from, to));
  const students: StudentRef[] = stu.map((s) => ({
    studentId: s.id,
    name: s.name,
    school: s.school,
    grade: s.grade,
  }));

  return { current, classes, students };
}

export type PreviewState = { error?: string; diff?: ImportDiff; hash?: string };

/**
 * 업로드 파일의 '수강편집' 시트 + 현 DB를 파싱·diff 재계산(무쓰기). preview·apply의 단일 소스 —
 * apply는 클라가 재전송한 같은 파일로 이 결과를 다시 얻어 미리보기 hash와 대조한다(영어 구조 computeFresh 패턴).
 */
async function computeFreshFromFile(file: File): Promise<{ error: string } | { diff: ImportDiff }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const parsed = parseEditSheet(wb);
  if (parsed.length === 0) {
    return { error: "'수강편집' 시트를 찾을 수 없습니다 (eywa에서 내보낸 엑셀인지 확인)" };
  }
  const ctx = await loadContext();
  return { diff: computeImportDiff(parsed, ctx.current, ctx.classes, ctx.students) };
}

/** 업로드 xlsx의 '수강편집' 시트를 파싱해 현재 DB와 diff. 읽기 전용(DB 미변경). */
export async function previewTimetableImport(formData: FormData): Promise<PreviewState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // ⚠️ full만 — 미리보기도 전 테넌트 수강 명단(diff)을 돌려주므로 읽기 자체가 누수다. 시트 경로와 대칭.
  if (!(await canManageTimetableImport(user.systemRole))) return { error: TIMETABLE_IMPORT_DENIED_MSG };
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "파일을 선택해주세요" };

  try {
    const fresh = await computeFreshFromFile(file);
    if ("error" in fresh) return { error: fresh.error };
    return { diff: fresh.diff, hash: importDiffHash(fresh.diff) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "엑셀 파싱 실패" };
  }
}

/**
 * 연결된 구글 시트의 '수강편집' 탭 + 현 DB를 지금 읽어 diff 재계산(무쓰기). preview·apply의 단일 소스 —
 * apply는 이 결과의 hash를 클라 미리보기 hash와 대조하고, 이 결과로 적용한다(클라 diff 불신).
 */
async function computeFreshFromSheet(subject: string): Promise<{ error: string } | { diff: ImportDiff }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_integrations")
    .select("spreadsheet_id, sync_enabled, last_synced_at")
    .eq("provider", sheetsProvider(subject))
    .maybeSingle();
  if (data?.sync_enabled !== true) {
    return { error: "구글 시트 연동이 꺼져 있습니다(학원 설정 › 연동에서 켜세요)" };
  }
  const legacyFallback =
    subject === "math" ? (await getTenantSettings()).notifications.googleSheetId.trim() : "";
  const spreadsheetId = data?.spreadsheet_id?.trim() || legacyFallback;
  if (!spreadsheetId) return { error: "대상 구글 시트가 설정되지 않았습니다(관리자에게 문의)" };

  const grid = await readSheetTabRows(spreadsheetId, EDIT_SHEET_NAME);
  const parsed = rowsToEditRows(grid);
  if (parsed.length === 0) {
    return { error: "'수강편집' 탭에 데이터가 없습니다(시트를 확인하세요)." };
  }
  const ctx = await loadContext();
  // stale-drift 보호: 시트 push(last_synced_at) 이후 등록된 수강은 삭제 후보에서 제외.
  const diff = computeImportDiff(parsed, ctx.current, ctx.classes, ctx.students, {
    protectNewerThan: data?.last_synced_at ?? null,
  });
  return { diff };
}

/**
 * 연결된 구글 시트의 '수강편집' 탭을 읽어 현재 DB와 diff(읽기 전용, DB 미변경).
 * 파일 업로드(previewTimetableImport)의 구글시트판 — 운영자가 시트에서 '반'만 바꾼 걸 되읽는다.
 * ⚠️ master 전용: 시트 전체(테넌트 전 강사·전 학생 명단)를 읽어 enrollment를 바꾸므로 syncSheetsNow와 대칭(B5 PII).
 * ⚠️ subject별 시트 분리 — provider는 `sheetsProvider(subject)`(math=레거시 `google_sheets`, 영어=`google_sheets:english`).
 *    settings.notifications.googleSheetId 폴백은 **수학 전용**(레거시 단일 연동). 적용은 applySheetImport(hash 재검증)
 *    — diff가 과목별 시트에서 나와도 삭제는 computeImportDiff가 시트 등장 과목으로 한정.
 */
export async function previewSheetImport(subject: string = "math"): Promise<PreviewState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageSheetSync(user.systemRole))) return { error: SHEET_ACCESS_DENIED_MSG };
  if (!supportsTimetableImport(subject)) return { error: "이 과목은 학생 반이동 가져오기를 지원하지 않습니다" };

  try {
    const fresh = await computeFreshFromSheet(subject);
    if ("error" in fresh) return { error: fresh.error };
    return { diff: fresh.diff, hash: importDiffHash(fresh.diff) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "시트 읽기 실패" };
  }
}

export type ApplyState = {
  error?: string;
  staleHash?: string; // hash 불일치 시 서버 재계산 hash — 클라가 미리보기를 지우고 재미리보기 유도
  applied?: { moved: number; removed: number; added: number };
  failed?: number;
  snapshotId?: string;
};

/**
 * 미리보기에서 확인한 변경을 적용 — **파일 경로**. 클라는 diff가 아니라 미리보기 hash + 같은 파일을
 * 재전송하고, 서버가 파일+DB를 재읽어 diff를 재계산해 hash 대조(영어 applyStructureImport와 동일 재검증).
 * 불일치 = preview~apply 사이 수강/반 변경(다른 관리자 이동, 시트 반영 등) → 중단 + staleHash 반환.
 *
 * `subject`를 주면 그 과목 시트 리스를 선점해 '시트 반영'과의 교차 실행을 직렬화한다(0098a, 다이얼로그가 넘김).
 * 미연동(norow)·미지정이면 리스 없이 진행. 재계산~적용 전 구간이 리스 안 — 검증 중 교차 실행도 차단.
 */
export async function applyTimetableImport(
  expectedHash: string,
  formData: FormData,
  subject?: string,
): Promise<ApplyState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // ⚠️ full만(시트 경로와 대칭) — applyDiff는 담당 반과 무관하게 아무 수강이나 이동·종료·생성한다.
  if (!(await canManageTimetableImport(user.systemRole))) return { error: TIMETABLE_IMPORT_DENIED_MSG };
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "파일이 없습니다 — 다시 선택 후 미리보기하세요" };

  const supabase = await createClient();
  const provider = subject ? sheetsProvider(subject) : null;
  let lease: SheetSyncLease = "norow";
  if (provider) {
    lease = await claimSheetSyncLease(supabase, provider);
    if (lease === "busy") return { error: SHEET_SYNC_BUSY_MSG };
  }
  try {
    let fresh;
    try {
      fresh = await computeFreshFromFile(file);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "엑셀 파싱 실패" };
    }
    if ("error" in fresh) return { error: fresh.error };

    // 서버 재검증 — 미리보기 이후 수강/반이 바뀌면 hash 불일치 → 중단(재미리보기 유도).
    const hash = importDiffHash(fresh.diff);
    if (hash !== expectedHash)
      return { error: "수강 정보가 미리보기 이후 변경되었습니다. 다시 미리보기 후 적용하세요.", staleHash: hash };
    return await applyDiff(user, supabase, fresh.diff);
  } finally {
    // ⚠️ return await 필수(위) — 프로미스만 반환하면 적용 완료 전에 리스가 풀린다.
    if (provider && lease === "claimed") await releaseSheetSyncLease(supabase, provider);
  }
}

/**
 * 미리보기에서 확인한 변경을 적용 — **구글 시트 경로**. 서버가 시트+DB를 재읽어 diff 재계산·hash 대조
 * (protectNewerThan 포함, preview와 동일 계산). 게이트는 previewSheetImport와 대칭(master 전용).
 * 시트 리스(0098a)를 잡고 재읽기~적용까지 수행 — '시트 반영'·다른 가져오기와 교차 실행 직렬화.
 */
export async function applySheetImport(expectedHash: string, subject: string = "math"): Promise<ApplyState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageSheetSync(user.systemRole))) return { error: SHEET_ACCESS_DENIED_MSG };
  if (!(await canWriteTenant(user.systemRole, "classes"))) return { error: "시간표 관리 권한이 없습니다" };
  if (!supportsTimetableImport(subject)) return { error: "이 과목은 학생 반이동 가져오기를 지원하지 않습니다" };

  const supabase = await createClient();
  const provider = sheetsProvider(subject);
  // norow(연동 행 없음)는 통과 — computeFreshFromSheet가 "연동 꺼짐" 안내로 떨어진다.
  const lease = await claimSheetSyncLease(supabase, provider);
  if (lease === "busy") return { error: SHEET_SYNC_BUSY_MSG };
  try {
    let fresh;
    try {
      fresh = await computeFreshFromSheet(subject);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "시트 읽기 실패" };
    }
    if ("error" in fresh) return { error: fresh.error };

    const hash = importDiffHash(fresh.diff);
    if (hash !== expectedHash)
      return { error: "시트 또는 수강 정보가 미리보기 이후 변경되었습니다. 다시 미리보기 후 적용하세요.", staleHash: hash };
    return await applyDiff(user, supabase, fresh.diff);
  } finally {
    if (lease === "claimed") await releaseSheetSyncLease(supabase, provider);
  }
}

/**
 * 서버가 재계산·hash 검증한 diff를 실제 적용(내부 전용 — 클라 diff는 받지 않음, 리스는 호출부가 보유).
 * 적용 직전 영향 enrollment를 timetable_snapshots에 백업하고 timetable_import_logs에 이력 기록.
 * moves는 일괄이동 RPC, removes는 end_date, adds는 insert. 모든 쓰기는 RLS(테넌트 격리) 하.
 */
async function applyDiff(
  user: { id: string; tenantId: string },
  supabase: Awaited<ReturnType<typeof createClient>>,
  diff: ImportDiff,
): Promise<ApplyState> {
  const today = kstToday();

  // 1) 스냅샷 — 영향 enrollment의 before 상태(이동·삭제 대상) 백업
  const affectedIds = [
    ...diff.moves.map((m) => m.enrollmentId),
    ...diff.removes.map((r) => r.enrollmentId),
  ];
  let snapshotId: string | undefined;
  if (affectedIds.length > 0 || diff.adds.length > 0) {
    const { data: snap } = await supabase
      .from("timetable_snapshots")
      .insert({
        tenant_id: user.tenantId,
        label: "엑셀 import",
        reference_date: today,
        summary: {
          moves: diff.moves.length,
          removes: diff.removes.length,
          adds: diff.adds.length,
        },
        payload: diff,
        created_by: user.id,
      })
      .select("id")
      .single();
    snapshotId = snap?.id;
  }

  let failed = 0;

  // 2) 이동 — 일괄이동 RPC 재사용
  if (diff.moves.length > 0) {
    const { data, error } = await supabase.rpc("move_enrollments_batch", {
      p_moves: diff.moves.map((m) => ({ enrollmentId: m.enrollmentId, newClassId: m.toClassId })),
    });
    if (error) return { error: error.message, snapshotId };
    failed += ((data ?? []) as { ok: boolean }[]).filter((r) => !r.ok).length;
  }

  // 3) 삭제 — end_date 세팅
  for (const r of diff.removes) {
    const { error } = await supabase
      .from("enrollments")
      .update({ end_date: today, withdrawal_reason: "엑셀 import 삭제" })
      .eq("id", r.enrollmentId);
    if (error) failed += 1;
  }

  // 4) 추가 — insert (GiST 충돌 시 실패 카운트)
  for (const a of diff.adds) {
    const { error } = await supabase.from("enrollments").insert({
      tenant_id: user.tenantId,
      student_id: a.studentId,
      class_id: a.classId,
      start_date: today,
    });
    if (error) failed += 1;
  }

  // 5) 이력 로그
  await supabase.from("timetable_import_logs").insert({
    tenant_id: user.tenantId,
    week_label: today,
    snapshot_id: snapshotId ?? null,
    result: {
      moved: diff.moves.length,
      removed: diff.removes.length,
      added: diff.adds.length,
      failed,
    },
    details: diff,
    actor_id: user.id,
  });

  revalidatePath("/timetable");
  return {
    applied: {
      moved: diff.moves.length,
      removed: diff.removes.length,
      added: diff.adds.length,
    },
    failed,
    snapshotId,
  };
}
