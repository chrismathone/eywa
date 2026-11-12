"use server";
import { canManageStudentStatusNow } from "@/features/students/server/status-access";
import { STUDENT_STATUS_DENIED } from "@/features/students/status-access";

import { licenseBlockReason } from "@/lib/license/server";
import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { logAction } from "@/features/audit/server/log";
import { canManageSheetSync, SHEET_ACCESS_DENIED_MSG } from "@/features/integrations/server/sheet-access";
import { canManageTimetableImport, TIMETABLE_IMPORT_DENIED_MSG } from "./import-access";
import { kstToday } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { EDIT_SHEET_NAME, parseEditSheet, rowsToEditRows } from "@/features/timetable/import/parse";
import { computeImportDiff, importDiffHash } from "@/features/timetable/import/diff";
import { normalizeEffectiveDate } from "@/features/timetable/import/effective-date";
import { resolveImportSheet } from "./sheet-target";
import { readSheetTabRows } from "@/features/integrations/google-sheets";
import { sheetsProvider, supportsTimetableImport } from "@/features/integrations/sheets-provider";
import {
  claimSheetSyncLease,
  releaseSheetSyncLease,
  SHEET_SYNC_BUSY_MSG,
  type SheetSyncLease,
} from "@/features/integrations/server/sheet-sync-lease";
import { enrollmentOnHoldForStatus } from "@/features/enrollments/eligibility";
import type {
  ClassRef,
  EnrollmentSnapshotRow,
  ImportDiff,
  StudentRef,
} from "@/features/timetable/import/types";
import { explainDbError } from "@/lib/supabase/db-error";

type Ctx = {
  current: EnrollmentSnapshotRow[];
  classes: ClassRef[];
  students: StudentRef[];
};

