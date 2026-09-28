import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { scheduleJandiForward } from "@/features/jandi/server/forward";
import type { NotificationType } from "../types";

/**
 * 알림 발송 저수준 진입점 — service_role로 다른 사용자에게 insert(RLS는 수신자 self-read라 우회 필수).
 * **best-effort**: 알림 insert 실패가 본 액션(배정 등)을 절대 막지 않는다(로깅만). 유발자==수신자는 스킵.
 */
export type NotifyInput = {
  tenantId: string;
  recipientId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  actorId?: string | null;
};

export async function notifyUsers(items: NotifyInput[]): Promise<void> {
  const rows = items
    .filter((i) => i.recipientId && i.recipientId !== i.actorId) // 내 행동을 나에게 알리지 않음
    .map((i) => ({
      tenant_id: i.tenantId,
      recipient_id: i.recipientId,
      type: i.type,
      title: i.title,
      body: i.body ?? null,
      link: i.link ?? null,
      actor_id: i.actorId ?? null,
    }));
  if (rows.length === 0) return;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("notifications").insert(rows);
    if (error) reportError(error, { scope: "notify.insert", count: rows.length });
    // 잔디 방 전달(0294a) — 응답 뒤에 돌고, 켠 지점·고른 종류만 나간다. aywa 알림이 들어간 것만 보낸다.
    else scheduleJandiForward(rows);
  } catch (e) {
    reportError(e, { scope: "notify.insert.throw" });
  }
}

/**
 * 수업 배정/전입 → 해당 반의 **담임(classes.teacher_id)** 에게 알림. 여러 학생이 같은 반이면
 * 담임당 1건으로 집계("김철수 외 2명 …")해 배치 이동 시 알림 폭주를 막는다.
 * 유발자(actor)가 담임 본인이면 스킵. 담임 미지정(teacher_id null) 반은 발송 없음.
 * ⚠️ best-effort — 조회/발송 실패가 배정 액션을 막지 않는다.
 */
export async function notifyClassAssignment(args: {
  tenantId: string;
  actorId: string;
  assignments: { classId: string; studentId: string }[];
  type: "enrollment_assigned" | "enrollment_transferred_in";
}): Promise<void> {
  const { tenantId, actorId, assignments, type } = args;
  if (assignments.length === 0) return;
  try {
    const admin = createAdminClient();
    const classIds = [...new Set(assignments.map((a) => a.classId))];
    const studentIds = [...new Set(assignments.map((a) => a.studentId))];

    const [{ data: classes }, { data: students }] = await Promise.all([
      admin.from("classes").select("id, class_name, teacher_id, tenant_id").in("id", classIds),
      admin.from("students").select("id, name, tenant_id").in("id", studentIds),
    ]);
    // ⚠️ admin client는 RLS 우회 — 반드시 본 테넌트 반/학생만 남긴다. enrollments RLS가 class_id의
    // 테넌트를 검증하지 않아, 조작된 타 테넌트 classId가 배정되면 외부 강사에게 알림이 새는 것 차단
    // (적대리뷰 HIGH). 테넌트 불일치 반은 classById에서 빠져 아래 teacherId 조회가 undefined→continue.
    const classById = new Map(
      (classes ?? []).filter((c) => c.tenant_id === tenantId).map((c) => [c.id, c]),
    );
    const nameById = new Map(
      (students ?? []).filter((s) => s.tenant_id === tenantId).map((s) => [s.id, s.name as string]),
    );

    // 담임별·반별로 학생명을 모은다(중복 학생 제거).
    const byRecipientClass = new Map<
      string,
      { recipientId: string; classId: string; className: string; studentNames: string[] }
    >();
    for (const a of assignments) {
      const c = classById.get(a.classId);
      const teacherId = c?.teacher_id as string | null | undefined;
      if (!teacherId) continue;
      const key = `${teacherId}::${a.classId}`;
      const entry =
        byRecipientClass.get(key) ??
        {
          recipientId: teacherId,
          classId: a.classId,
          className: (c?.class_name as string) ?? "반",
          studentNames: [],
        };
      const nm = nameById.get(a.studentId);
      if (nm && !entry.studentNames.includes(nm)) entry.studentNames.push(nm);
      byRecipientClass.set(key, entry);
    }

    const verb = type === "enrollment_transferred_in" ? "전입" : "배정";
    const title = type === "enrollment_transferred_in" ? "반 이동 전입" : "새 학생 배정";
    const items: NotifyInput[] = [...byRecipientClass.values()]
      .filter((e) => e.studentNames.length > 0)
      .map((e) => {
        const [first, ...rest] = e.studentNames;
        const who = rest.length > 0 ? `${first} 외 ${rest.length}명` : first;
        return {
          tenantId,
          recipientId: e.recipientId,
          type,
          title,
          body: `${who} 학생이 ${e.className} 반에 ${verb}되었습니다.`,
          link: `/classes/${e.classId}`,
          actorId,
        };
      });
    await notifyUsers(items);
  } catch (e) {
    reportError(e, { scope: "notify.classAssignment" });
  }
}
