"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { listMakeupPoolClassIds } from "@/features/attendance/server/makeup-pool";
import type { TransferCandidate } from "../bulk-transfer";
import type { TransferSourceClass } from "../transfer-roster";

/**
 * 반 상세 '학생 배정' 창의 **반이동 = 반 먼저**(원장 2026-10-01) 재료 두 가지 — 옮겨 올 반 목록, 그 반 명단.
 *
 * 🔴 **토글을 켤 때·반을 고를 때만** 부른다 — 반 상세 첫 화면에 미리 싣지 않는다(반응속도, `listMovableEnrollments`와 같은 원칙).
 * 🔴 게이트는 **이동을 만드는 것과 같은 문**(`canManageTenant("classes")` — `moveEnrollmentsBatch`와 동일, [[#77]]).
 * 🔑 저장 계약은 그대로다 — 여기서 고른 수강 id가 종전처럼 `moveEnrollmentsBatch`로 간다.
 */
type Result<T> = { ok: true; items: T[] } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TransferUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

async function transferUser(): Promise<{ user: TransferUser } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageTenant(user.systemRole, "classes")))
    return { error: "반 이동은 관리자만 할 수 있습니다" };
  return { user };
}

/**
 * 옮겨 올 수 있는 반 = 운영 중인 반 전부(목적지·보이지 않는 '보강' 반 제외). 정렬은 화면이 한다.
 * 🔑 종강일이 **지난** 반(`closed_at` < 오늘)은 뺀다 — 종강 처리가 수강을 그날로 닫아 이동일(오늘 이후) 명단이 늘 비어 있다.
 *    종강일 당일은 아직 운영일이라 남긴다(오늘 바로 옮기는 경우).
 */
export async function listTransferSourceClasses(targetClassId: string): Promise<Result<TransferSourceClass>> {
  const gate = await transferUser();
  if ("error" in gate) return { ok: false, error: gate.error };
  const { user } = gate;
  const db = await createClient();
  try {
    // 반 수가 1,000을 넘어도 잘리지 않게 페이징한다([[#54]]). '보강' 반 id는 따로(0241a 미적용이면 빈 배열, [[#95]]).
    const [rows, poolIds] = await Promise.all([
      fetchAllPaged((from, to) =>
        db.from("classes")
          .select("id, class_name, subject, teacher:teacher_id ( display_name )")
          .eq("tenant_id", user.tenantId)
          .eq("is_active", true)
          .or(`closed_at.is.null,closed_at.gte.${kstToday()}`)
          .order("id")
          .range(from, to),
      ),
      listMakeupPoolClassIds(),
    ]);
    const hidden = new Set([...poolIds, targetClassId]);
    const items = rows
      .filter((r) => !hidden.has(String(r.id)))
      .map((r) => {
        const teacher = (Array.isArray(r.teacher) ? r.teacher[0] : r.teacher) as { display_name?: string } | null;
        return {
          id: String(r.id),
          className: String(r.class_name),
          subject: String(r.subject ?? ""),
          teacherName: teacher?.display_name ?? null,
        };
      });
    return { ok: true, items };
  } catch {
    return { ok: false, error: "반 목록을 불러오지 못했습니다. 다시 시도해 주세요." };
  }
}

/**
 * 고른 반의 **아직 안 끝난 수강**(오늘 이후 종료·종료 없음) — 이동일 기준 명단 판정은 화면이
 * `transferRosterChoices`(→ `isEnrollmentOnRosterOn`)로 한다. 이동일은 오늘 이후라 이 범위가 늘 넉넉하다.
 * 모양은 단체 반 이동 후보(`listClassTransferCandidates`)와 같다 — 같은 반을 두 경로가 같은 눈으로 본다.
 */
export async function listClassTransferRoster(classId: string): Promise<Result<TransferCandidate>> {
  const gate = await transferUser();
  if ("error" in gate) return { ok: false, error: gate.error };
  const { user } = gate;
  if (!UUID.test(classId)) return { ok: false, error: "반을 확인할 수 없습니다" };
  const db = await createClient();
  try {
    const rows = await fetchAllPaged((from, to) =>
      db.from("enrollments")
        .select("id, student_id, start_date, end_date, attendance_days, on_hold, is_transferred")
        .eq("tenant_id", user.tenantId)
        .eq("class_id", classId)
        .or(`end_date.is.null,end_date.gte.${kstToday()}`)
        .order("id")
        .range(from, to),
    );
    const students = await fetchInChunks([...new Set(rows.map((r) => String(r.student_id)))], (ids) =>
      db.from("students").select("id, name, school, grade").eq("tenant_id", user.tenantId).in("id", ids),
    );
    const byId = new Map(students.map((s) => [String(s.id), s]));
    const items: TransferCandidate[] = rows.map((r) => {
      const student = byId.get(String(r.student_id));
      if (!student) throw new Error("student_missing");
      return {
        id: String(r.id),
        name: student.name,
        school: student.school,
        grade: student.grade,
        snapshot: {
          studentId: String(r.student_id),
          startDate: r.start_date,
          endDate: r.end_date,
          onHold: r.on_hold,
          isTransferred: r.is_transferred,
          attendanceDays: r.attendance_days ?? [],
        },
      };
    });
    items.sort((a, b) => a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id));
    return { ok: true, items };
  } catch {
    return { ok: false, error: "학생 목록을 불러오지 못했습니다. 반을 다시 선택해 주세요." };
  }
}
