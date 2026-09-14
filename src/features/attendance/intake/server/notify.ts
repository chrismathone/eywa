import "server-only";
/**
 * 결석 접수 → **담당 강사 벨**(2026-08-19).
 *
 * 🔴 이 알림이 없으면 배선이 반쪽이다. 데스크가 미리 찍은 결석은 화면엔 그대로 뜨지만 담임에게
 *    **아무 신호도 가지 않아서**, 담임은 "왜 결석이지"에서 출발해 학부모에게 다시 묻거나 같은 칸을
 *    또 손댄다. 기존 두 경로는 이 자리를 못 메운다 —
 *      · `cross-notify`는 **미출결→출석** 전이만 다루고(결석은 대상 아님),
 *      · `absent-notify`는 수신자가 **데스크 optin 계정**이고 미래 날짜를 건너뛴다(`date > today` return).
 *    접수는 본질적으로 **미래**라, 미래를 건너뛰지 않는 전용 경로가 필요하다.
 *
 * 규약(CLAUDE.md '새 이벤트 알림 추가 시'):
 *  · dedup bucket = **그 접수 자체**(기간+칸 수) — 같은 통보를 두 번 저장해도 벨은 한 번.
 *  · `upsert(onConflict, ignoreDuplicates).select()`로 신규분만 발송.
 *  · 수신자 조회는 admin(RLS 우회)이라 **tenant 필터 필수**.
 *  · best-effort — 실패해도 출결 저장을 절대 막지 않는다(호출부가 after()로 부른다).
 * ⚠️ 인앱 벨만 보낸다. 휴대폰 웹 푸시 범위 확대는 원장 결정 사항이라 여기서 넓히지 않는다.
 * ⚠️ 링크는 **수신자마다 다르다** — 그 강사가 실제로 가르치는 반으로 보낸다([[#86]]: 본문이 여러 반인데
 *    링크가 하나면 그 링크는 누군가에겐 거짓말이고, 남의 반 id로 들어가면 조용히 목록으로 튕긴다).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUsers } from "@/features/notifications/server/notify";
import { reportError } from "@/lib/observability/report-error";
import { attHref } from "@/app/(shell)/attendance/_components/att-href";
import { buildIntakeAlert } from "../intake-alert";

export const INTAKE_EVENT_TYPE = "attendance_absence_intake";

export async function notifyTeachersOfIntake(input: {
  tenantId: string;
  actorId: string | null;
  actorName: string | null;
  studentId: string;
  studentName: string;
  /** 저장된 칸들 — 반 이름·날짜만 쓴다(교시는 벨에서 소음). */
  cells: readonly { classId: string; className: string; date: string }[];
  reason: string | null;
}): Promise<void> {
  try {
    if (input.cells.length === 0) return;
    const admin = createAdminClient();
    const classIds = [...new Set(input.cells.map((c) => c.classId))];
    const dates = [...new Set(input.cells.map((c) => c.date))].sort();

    // 받을 사람 먼저 — 없는데 dedup만 태우면 나중에 사람이 생겨도 그 건은 영영 안 온다(absent-notify와 같은 순서).
    const byTeacher = await loadTeacherClassMap(admin, input.tenantId, classIds, input.actorId);
    if (byTeacher.size === 0) return;

    // 이 접수 한 건 = 한 벨. 같은 학생·같은 기간·같은 칸 수를 다시 저장해도 벨은 다시 울리지 않는다.
    // ⚠️ 사유만 고쳐 다시 접수하면 벨이 안 간다(같은 bucket) — 알림 폭주보다 낫다고 보고 택한 쪽이다.
    const bucket = `intake|${dates[0]}~${dates[dates.length - 1]}|${input.cells.length}`;
    const { data: fresh, error: dedupError } = await admin
      .from("notification_events")
      .upsert(
        [
          {
            tenant_id: input.tenantId,
            event_type: INTAKE_EVENT_TYPE,
            subject_key: input.studentId,
            bucket,
            seeded: false,
          },
        ],
        { onConflict: "tenant_id,event_type,subject_key,bucket", ignoreDuplicates: true },
      )
      .select("subject_key");
    if (dedupError) throw dedupError;
    if (!fresh?.length) return;

    const month = dates[0]!.slice(0, 7);
    await notifyUsers(
      [...byTeacher.entries()].map(([recipientId, ownClassIds]) => {
        // 본문의 반 목록도 **그 강사 몫만** — 남의 반 이름을 벨에 실어 보낼 이유가 없다.
        const mine = input.cells.filter((c) => ownClassIds.has(c.classId));
        const cells = mine.length > 0 ? mine : input.cells;
        const { title, body } = buildIntakeAlert({
          studentName: input.studentName,
          dates: [...new Set(cells.map((c) => c.date))].sort(),
          classNames: cells.map((c) => c.className),
          reason: input.reason,
          byName: input.actorName,
        });
        return {
          tenantId: input.tenantId,
          recipientId,
          type: INTAKE_EVENT_TYPE,
          title,
          body,
          link: attHref({ classId: cells[0]?.classId ?? null, month, mode: "class" }),
          actorId: input.actorId,
        };
      }),
    );
  } catch (error) {
    reportError(error, { scope: "attendance.intake.notify", tenantId: input.tenantId });
  }
}

/**
 * 그 반들을 **가르치는 사람 → 그가 가르치는 반** 지도(담임 ∪ 교시 담당).
 *
 * ⚠️ 일부러 **합집합**이다(요일로 좁히지 않는다): 알림은 가시성 쪽 판정이라, 한 사람이라도 그 반을
 *    가르치면 알리는 게 맞다(teacher-axis의 `classTeacherIdsInRange`와 같은 결).
 * ⚠️ 출결 입력 요청·미출결→출석 교차 알림은 **반대로 좁혔다**(원장 결정 2026-09-14 — "그날 그 교시 담당 + 담임",
 *    `attendanceNoticeRecipients`). 그 둘은 "지금 이 교시를 찍어 달라"라 그 수업을 한 사람에게만 가야 하고,
 *    이 접수 벨은 미래·여러 날에 걸친 통보라 가시성 쪽이다 — 한쪽에 맞춰 다른 쪽을 바꾸지 말 것.
 * ⚠️ admin은 RLS를 우회하므로 **tenant 필터가 불변식**이다.
 */
async function loadTeacherClassMap(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  classIds: string[],
  actorId: string | null,
): Promise<Map<string, Set<string>>> {
  const [{ data: klasses }, { data: slots }] = await Promise.all([
    admin.from("classes").select("id, teacher_id").eq("tenant_id", tenantId).in("id", classIds),
    admin
      .from("class_schedules")
      .select("class_id, teacher_id")
      .eq("tenant_id", tenantId)
      .in("class_id", classIds)
      .not("teacher_id", "is", null),
  ]);
  const out = new Map<string, Set<string>>();
  const add = (teacherId: string | null, classId: string | null) => {
    if (!teacherId || !classId || teacherId === actorId) return;
    const set = out.get(teacherId) ?? new Set<string>();
    set.add(classId);
    out.set(teacherId, set);
  };
  for (const k of klasses ?? []) add(k.teacher_id as string | null, k.id as string);
  for (const s of slots ?? []) add(s.teacher_id as string | null, s.class_id as string);
  return out;
}
