"use server";
/**
 * 데스크 확인 기록(후속조치) 저장 — 0210a.
 *
 * 🔴 **여기서 출결(attendance_records)을 바꾸지 않는다.** 그 표는 시수·단가를 통해 급여·청구로
 *    흘러간다(골든마스터 대상) — 데스크의 전화 한 통이 강사 급여를 조용히 바꾸면 안 된다.
 *    출결 반영이 필요하면 화면이 "출석으로 정정" 버튼을 따로 보이고, 그 버튼은 기존 게이트
 *    (`setAttendanceCell` — 담당 반·수강생·7일 편집창 검증 전부 포함)를 그대로 통과한다(#77).
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { getTeachingClassIds } from "@/features/classes/server/delegation";
import { kstToday } from "@/lib/date-kst";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUsers } from "@/features/notifications/server/notify";

const STATES = ["open", "resolved", "dismissed"] as const;
const OUTCOMES = ["coming", "absent_today", "sick", "already_here", "no_answer", "other"] as const;
const VIAS = ["phone", "kakao", "in_person", "other"] as const;
const SIGNALS = ["absent", "unmarked"] as const;

export type FollowupResult = { ok: true; id: string } | { error: string };

export async function recordFollowup(input: {
  studentId: string;
  classId: string;
  sessionDate: string;
  /** 교시("HH:MM"). 없으면 그날 전체. */
  slotStart?: string | null;
  signal: (typeof SIGNALS)[number];
  state: (typeof STATES)[number];
  outcome?: string | null;
  note?: string | null;
  contactedVia?: string | null;
}): Promise<FollowupResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출결 확인 권한이 없습니다" };

  const { studentId, classId, sessionDate } = input;
  if (!studentId || !classId) return { error: "필수 값이 누락되었습니다" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return { error: "잘못된 날짜입니다" };
  // 미래 날짜엔 조치가 있을 수 없다(아직 수업 전 — 실수로 만들면 큐가 영원히 그 행을 안고 간다).
  if (sessionDate > kstToday()) return { error: "아직 지나지 않은 날짜입니다" };
  if (!SIGNALS.includes(input.signal)) return { error: "잘못된 신호입니다" };
  if (!STATES.includes(input.state)) return { error: "잘못된 상태입니다" };

  const outcome = input.outcome?.trim() || null;
  if (outcome && !(OUTCOMES as readonly string[]).includes(outcome)) return { error: "잘못된 결과입니다" };
  const via = input.contactedVia?.trim() || null;
  if (via && !(VIAS as readonly string[]).includes(via)) return { error: "잘못된 연락 방법입니다" };
  const note = input.note?.trim() || null;
  const slot = input.slotStart?.trim() || null;
  if (slot && !/^\d{2}:\d{2}$/.test(slot)) return { error: "잘못된 교시입니다" };

  // 매듭지은 건만 처리자·시각을 남긴다 — 'open'(연락 중)에 처리자를 찍으면 "누가 끝냈다"가 거짓이 된다.
  const settled = input.state === "resolved" || input.state === "dismissed";

  const supabase = await createClient();

  // 🔴 강사(scoped)는 **담당 반 학생만** — 화면이 데스크 면을 안 보여준다는 것은 게이트가 아니다(#77).
  //    이 액션은 "use server"라 클라에서 임의 studentId/classId로 직접 호출할 수 있고, 그대로 두면
  //    강사가 남의 반 학생 결석 사유("아파서")를 적어 넣을 수 있다. 판정은 출결 쓰기와 **같은 소스**
  //    (담당 반 ∪ 그날 위임받은 반)로 — 두 게이트가 갈리면 "찍을 수는 있는데 기록은 못 남기는" 짝이 생긴다.
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    const teaching = await getTeachingClassIds(supabase, user.id, sessionDate);
    if (!teaching.all.includes(classId)) return { error: "담당 반이 아닙니다" };
  }
  const { data, error } = await supabase
    .from("attendance_followups")
    .upsert(
      {
        tenant_id: user.tenantId,
        student_id: studentId,
        class_id: classId,
        session_date: sessionDate,
        slot_start: slot,
        signal: input.signal,
        state: input.state,
        outcome,
        note,
        contacted_via: via,
        handled_by: settled ? user.id : null,
        handled_at: settled ? new Date().toISOString() : null,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      },
      // 0210a의 `nulls not distinct` 유니크와 짝 — 같은 칸에 두 번 저장하면 갱신된다
      // (데스크가 전화한 뒤 결과를 고쳐 적는 게 정상 흐름이라 갱신이 맞다).
      { onConflict: "tenant_id,student_id,session_date,slot_start" },
    )
    .select("id")
    .maybeSingle();

  if (error) {
    // ⚠️ raw 원문을 화면에 그대로 내보내지 않는다(전역 규칙). 표가 아직 없을 때(마이그레이션 미적용)가
    //    가장 흔한 실패라 그 경우를 먼저 알아보게 한다 — #95 대비.
    const missingTable = /relation .* does not exist|schema cache/i.test(error.message);
    return {
      error: missingTable
        ? "확인 기록 저장소가 아직 준비되지 않았습니다 — 관리자에게 문의해 주세요(0210a 미적용)"
        : "확인 기록을 저장하지 못했습니다 — 잠시 후 다시 시도해 주세요",
    };
  }
  revalidatePath("/attendance/live");
  return { ok: true, id: (data?.id as string) ?? "" };
}

