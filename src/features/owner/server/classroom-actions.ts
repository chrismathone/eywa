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
  // onDelete:set null — 참조하던 반/스케줄의 classroom_id가 자동으로 NULL(미지정)이 된다(FK 위반 없음).
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
