"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";

// 강의실(classrooms 테이블) CRUD — 운영 체계 "강의실" 카드에서 호출. 학원 설정(owner 메뉴)과 동일 게이트.
// ⚠️ 하드코딩 master 체크 금지(#58) — 원장이 역할·권한에서 admin/manager에게 owner를 위임(override)하면
// 강의실 관리도 함께 열려야 한다(2026-07-06 "관리자가 강의실 추가를 못함" 실버그).
// classes/schedules의 classroom_id FK는 onDelete:set null이라, 삭제 시 참조 반의 강의실만 미지정으로 바뀐다.

export type ClassroomActionState = { error?: string; ok?: boolean } | undefined;

async function gate() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "owner"))) {
    return { error: "학원 설정(owner) 변경 권한이 없습니다" as const };
  }
  return { user };
}

function readRoom(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const capRaw = String(formData.get("capacity") ?? "").trim();
  const n = Number(capRaw);
  const capacity = capRaw !== "" && Number.isFinite(n) ? Math.max(0, Math.min(9999, Math.round(n))) : null;
  return { name, capacity };
}

function refresh() {
  // 강의실은 owner 설정 + 반/시간표 드롭다운의 단일 소스 → 소비처 라우트 함께 갱신.
  revalidatePath("/owner");
  revalidatePath("/classes");
  revalidatePath("/timetable");
}

export async function createClassroom(
  _prev: ClassroomActionState,
  formData: FormData,
): Promise<ClassroomActionState> {
  const g = await gate();
  if ("error" in g) return g;
  const { name, capacity } = readRoom(formData);
  if (!name) return { error: "강의실 이름을 입력해주세요" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("classrooms")
    .insert({ tenant_id: g.user.tenantId, name, capacity });
  if (error) return { error: error.code === "23505" ? "같은 이름의 강의실이 이미 있습니다" : error.message };

  await logAction({ action: "classroom_create", targetType: "classroom", targetLabel: name });
  refresh();
  return { ok: true };
}

export async function updateClassroom(
  _prev: ClassroomActionState,
  formData: FormData,
): Promise<ClassroomActionState> {
  const g = await gate();
  if ("error" in g) return g;
  const id = String(formData.get("id") ?? "").trim();
  const { name, capacity } = readRoom(formData);
  if (!id) return { error: "강의실 ID가 누락되었습니다" };
  if (!name) return { error: "강의실 이름을 입력해주세요" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("classrooms")
    .update({ name, capacity })
    .eq("id", id)
    .eq("tenant_id", g.user.tenantId);
  if (error) return { error: error.code === "23505" ? "같은 이름의 강의실이 이미 있습니다" : error.message };

  refresh();
  return { ok: true };
}

/**
 * 정원만 갱신 — 시간표 교실뷰의 인라인 정원 편집용(원장 요청 2026-08-03). 이름은 건드리지 않는다
 * (교실뷰에서 stale 이름을 함께 보내면 owner 화면의 동시 개명을 덮는다). 게이트는 위와 동일(owner 쓰기).
 */
export async function updateClassroomCapacity(
  _prev: ClassroomActionState,
  formData: FormData,
): Promise<ClassroomActionState> {
  const g = await gate();
  if ("error" in g) return g;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "강의실 ID가 누락되었습니다" };
  const capRaw = String(formData.get("capacity") ?? "").trim();
  const n = Number(capRaw);
  const capacity = capRaw !== "" && Number.isFinite(n) ? Math.max(0, Math.min(9999, Math.round(n))) : null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("classrooms")
    .update({ capacity })
    .eq("id", id)
    .eq("tenant_id", g.user.tenantId);
  if (error) return { error: error.message };

  refresh();
  return { ok: true };
}

export async function deleteClassroom(
  _prev: ClassroomActionState,
  formData: FormData,
): Promise<ClassroomActionState> {
  const g = await gate();
  if ("error" in g) return g;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "강의실 ID가 누락되었습니다" };

  const supabase = await createClient();
  // 감사로그에 UUID 대신 강의실명을 남기려 삭제 전 이름 확보(createClassroom과 대칭).
  const { data: room } = await supabase
    .from("classrooms")
    .select("name")
    .eq("id", id)
    .eq("tenant_id", g.user.tenantId)
    .maybeSingle();

  // 🔴 **참조가 하나라도 있으면 삭제하지 않는다**(원장 2026-08-05: "강의실 삭제하더라도 미지정으로
  //    바뀌지않고 그대로 남겨져있어야해"). FK가 on delete set null이라 지우는 순간 그 반·슬롯이 전부
  //    미지정이 되고 되돌릴 수단이 없다. 대신 **보관(archive)**을 쓴다 — 목록·선택지에서만 빠지고
  //    배정은 그대로 남는다(0182a). 하드 삭제는 **참조 0건**(잘못 만든 방)에만 남겨 둔다.
  const refs = await countClassroomRefs(supabase, id);
  if (refs > 0) {
    return {
      error: `이 강의실을 쓰는 반·시간표가 ${refs}건 있어 삭제할 수 없습니다 — '숨기기'를 쓰면 배정은 그대로 두고 목록에서만 빠집니다`,
    };
  }

  const { error } = await supabase
    .from("classrooms")
    .delete()
    .eq("id", id)
    .eq("tenant_id", g.user.tenantId);
  if (error) return { error: error.message };

  await logAction({
    action: "classroom_delete",
    targetType: "classroom",
    targetLabel: (room?.name as string | undefined) ?? id,
  });
  refresh();
  return { ok: true };
}

/** 이 강의실을 가리키는 반·슬롯 수(만료 배치 포함 — **하나라도 있으면 미지정 전환이 일어나므로** 다 센다). */
async function countClassroomRefs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roomId: string,
): Promise<number> {
  // 행을 받지 않는 count 조회(B2) — 두 표면이 독립이라 병렬(B4).
  const [cls, slots] = await Promise.all([
    supabase.from("classes").select("id", { count: "exact", head: true }).eq("classroom_id", roomId),
    supabase.from("class_schedules").select("id", { count: "exact", head: true }).eq("classroom_id", roomId),
  ]);
  return (cls.count ?? 0) + (slots.count ?? 0);
}

/**
 * 강의실 **보관/복원**(0182a) — 삭제 대신 숨긴다.
 * 보관하면 새 배정 선택지에서 빠지지만 **이미 배정된 반·슬롯은 그 방을 그대로 가리킨다**(시간표에 계속 보인다).
 * `archive=0`이면 복원. 되돌릴 수 있는 조작이라 참조 유무를 보지 않는다.
 */
export async function setClassroomArchived(
  _prev: ClassroomActionState,
  formData: FormData,
): Promise<ClassroomActionState> {
  const g = await gate();
  if ("error" in g) return g;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "강의실 ID가 누락되었습니다" };
  const archive = String(formData.get("archive") ?? "1") === "1";

  const supabase = await createClient();
  const { data: room } = await supabase
    .from("classrooms")
    .select("name")
    .eq("id", id)
    .eq("tenant_id", g.user.tenantId)
    .maybeSingle();

  const { error } = await supabase
    .from("classrooms")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("tenant_id", g.user.tenantId);
  if (error) return { error: error.message };

  await logAction({
    action: archive ? "classroom_archive" : "classroom_restore",
    targetType: "classroom",
    targetLabel: (room?.name as string | undefined) ?? id,
  });
  refresh();
  return { ok: true };
}