async function loadContext(): Promise<Ctx> {
  const supabase = await createClient();
  // 셋은 서로의 결과를 안 쓰는 독립 조회 → 직렬 await 금지(B4). 미리보기·적용마다 도는 경로라
  // 워터폴이면 라운드트립이 그대로 합산된다(구조 import의 loadStructureContext는 이미 Promise.all).
  // ⚠️ 세 쿼리 모두 order 없는 .range()는 페이지 경계에서 행이 누락·중복될 수 있다. 이 스냅샷은 diff의
  // '현재 DB' 쪽이라 누락 = 오판(중복 생성·잘못된 삭제)으로 이어진다 → id unique tie-break(batch.ts 계약).
  const [enr, cls, stu] = await Promise.all([
    fetchAllPaged<{
      id: string;
      class_id: string;
      student_id: string;
      start_date: string | null;
      created_at: string | null;
      class?: { class_name?: string; subject?: string } | { class_name?: string; subject?: string }[];
      student?:
        | { name?: string; school?: string | null; grade?: string | null }
        | { name?: string }[];
    }>((from, to) =>
      supabase
        .from("enrollments")
        .select(
          "id, class_id, student_id, start_date, created_at, class:class_id ( class_name, subject ), student:student_id ( name, school, grade )",
        )
        .is("end_date", null)
        .order("id")
        .range(from, to),
    ),
    fetchAllPaged<{ id: string; class_name: string; subject: string }>((from, to) =>
      supabase
        .from("classes")
        .select("id, class_name, subject")
        .eq("is_active", true)
        .order("id")
        .range(from, to),
    ),
    fetchAllPaged<{
      id: string;
      name: string;
      school: string | null;
      grade: string | null;
    }>((from, to) =>
      supabase.from("students").select("id, name, school, grade").order("id").range(from, to),
    ),
  ]);

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
      createdAt: e.created_at ?? null,
    };
  });

  const classes: ClassRef[] = cls.map((c) => ({
    classId: c.id,
    className: c.class_name,
    subject: c.subject,
  }));

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
    return { error: "'수강편집' 시트를 찾을 수 없습니다 (에이와에서 내보낸 엑셀인지 확인)" };
  }
  const ctx = await loadContext();
  // stale-drift 보호(파일 경로) — 시트 경로가 `last_synced_at`을 쓰듯, 파일은 **워크북 생성 시각**을 쓴다.
  // aywa 익스포터가 `wb.created`를 찍으므로 그 이후 시작된 수강은 이 파일이 알 수 없는 신규 →
  // 삭제 후보에서 제외한다. 옛 코드는 이 인자를 안 넘겨(보호 0) 오래된 파일을 다시 올리면 그 사이
  // 새로 만들어진 수강이 '시트에 없음' = 종료 대상이 됐다(적대 감사 F5).
  // 엑셀에서 재저장돼 created가 늦춰져도 **보호 범위가 넓어지는** 안전한 방향이라 폴백이 위험하지 않다.
  const createdAt =
    wb.created instanceof Date && !Number.isNaN(wb.created.getTime())
      ? wb.created.toISOString().slice(0, 10)
      : null;
  return {
    diff: computeImportDiff(parsed, ctx.current, ctx.classes, ctx.students, {
      protectNewerThan: createdAt,
    }),
  };
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
  const target = await resolveImportSheet(subject);
  if ("error" in target) return target;

  const grid = await readSheetTabRows(target.spreadsheetId, EDIT_SHEET_NAME);
  const parsed = rowsToEditRows(grid);
  if (parsed.length === 0) {
    return { error: "'수강편집' 탭에 데이터가 없습니다(시트를 확인하세요)." };
  }
  const ctx = await loadContext();
  // stale-drift 보호: 시트 push(last_synced_at) 이후 등록된 수강은 삭제 후보에서 제외.
  const diff = computeImportDiff(parsed, ctx.current, ctx.classes, ctx.students, {
    protectNewerThan: target.lastSyncedAt,
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
  {
    // 지점 라이선스(google_sheets) — 슈퍼관리자가 끈 지점은 시트를 읽고 쓰지 않는다(행 없음 = 허용).
    const blocked = await licenseBlockReason(user.tenantId, "google_sheets");
    if (blocked) return { error: blocked };
  }
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
  /** 추가분 중 **휴원 학생이라 휴원 표식을 달고 들어간** 건수 — 조용히 넘어가면 나중에 "왜 안 뜨지"가 된다. */
  heldAdds?: number;
  failed?: number;
  /** 실제로 적용된 날짜 — 오늘이 아닐 수 있다(예약 적용). 화면이 "며칠부터"를 이 값으로 말한다. */
  effectiveDate?: string;
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
  effectiveDateRaw?: string,
): Promise<ApplyState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // ⚠️ full만(시트 경로와 대칭) — applyDiff는 담당 반과 무관하게 아무 수강이나 이동·종료·생성한다.
  if (!(await canManageTimetableImport(user.systemRole))) return { error: TIMETABLE_IMPORT_DENIED_MSG };
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "파일이 없습니다 — 다시 선택 후 미리보기하세요" };
  // 🔴 적용일은 클라 값을 그대로 쓰지 않는다 — 서버가 같은 순수 규칙으로 재검증(과거·상한 초과 거절).
  const eff = normalizeEffectiveDate(effectiveDateRaw, kstToday());
  if ("error" in eff) return { error: eff.error };

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
    return await applyDiff(user, supabase, fresh.diff, eff.date, { kind: "file", subject });
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
export async function applySheetImport(
  expectedHash: string,
  subject: string = "math",
  effectiveDateRaw?: string,
): Promise<ApplyState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageSheetSync(user.systemRole))) return { error: SHEET_ACCESS_DENIED_MSG };
  {
    // 지점 라이선스(google_sheets) — 슈퍼관리자가 끈 지점은 시트를 읽고 쓰지 않는다(행 없음 = 허용).
    const blocked = await licenseBlockReason(user.tenantId, "google_sheets");
    if (blocked) return { error: blocked };
  }
  if (!(await canWriteTenant(user.systemRole, "classes"))) return { error: "시간표 관리 권한이 없습니다" };
  if (!supportsTimetableImport(subject)) return { error: "이 과목은 학생 반이동 가져오기를 지원하지 않습니다" };
  const eff = normalizeEffectiveDate(effectiveDateRaw, kstToday());
  if ("error" in eff) return { error: eff.error };

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
    return await applyDiff(user, supabase, fresh.diff, eff.date, { kind: "sheet", subject });
  } finally {
    if (lease === "claimed") await releaseSheetSyncLease(supabase, provider);
  }
}

