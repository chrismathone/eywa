import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { mappedSameDayDecision } from "../../participation";
import { decideReportUpsert } from "../../report-decision";
import { featureLive } from "../../types";
import { loadNativeParticipants } from "./participants";
import { loadRegularAttendanceTeacher } from "./regular-attendance";

const DELETE_BLOCK = "연결된 보강은 여기서 지울 수 없습니다. 보강 일정에서 취소해 주세요.";
const CANCEL_GUIDE = "연결된 보강은 보강 일정에서 취소해 주세요.";
const RESCHEDULE_GUIDE = "연결된 보강은 보강 일정에서 날짜를 바꿔 주세요.";
const UNCONFIRMED = "보강 연결을 확인하지 못해 예약을 바꾸지 않았습니다";
const LOOKUP_BLOCK = "정규 출결을 확인하지 못해 보강 보고서를 저장하지 않았습니다";
const SLOT_CONFLICT = "같은 날 정규 수업의 담당이 서로 달라 보강 보고서를 저장하지 않았습니다";

/**
 * 여러 칸(학생·반·날짜)의 native 쓰기 근거를 **한 번에** — 칸마다 `nativeWriteAllowance`를 부르면 큰 범위 저장에서 수백 번
 * 왕복한다(수정 계획 P1-A 4-2 리뷰). 기간(첫~끝 날짜)으로 한 번 읽어 메모리에서 대조한다. 키 = `학생::반::날짜`.
 * 꺼짐·표 없음 = 근거 없음(문을 넓히지 않는다) · 실패·잘림 = error(빈 목록으로 숨기지 않는다).
 */
export async function nativeWriteKeys(
  cells: readonly { studentId: string; classId: string; sessionDate: string }[],
): Promise<{ keys: Set<string>; error: string | null }> {
  if (cells.length === 0) return { keys: new Set(), error: null };
  const dates = cells.map((c) => c.sessionDate).sort();
  const classIds = [...new Set(cells.map((c) => c.classId))];
  // sharedRead — 보강관리 권한이 없는 강사는 RPC가 늘 권한 거절이다. 이 판정은 쓰기를 **여는** 근거를 찾는 것이라 거절 = 근거 없음으로
  // 읽는다(문이 좁아지는 쪽 · 4-2 재리뷰: 실패로 읽으면 그 강사의 일괄·범위 저장이 통째로 막혔다).
  const found = await loadNativeParticipants({
    date_from: dates[0], date_to: dates[dates.length - 1], ...(classIds.length === 1 ? { class_id: classIds[0] } : {}), limit: 500,
  }, { sharedRead: true });
  if (found.status === "off" || found.status === "schema_missing") return { keys: new Set(), error: null };
  if (found.status === "failed") return { keys: new Set(), error: found.error };
  if (found.value.truncated) return { keys: new Set(), error: "보강 참여 목록이 잘렸습니다" };
  const wanted = new Set(cells.map((c) => `${c.studentId}::${c.classId}::${c.sessionDate}`));
  const keys = new Set<string>();
  for (const row of found.value.participants) {
    const k = `${row.studentId}::${row.classId}::${row.sessionDate}`;
    if (row.status !== "cancelled" && wanted.has(k)) keys.add(k);
  }
  return { keys, error: null };
}

/** 조회 실패는 수강 거절 문구로 바꾸지 않는다. 표가 없으면 문을 넓히지 않는다. */
export async function nativeWriteAllowance(key: {
  studentId: string;
  classId: string;
  sessionDate: string;
}): Promise<{ allow: boolean; error: string | null }> {
  // sharedRead — 권한 거절 = 근거 없음(쓰기를 여는 근거라 좁아지는 쪽 · nativeWriteKeys와 같은 판정).
  const found = await loadNativeParticipants({
    student_id: key.studentId, class_id: key.classId, session_date: key.sessionDate, limit: 20,
  }, { sharedRead: true });
  if (found.status === "off" || found.status === "schema_missing") return { allow: false, error: null };
  if (found.status === "failed") return { allow: false, error: found.error };
  const allow = found.value.participants.some((row) => (
    row.studentId === key.studentId && row.classId === key.classId
    && row.sessionDate === key.sessionDate && row.status !== "cancelled"
  ));
  return { allow, error: null };
}

async function sameDayRegular(studentId: string, classId: string, date: string): Promise<
  { hasRegular: boolean; teacherId: string | null } | "unknown" | "conflict"
> {
  try {
    const user = await getCurrentUser({ teacherView: true });
    const tenantId = user?.tenantId?.trim() ?? "";
    if (!tenantId) return "unknown";
    const found = await loadRegularAttendanceTeacher(await createClient(), tenantId, studentId, classId, date);
    if (found.status === "unknown") return "unknown";
    if (found.status === "conflict") return "conflict";
    if (found.status === "none") return { hasRegular: false, teacherId: null };
    return { hasRegular: true, teacherId: found.teacherId };
  } catch {
    return "unknown";
  }
}

