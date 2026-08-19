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
import { kstMinutesOfDay, kstToday } from "@/lib/date-kst";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUsers } from "@/features/notifications/server/notify";
import { loadLiveSlots } from "./load";
import { loadDeskOptin } from "./cross-notify";
import { collectStudentNames, formatAttendanceNotifyNames } from "../notify-names";
import { hhmmToMin, slotPhase } from "../signals";
import { isSpecialSlotLabel } from "@/features/timetable/lib/teacher-label";

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
  /**
   * **결석 통보 접수 전용** — 미래 날짜를 허용한다(2026-08-19).
   *
   * 기본값(false)의 "미래엔 조치가 있을 수 없다"는 *우리가 먼저 알아채는* 흐름을 전제한 것이다.
   * 접수는 반대로 **학부모가 먼저 알려온** 흐름이라 미래가 본체다("내일 결석할게요"). 조치를 못 남기면
   * 그날 큐가 그 결석을 다시 '연락 대상'으로 올려 데스크가 같은 학부모에게 재확인 전화를 건다.
   * ⚠️ 권한·담당 반 게이트는 그대로다 — 여는 것은 **날짜 제한 하나뿐**이다.
   */
  allowFuture?: boolean;
}): Promise<FollowupResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출결 확인 권한이 없습니다" };

  const { studentId, classId, sessionDate } = input;
  if (!studentId || !classId) return { error: "필수 값이 누락되었습니다" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return { error: "잘못된 날짜입니다" };
  // 미래 날짜엔 조치가 있을 수 없다(아직 수업 전 — 실수로 만들면 큐가 영원히 그 행을 안고 간다).
  // 예외 = 결석 통보 접수(allowFuture): 학부모가 미리 알려온 건이라 "내일 결석"이 정상 입력이다.
  if (!input.allowFuture && sessionDate > kstToday()) return { error: "아직 지나지 않은 날짜입니다" };
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

/**
 * 역방향 — **강사가 데스크에 "미입력 학생 확인"을 요청**한다(원장 2026-08-18: *"선생님쪽에서 데스크에
 * 출결확인 요청 가능하도록 반대로 버튼 추가"*). `requestAttendanceInput`(데스크→강사)의 거울상.
 *
 * · 명단은 클라를 믿지 않고 **서버가 다시 계산**한다(`loadLiveSlots` — 강사 화면이 낡았으면 그 사이
 *   찍힌 학생은 빠지고, 전부 찍혔으면 요청 자체를 거절한다. 임의 studentId를 실어 보낼 길도 없다).
 * · 수신 = `users.desk_attendance_optin` 켠 계정(교차 알림과 같은 수신자 축 — cross-notify.ts).
 * · dedup bucket = (반, `날짜|저장축 교시`) — 큐의 모든 키는 저장축이다(수학 연강이 요청 3건이 되지 않게).
 * · 결석(absent)은 이 요청 대상이 아니다 — 강사가 결석을 찍는 순간 `attendance_absent_desk` 벨이 이미 간다.
 */
export async function requestDeskConfirm(input: {
  classId: string;
  sessionDate: string;
  /** 저장 축 교시(slot-axis saveSlot) — 수학은 null("그날 전체"). */
  slotStart?: string | null;
}): Promise<RequestResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const level = await accessLevelTenant(user.systemRole, "attendance");
  // 🔴 readonly(회계·뷰어)는 거절 — none만 거르면 그 사이 등급이 통과해 "강사가 요청했다"는 벨을
  //    강사 아닌 계정이 만들 수 있다(#77 — 스트립이 버튼을 안 보여주는 건 게이트가 아니다).
  if (level !== "full" && level !== "scoped") return { error: "출결 요청 권한이 없습니다" };
  const { classId, sessionDate } = input;
  if (!classId || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return { error: "필수 값이 누락되었습니다" };
  if (sessionDate > kstToday()) return { error: "아직 지나지 않은 날짜입니다" };
  const slot = input.slotStart?.trim() || null;
  if (slot && !/^\d{2}:\d{2}$/.test(slot)) return { error: "잘못된 교시입니다" };

  const supabase = await createClient();
  // 강사(scoped)는 자기 수업만 — 스코프는 보드와 같은 합집합(담임 ∪ 위임 ∪ 슬롯 담당). 담임 축만 보면
  // 부담임(교시 담당) 강사가 스트립에선 버튼을 보는데 서버가 거절하는 짝이 생긴다(#103 계열).
  if (level === "scoped") {
    const [teaching, slotRes] = await Promise.all([
      getTeachingClassIds(supabase, user.id, sessionDate),
      supabase
        .from("class_schedules")
        .select("class_id")
        .eq("class_id", classId)
        .eq("teacher_id", user.id)
        .lte("valid_from", sessionDate)
        .or(`valid_to.is.null,valid_to.gte.${sessionDate}`)
        .limit(1),
    ]);
    // ⚠️ 에러를 `?? []`로 삼키면 부담임(슬롯 담당)의 일시 장애가 "담당 반이 아닙니다"로 위장한다(B3 계열)
    //    — 권한 거절 문구를 받은 강사는 재시도 대신 포기한다.
    if (slotRes.error) return { error: "담당 확인에 실패했습니다 — 잠시 후 다시 시도해 주세요" };
    if (!teaching.all.includes(classId) && (slotRes.data ?? []).length === 0) {
      return { error: "담당 반이 아닙니다" };
    }
  }

  // 그 (반·저장축)의 미입력 학생을 서버가 직접 센다 — 0명이면 벨을 만들지 않는다(빈 요청 = 소음).
  // 자리 반(LAB·JJ)은 제외 — 스트립·큐 둘 다 거르는 슬롯이라 요청해도 큐에 안 뜬다(빈 요청과 같다).
  const matched = (await loadLiveSlots(sessionDate, [classId])).filter(
    (s) => (s.saveSlot ?? null) === slot && !isSpecialSlotLabel(s.slotTeacherLabel),
  );
  if (matched.length === 0) return { error: "요청할 교시를 찾지 못했습니다 — 화면을 새로고침해 주세요" };
  // 시작 전 교시는 거절 — 스트립은 안 보여주지만 서버 기준으론 올 수 있는 조합이다(#77). 시작 전에
  // bucket을 태우면 큐는 before로 비어 있고("요청했다는데 없다") 정작 수업 때 누르면 벨이 안 나간다.
  const nowMin = kstMinutesOfDay();
  const slots = matched.filter((s) => {
    if (sessionDate !== kstToday()) return true; // 지난 날짜는 전부 지난 교시다
    const startMin = hhmmToMin(s.slotStart);
    return startMin == null || slotPhase(nowMin, startMin, hhmmToMin(s.slotEnd)) !== "before";
  });
  if (slots.length === 0) return { error: "아직 시작하지 않은 교시입니다" };
  // 🔴 명단은 학생 **id**로 접는다 — 이름 Set으로 접으면 동명이인이 1명으로 붕는다(#89, 이 학원은
  //    동명이인 실재 — ClassNote 발송 게이트가 그래서 생겼다). 표시 이름 중복 제거는 collectStudentNames 몫.
  const pendingIds: string[] = [];
  const nameById = new Map<string, string>();
  for (const s of slots) {
    for (const st of s.students) {
      if (st.status != null || nameById.has(st.studentId)) continue;
      pendingIds.push(st.studentId);
      nameById.set(st.studentId, st.studentName);
    }
  }
  if (pendingIds.length === 0) return { error: "미입력 학생이 없습니다 — 이미 모두 입력됐어요" };
  const className = slots[0]!.className;
  const displayStart = slots.map((s) => s.slotStart).sort()[0]!;

  const admin = createAdminClient();
  // 수신자 확인이 dedup보다 먼저(기존 규약) — 받을 사람이 없는데 bucket만 태우면 "보냈다"가 거짓이 된다.
  const recipients = await loadDeskOptin(admin, user.tenantId, user.id);
  if (recipients.length === 0) {
    return { error: "출결 알림을 켠 데스크 직원이 없습니다 — 데스크에 직접 알려 주세요" };
  }

  const { data: fresh, error: dedupError } = await admin
    .from("notification_events")
    .upsert(
      [
        {
          tenant_id: user.tenantId,
          event_type: "attendance_desk_confirm_request",
          subject_key: classId,
          bucket: `${sessionDate}|${slot ?? ""}`,
          seeded: false,
        },
      ],
      { onConflict: "tenant_id,event_type,subject_key,bucket", ignoreDuplicates: true },
    )
    .select("bucket");
  if (dedupError) return { error: "요청을 기록하지 못했습니다" };
  // 이미 보낸 건이면 다시 보내지 않는다 — 화면엔 '요청함'으로 남는다(requestAttendanceInput과 같은 규약).
  if (!fresh?.length) return { ok: true, sent: false };

  // 이름은 4명까지 — 벨 본문이 명단 전문이 될 필요는 없다(건수는 이름이 아니라 **id 수**로 "외 N명").
  const { names } = collectStudentNames(pendingIds, nameById);
  const { listedLabel } = formatAttendanceNotifyNames(names.slice(0, 4), pendingIds.length);
  await notifyUsers(
    recipients.map((recipientId) => ({
      tenantId: user.tenantId,
      recipientId,
      type: "attendance_desk_confirm_request" as const,
      title: `데스크 확인 요청 — ${className} ${displayStart}`,
      body: `강사가 미입력 ${listedLabel} 학생의 등원 확인을 요청했습니다.`,
      link:
        sessionDate === kstToday()
          ? "/attendance/live?tab=desk"
          : `/attendance/live?tab=desk&date=${sessionDate}`,
      actorId: user.id,
    })),
  );
  revalidatePath("/attendance/live");
  return { ok: true, sent: true };
}
