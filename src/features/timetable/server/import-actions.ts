"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { parseEditSheet } from "@/features/timetable/import/parse";
import { computeImportDiff } from "@/features/timetable/import/diff";
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
    class?: { class_name?: string } | { class_name?: string }[];
    student?:
      | { name?: string; school?: string | null; grade?: string | null }
      | { name?: string }[];
  }>((from, to) =>
    supabase
      .from("enrollments")
      .select(
        "id, class_id, student_id, class:class_id ( class_name ), student:student_id ( name, school, grade )",
      )
      .is("end_date", null)
      .range(from, to),
  );
  const current: EnrollmentSnapshotRow[] = enr.map((e) => {
    const cls = (Array.isArray(e.class) ? e.class[0] : e.class) as { class_name?: string } | undefined;
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

export type PreviewState = { error?: string; diff?: ImportDiff };

/** 업로드 xlsx의 '수강편집' 시트를 파싱해 현재 DB와 diff. 읽기 전용(DB 미변경). */
export async function previewTimetableImport(formData: FormData): Promise<PreviewState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "파일을 선택해주세요" };

  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const parsed = parseEditSheet(wb);
    if (parsed.length === 0) {
      return { error: "'수강편집' 시트를 찾을 수 없습니다 (eywa에서 내보낸 엑셀인지 확인)" };
    }
    const ctx = await loadContext();
    const diff = computeImportDiff(parsed, ctx.current, ctx.classes, ctx.students);
    return { diff };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "엑셀 파싱 실패" };
  }
}

export type ApplyState = {
  error?: string;
  applied?: { moved: number; removed: number; added: number };
  failed?: number;
  snapshotId?: string;
};

/**
 * 미리보기에서 확인한 diff를 적용. 적용 직전 영향 enrollment를 timetable_snapshots에 백업하고
 * timetable_import_logs에 이력 기록. moves는 일괄이동 RPC, removes는 end_date, adds는 insert.
 * 모든 쓰기는 RLS(테넌트 격리) 하 — 조작된 diff도 본 테넌트를 벗어나지 못함.
 */
export async function applyTimetableImport(diff: ImportDiff): Promise<ApplyState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

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