/**
 * 서버가 재계산·hash 검증한 diff를 실제 적용(내부 전용 — 클라 diff는 받지 않음, 리스는 호출부가 보유).
 * 적용 직전 영향 enrollment를 timetable_snapshots에 백업하고 timetable_import_logs에 이력 기록.
 * moves는 일괄이동 RPC, removes는 end_date, adds는 insert. 모든 쓰기는 RLS(테넌트 격리) 하.
 *
 * `effective` = **적용 기준일**(호출부가 서버 검증을 마쳐 넘긴다). 오늘이면 종전과 완전히 같고,
 * 미래면 그 날짜부터 반이 갈린다: 옛 수강은 그날 종료(`end_date`), 새 수강은 그날 시작(`start_date`).
 * ⚠️ 이 함수는 날짜를 스스로 정하지 않는다 — 세 쓰기(이동·종료·추가)가 **한 날짜**를 써야 하기 때문이다.
 */
async function applyDiff(
  user: { id: string; tenantId: string },
  supabase: Awaited<ReturnType<typeof createClient>>,
  diff: ImportDiff,
  effective: string,
  /** 감사로그에 남길 출처 — 같은 결과라도 "엑셀 파일을 올린 것"과 "시트를 되읽은 것"은 다른 사건이다. */
  source: { kind: "file" | "sheet"; subject?: string },
): Promise<ApplyState> {
  const today = effective;
  if (diff.removes.length && !(await canManageStudentStatusNow())) return { error: STUDENT_STATUS_DENIED };

  // 1) 스냅샷 — 영향 enrollment의 before 상태(이동·삭제 대상) 백업
  const affectedIds = [
    ...diff.moves.map((m) => m.enrollmentId),
    ...diff.removes.map((r) => r.enrollmentId),
  ];
  let snapshotId: string | undefined;
  if (affectedIds.length > 0 || diff.adds.length > 0) {
    // 🔴 오류를 반드시 확인한다(2026-08-29 적대 리뷰 codex). 예전엔 `{ data: snap }`만 받아서, 스냅샷
    //    insert가 실패해도 `snapshotId=undefined`인 채 **이동·삭제·추가를 그대로 적용**했다 —
    //    되돌릴 수 없는 적용이 조용히 생긴다("취소" 배지가 되돌릴 대상 자체를 못 찾는다).
    //    스냅샷은 이 기능의 안전벨트라, 못 매면 출발하지 않는다.
    const { data: snap, error: snapErr } = await supabase
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
    if (snapErr || !snap?.id) {
      console.error("[timetable-import] 스냅샷 저장 실패:", snapErr);
      return {
        error:
          "되돌리기용 스냅샷을 저장하지 못해 적용을 중단했습니다(변경 없음). 잠시 후 다시 시도해 주세요.",
      };
    }
    snapshotId = snap.id;
  }

  let failed = 0;
  let heldAdds = 0;

  /**
   * 감사로그 한 줄 요약 — 위 `timetable_import_logs`는 **화면 소비처가 없는** 쓰기 전용 이력이라, 한 번에
   * 수백 건이 움직이는 이 동작이 원장이 보는 감사로그 화면에서는 통째로 안 보였다(원장 2026-09-09
   * *"기능이 추가되거나 변동되는건 모두 감사로그에 남도록"*). 건별이 아니라 요약으로 남기되 되돌릴
   * 근거(`snapshotId`)와 언제부터인지(`effectiveDate`)를 반드시 싣는다 — 건별 명단은 스냅샷 payload에
   * 이미 있고, 여기까지 실으면 한 줄이 수백 줄이 되어 정작 삭제·퇴원 줄이 묻힌다.
   *
   * 🔴 `abortedAt`이 있는 호출 = **일부만 적용된 채 중단된** 경우다. 이 경로는 `timetable_import_logs`
   *    조차 안 남아서(중단이 그 insert보다 앞이다) 수강 수백 건이 바뀌고도 흔적이 0이었다 — 되돌릴
   *    근거가 가장 필요한 경우라 오히려 반드시 남긴다.
   */
  const logImport = (abortedAt?: string) =>
    logAction({
      action: "timetable_import_apply",
      targetType: "timetable",
      targetLabel: source.kind === "sheet" ? "구글 시트 수강편집" : "엑셀 수강편집",
      metadata: {
        source: source.kind,
        subject: source.subject ?? null,
        effectiveDate: today,
        moved: diff.moves.length,
        removed: diff.removes.length,
        // 중단이면 '추가'는 한 건도 안 들어갔다 — 계획 수를 적으면 안 한 일을 했다고 적는 셈이다.
        added: abortedAt ? 0 : diff.adds.length,
        heldAdds,
        // ⚠️ `failed`도 싣는다: "적용했는데 몇 건은 안 들어갔다"가 나중에 유일한 단서가 된다.
        failed,
        snapshotId: snapshotId ?? null,
        ...(abortedAt ? { abortedAt } : {}),
      },
    });

  // 2) 이동 — 일괄이동 RPC 재사용
  if (diff.moves.length > 0) {
    // ⚠️ 분리등원(attendance_days) 승계 — RPC는 attendanceDays 미지정 시 '{}'(=전 요일)로 새 수강을 만든다.
    // 그래서 목요일만 오던 학생이 시트 '반' 열 수정만으로 조용히 **전 요일 등원**이 됐다(적대 감사 M5).
    // 시트엔 요일 열이 없어 사용자 의도를 알 수 없으므로 **원본 값을 그대로 승계**하는 것이 옳다.
    // id(PK) 조회라 청크당 행 수 ≤ 청크 크기 → fetchInChunks로 충분(1000행 캡 무관).
    const dayRows = await fetchInChunks<{ id: string; attendance_days: string[] | null }>(
      diff.moves.map((m) => m.enrollmentId),
      (chunk) => supabase.from("enrollments").select("id, attendance_days").in("id", chunk),
    );
    const daysByEnrollment = new Map(dayRows.map((r) => [r.id, r.attendance_days ?? []]));

    const { data, error } = await supabase.rpc("move_enrollments_batch", {
      // ⚠️ 넘기지 않으면 RPC 기본값 `current_date`(DB 서버 시각)로 떨어진다 — KST 자정 근처에서 하루가
      //    어긋나고, 예약 적용은 아예 불가능하다. 적용일은 항상 명시한다.
      p_effective_date: effective,
      p_moves: diff.moves.map((m) => ({
        enrollmentId: m.enrollmentId,
        newClassId: m.toClassId,
        attendanceDays: daysByEnrollment.get(m.enrollmentId) ?? [],
      })),
    });
    if (error) return { error: explainDbError(error, { scope: "timetable.import-actions.applyDiff", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message, snapshotId };
    const results = (data ?? []) as { enrollmentId: string; newEnrollmentId?: string; ok: boolean }[];
    failed += results.filter((r) => !r.ok).length;
    // 🔑 RPC(0235a)가 준 **새 수강 id**를 diff에 적어 둔다 — 아래에서 스냅샷 payload를 갱신하면
    //    되돌리기가 좌표(학생+반+시작일) 추측 없이 이 행만 정확히 지운다(0236a).
    //    ⚠️ 0235a 적용 전 DB에선 이 키가 없다 → undefined로 남고 롤백은 옛 좌표 폴백을 탄다(무중단).
    const newIdByOld = new Map(
      results.filter((r) => r.ok && r.newEnrollmentId).map((r) => [r.enrollmentId, r.newEnrollmentId!]),
    );
    for (const m of diff.moves) {
      const id = newIdByOld.get(m.enrollmentId);
      if (id) m.newEnrollmentId = id;
    }
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
  // 🔴 **휴원 표식 승계**(원장 2026-08-20 "휴원 해결"). 이 경로는 `createEnrollment`를 안 거쳐 학생 상태를
  //    보지 않았고, 그래서 시트에 휴원 학생 이름이 있으면 `on_hold` 기본값 false로 **활성 수강**이 새로
  //    생겼다(로스터는 수강의 on_hold만 보고 학생 상태는 안 본다 → 학생목록엔 휴원인데 출석부엔 그대로).
  //    시트는 *"어느 반인가"*의 진실이지 *"휴원인가"*의 진실이 아니므로 **거절·스킵이 아니라 승계**한다
  //    (반 이동 RPC 0228a와 같은 결). ⚠️ 조용히 건너뛰면 "왜 이 아이만 안 들어왔지"가 된다 — 넣되
  //    승계 건수를 결과에 적는다. 판정은 enrollmentOnHoldForStatus 단일 소스.
  //    id(PK) 조회라 청크당 행 수 ≤ 청크 크기 → fetchInChunks로 충분(1000행 캡 무관, B3).
  if (diff.adds.length > 0) {
    // ⚠️ fetchInChunks는 error를 삼키지 않고 **throw**한다(B3) — 여기서 새어 나가면 이미 적용된
    //    이동·삭제를 남긴 채 서버 액션이 통째로 실패한다(다이얼로그는 결과를 못 받는다). 위 이동 RPC
    //    실패와 **같은 모양**으로 중단한다: 적용된 만큼은 남고, 추가는 하지 않으며, 이유를 한글로 돌려준다.
    let statusById: Map<string, string | null>;
    try {
      const statusRows = await fetchInChunks<{ id: string; status: string | null }>(
        [...new Set(diff.adds.map((a) => a.studentId))],
        (chunk) => supabase.from("students").select("id, status").in("id", chunk),
      );
      statusById = new Map(statusRows.map((r) => [r.id, r.status]));
    } catch (e) {
      console.error("[timetable-import] 학생 상태 조회 실패:", e);
      // 이동·삭제는 이미 커밋됐다 — 중단이라고 흔적을 안 남기면 그 변경이 통째로 무기록이 된다.
      await logImport("student_status_lookup");
      return {
        error:
          "학생 상태를 확인하지 못해 '추가'를 중단했습니다(이동·삭제는 적용됨). 잠시 후 다시 시도해 주세요.",
        snapshotId,
      };
    }

    for (const a of diff.adds) {
      const onHold = enrollmentOnHoldForStatus(statusById.get(a.studentId));
      // `.select("id")` — 만들어진 수강 id를 되돌리기용으로 적어 둔다(moves와 같은 이유).
      const { data: made, error } = await supabase
        .from("enrollments")
        .insert({
          tenant_id: user.tenantId,
          student_id: a.studentId,
          class_id: a.classId,
          start_date: today,
          on_hold: onHold,
        })
        .select("id")
        .single();
      if (error) failed += 1;
      else {
        if (made?.id) a.enrollmentId = made.id as string;
        if (onHold) heldAdds += 1;
      }
    }
  }

  // 4-b) 스냅샷 payload 갱신 — 위에서 채운 새 수강 id를 되돌리기가 읽을 수 있게 적는다.
  // ⚠️ 실패해도 **적용을 되돌리지 않는다**(이미 쓴 것을 다시 지우는 편이 더 위험하다). 롤백은 옛 좌표
  //    폴백으로 여전히 동작하므로, 여기 실패는 "되돌리기가 조금 덜 정확해지는" 정도의 열화다 — 로그만 남긴다.
  if (snapshotId && (diff.moves.some((m) => m.newEnrollmentId) || diff.adds.some((a) => a.enrollmentId))) {
    const { error: patchErr } = await supabase
      .from("timetable_snapshots")
      .update({ payload: diff })
      .eq("id", snapshotId);
    if (patchErr) console.error("[timetable-import] 스냅샷 id 기록 실패(롤백은 좌표 폴백):", patchErr);
  }

  // 5) 이력 로그 — ⚠️ `week_label`은 이제 **적용 기준일**이다(누른 날이 아니라). 예약 적용이면 둘이 다르고,
  //    "언제 눌렀나"는 행의 created_at에 남는다. 화면 소비처는 없다(쓰기 전용 이력).
  await supabase.from("timetable_import_logs").insert({
    tenant_id: user.tenantId,
    week_label: today,
    snapshot_id: snapshotId ?? null,
    result: {
      moved: diff.moves.length,
      removed: diff.removes.length,
      added: diff.adds.length,
      heldAdds,
      failed,
    },
    details: diff,
    actor_id: user.id,
  });

  // 6) 감사로그(위 logImport 주석 참조). ⚠️ 변경이 0건이면 남기지 않는다 — 미리보기와 같은 결과라
  //    아무 행도 안 바뀌었는데 "가져오기 반영" 줄이 서면 감사로그가 헛줄로 늘어난다.
  const changed = diff.moves.length + diff.removes.length + diff.adds.length;
  if (changed > 0) await logImport();

  revalidatePath("/timetable");
  return {
    applied: {
      moved: diff.moves.length,
      removed: diff.removes.length,
      added: diff.adds.length,
    },
    heldAdds,
    failed,
    effectiveDate: today,
    snapshotId,
  };
}