export async function makeupReportUpsertBlock(input: {
  makeup: boolean;
  classId: string | null;
  subject: string;
  studentId: string;
  date: string;
  creating: boolean;
  existingReportId: string | null;
}): Promise<string | null> {
  if (!input.makeup || input.classId) return null;
  const settings = await getTenantSettings();
  if (!featureLive(settings.makeups.mode)) return null;
  if (!settings.makeups.pilotSubjects.some((key) => key === input.subject)) return null;
  const found = await loadNativeParticipants({
    student_id: input.studentId, subject_key: input.subject, session_date: input.date, limit: 20,
  });
  if (found.status === "off" || found.status === "schema_missing") return null;
  if (found.status !== "ok" || found.value.truncated) return "보강 참여를 확인하지 못해 저장하지 않았습니다";
  const natives = found.value.participants.filter((row) => row.status !== "cancelled");
  if (natives.length > 0 && featureLive(settings.makeups.mode)) {
    const anchor = natives[0]?.anchorClassId ?? natives[0]?.classId ?? null;
    const pilot = settings.makeups.pilotSubjects.some((key) => key === input.subject);
    let hasRegular = false;
    let teacherId: string | null = null;
    if (natives.length === 1 && pilot && anchor) {
      const regular = await sameDayRegular(input.studentId, anchor, input.date);
      if (regular === "unknown") return LOOKUP_BLOCK;
      if (regular === "conflict") return SLOT_CONFLICT;
      hasRegular = regular.hasRegular;
      teacherId = regular.teacherId;
    }
    const hold = mappedSameDayDecision({
      mode: settings.makeups.mode, subjectKey: input.subject, pilotSubjects: settings.makeups.pilotSubjects,
      nativeCount: natives.length, hasRegularSameAnchor: hasRegular,
      regularTeacherId: teacherId, makeupTeacherId: natives[0]?.teacherId ?? null,
    });
    if (hold) return hold;
  }
  return decideReportUpsert({
    makeup: true, classId: null, subjectKey: input.subject, mode: settings.makeups.mode, lookup: "ok",
    pilotSubjects: settings.makeups.pilotSubjects, creating: input.creating, existingReportId: input.existingReportId,
    participants: natives,
  });
}

/** 이미 아는 연결 id 는 운영이 꺼져 있어도 조회 없이 막는다. 표가 없으면 연결 없는 삭제만 통과한다. */
export async function mappedMakeupDeleteBlock(input: {
  knownMapId?: string | null;
  studentId: string;
  classId?: string | null;
  date: string;
}): Promise<string | null> {
  if (input.knownMapId) return DELETE_BLOCK;
  const settings = await getTenantSettings();
  if (!featureLive(settings.makeups.mode)) return null;
  const found = await loadNativeParticipants({
    student_id: input.studentId, session_date: input.date, ...(input.classId ? { class_id: input.classId } : {}), limit: 50,
  });
  if (found.status === "off" || found.status === "schema_missing") return null;
  if (found.status !== "ok" || found.value.truncated) return DELETE_BLOCK;
  const live = found.value.participants.some((row) => row.status !== "cancelled" && row.sessionDate === input.date);
  const mapped = found.value.legacyMaps.some((row) => row.state === "active");
  return live || mapped ? DELETE_BLOCK : null;
}

/** 예약 취소 명령 본문. 감사 로그를 직접 쓰는 파일 밖에 둔다. */
export function mappedCancelCommand(reservationId: string): { reservationId: string; action: "cancel" } {
  return { reservationId, action: "cancel" };
}

/** 예약 일정 변경 명령 본문(반 옮기기 · 보강 확인). 감사 로그를 직접 쓰는 파일 밖에 둔다(그 파일의 `action:` 리터럴은 감사 액션으로 읽힌다). */
export function mappedRescheduleCommand(reservationId: string): { reservationId: string; action: "reschedule" } {
  return { reservationId, action: "reschedule" };
}

/** 연결된 예약의 취소·일정 변경은 옛 삭제로 하지 않는다. 연결이 없으면 옛 경로 그대로. */
export async function mappedReservationMutationBlock(input: {
  reservationId: string;
  action: "cancel" | "reschedule";
}): Promise<string | null> {
  const settings = await getTenantSettings();
  if (!featureLive(settings.makeups.mode)) return null;
  const found = await loadNativeParticipants({ legacy_reservation_ids: [input.reservationId], limit: 20 });
  if (found.status === "off" || found.status === "schema_missing") return null;
  if (found.status !== "ok" || found.value.truncated) return UNCONFIRMED;
  const active = found.value.legacyMaps.some((row) => row.legacyReservationId === input.reservationId && row.state === "active");
  if (!active) return null;
  return input.action === "reschedule" ? RESCHEDULE_GUIDE : CANCEL_GUIDE;
}