/**
 * 레인 A — **강사에게 "출결 입력" 요청**을 보낸다(2026-08-14 적대 리뷰 S4).
 *
 * 🔴 왜 필요한가: 레인 A 카드는 하루 60~70장인데 상태가 없었다. 데스크가 전화해도 카드는 강사가 실제로
 *    찍기 전까지 그대로라, 3명이 같은 강사에게 두세 번 걸고 "이미 했다"를 공유할 자리가 없었다.
 *    그리고 화면은 "강사 확인이 먼저"라고 적어 두고 **정작 요청할 버튼이 없었다** — 선택지가 헛전화 아니면
 *    방치뿐이었다.
 *
 * 규약은 기존 이벤트 알림과 같다: dedup bucket = 상태 전이 표현(`날짜|교시`), 신규분만 발송,
 * 수신자 확인이 dedup보다 먼저, admin 조회엔 tenant 필터. best-effort가 아니라 **결과를 돌려준다**
 * (데스크가 "보냈는지"를 알아야 카드에 표시된다).
 */
export type RequestResult = { ok: true; sent: boolean } | { error: string };

export async function requestAttendanceInput(input: {
  classId: string;
  sessionDate: string;
  slotStart?: string | null;
}): Promise<RequestResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 전 학원 강사에게 보내는 요청이라 담당(scoped)이 아니라 **관리 권한**(full)만 통과시킨다.
  if ((await accessLevelTenant(user.systemRole, "attendance")) !== "full") {
    return { error: "출결 요청 권한이 없습니다" };
  }
  const { classId, sessionDate } = input;
  if (!classId || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return { error: "필수 값이 누락되었습니다" };
  if (sessionDate > kstToday()) return { error: "아직 지나지 않은 날짜입니다" };
  const slot = input.slotStart?.trim() || null;

  const admin = createAdminClient();
  // 받을 사람 = 그 슬롯 담당(부담임 포함) ∪ 반 담임. admin 경로라 tenant 필터 필수.
  const [{ data: klass }, { data: slotRows }] = await Promise.all([
    admin
      .from("classes")
      .select("id, class_name, teacher_id")
      .eq("tenant_id", user.tenantId)
      .eq("id", classId)
      .maybeSingle(),
    admin
      .from("class_schedules")
      .select("teacher_id")
      .eq("tenant_id", user.tenantId)
      .eq("class_id", classId)
      .not("teacher_id", "is", null),
  ]);
  const recipients = [
    ...new Set(
      [klass?.teacher_id as string | null, ...(slotRows ?? []).map((r) => r.teacher_id as string)].filter(
        (id): id is string => !!id && id !== user.id,
      ),
    ),
  ];
  if (recipients.length === 0) return { error: "이 반에 연결된 강사가 없습니다 — 직접 확인해 주세요" };

  const { data: fresh, error: dedupError } = await admin
    .from("notification_events")
    .upsert(
      [
        {
          tenant_id: user.tenantId,
          event_type: "attendance_input_request",
          subject_key: classId,
          bucket: `${sessionDate}|${slot ?? ""}`,
          seeded: false,
        },
      ],
      { onConflict: "tenant_id,event_type,subject_key,bucket", ignoreDuplicates: true },
    )
    .select("bucket");
  if (dedupError) return { error: "요청을 기록하지 못했습니다" };
  // 이미 보낸 건이면 다시 보내지 않는다(강사에게 같은 알림이 쌓이지 않게) — 화면엔 '요청함'으로 남는다.
  if (!fresh?.length) return { ok: true, sent: false };

  await notifyUsers(
    recipients.map((recipientId) => ({
      tenantId: user.tenantId,
      recipientId,
      type: "attendance_input_request",
      title: `출결 입력 요청 — ${klass?.class_name ?? "수업"}${slot ? ` ${slot}` : ""}`,
      body: "데스크에서 오늘 출결 입력을 요청했습니다. 화면 위 '오늘 출석 미입력'에서 바로 찍을 수 있습니다.",
      link: sessionDate === kstToday() ? "/attendance/live" : `/attendance/live?date=${sessionDate}`,
      actorId: user.id,
    })),
  );
  revalidatePath("/attendance/live");
  return { ok: true, sent: true };
}
