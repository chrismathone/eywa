"use server";
/**
 * 데스크 확인 기록(후속조치) 저장 — 0209a.
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
      // 0209a의 `nulls not distinct` 유니크와 짝 — 같은 칸에 두 번 저장하면 갱신된다
      // (데스크가 전화한 뒤 결과를 고쳐 적는 게 정상 흐름이라 갱신이 맞다).
      { onConflict: "tenant_id,student_id,session_date,slot_start" },
    )
    .select("id")
    .maybeSingle();

  if (error) return { error: error.message };
  revalidatePath("/attendance/live");
  return { ok: true, id: (data?.id as string) ?? "" };
}
