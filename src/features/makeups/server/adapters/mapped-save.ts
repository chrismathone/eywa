import "server-only";
import { reservationSpanMinutes } from "@/features/attendance/makeup-reservation";
import { participationCommandPayload, mappedParticipationSend, participationStatusOf, planMappedAttendanceUnits } from "../../attendance-effect";
import { mappedSameDayDecision } from "../../participation";
import type { ProjectedReservation } from "./completion";
import { noteEffectGap, sendParticipation, type EffectGap, type ParticipationSend } from "./effects";

export type MappedSaveResult = { units: number | null | undefined; gap: EffectGap | null };

type SaveInput = {
  observeOnly: boolean;
  mode: "on" | "draining";
  pilotSubjects: readonly string[];
  subject: string | null;
  regularTeacherId: string | null;
  projected: ProjectedReservation;
  reservationId: string;
  studentId: string;
  classId: string;
  makeupDate: string;
  slotStart: string;
  slotEnd: string;
  cell: { id: string; status: string; slotStart: string | null; sessionUnits: number | null };
  unitsExplicit: boolean;
  created: boolean;
  makeupUnits: number | null;
  regularAttendee: boolean;
  classMinutes: number | null;
  patchUnits: (units: number | null) => Promise<boolean>;
};

function gap(input: SaveInput, kind: string, error: string): Promise<EffectGap> {
  return noteEffectGap({
    effectKey: input.projected.effectKey, kind, participantId: input.projected.participantId,
    reservationId: input.reservationId, error,
  });
}

/** 완료로 확인된 서버 상태에는 실패 기록을 덮지 않는다. 대기·실패는 호출부와 대기열에 남긴다. */
function participationFollowUp(input: SaveInput, sent: ParticipationSend): Promise<EffectGap | null> {
  if (sent.ok && sent.projectionState === "done" && sent.verificationOk) return Promise.resolve(null);
  if (!sent.ok) return gap(input, "participation_failed", sent.error);
  const failed = sent.projectionState === "failed";
  const fallback = failed ? "보강 반영을 확인하지 못했습니다" : "보강 반영이 끝나지 않았습니다";
  return gap(input, failed ? "participation_failed" : "participation_pending", sent.verificationCode ?? fallback);
}

/** 연결 예약의 시수·참여. 담당이 다르면 정규 시수를 쓰지 않는다. 정규일 출석은 참여로 보내지 않는다. */
export async function handleMappedFulfill(input: SaveInput): Promise<MappedSaveResult> {
  const plan = planMappedAttendanceUnits({
    unitsExplicit: input.unitsExplicit, created: input.created, storedUnits: input.cell.sessionUnits,
    makeupUnits: input.makeupUnits, dayWide: input.cell.slotStart == null,
    regularAttendee: input.regularAttendee, classMinutes: input.classMinutes,
  });
  const hold = input.subject ? mappedSameDayDecision({
    mode: input.mode, subjectKey: input.subject, pilotSubjects: input.pilotSubjects, nativeCount: 1,
    hasRegularSameAnchor: plan.regularDay, regularTeacherId: input.regularTeacherId,
    makeupTeacherId: input.projected.teacherId,
  }) : null;
  if (hold) return { units: undefined, gap: await gap(input, "teacher_hold", hold) };
  if (input.observeOnly) {
    return { units: undefined, gap: await gap(input, "observation", "출결은 그대로 두고 참여 반영을 대기열에 남겼습니다") };
  }
  let units: number | null | undefined = undefined;
  if (plan.writeUnits !== undefined) {
    const wrote = await input.patchUnits(plan.writeUnits);
    if (!wrote) return { units: undefined, gap: await gap(input, "units_write_failed", "보강 시수를 출결에 반영하지 못했습니다") };
    units = plan.writeUnits;
  }
  if (participationStatusOf(input.cell.status) === "partial") {
    return { units, gap: await gap(input, "units_review", "일부 참여는 실제 분량을 확인하기 전까지 참여로 보내지 않습니다") };
  }
  const decision = mappedParticipationSend({
    regularDay: plan.regularDay, mark: input.cell.status,
    slotMinutes: reservationSpanMinutes({ slotStart: input.slotStart, slotEnd: input.slotEnd }),
  });
  if (!decision.send) return { units, gap: null };
  if (!input.subject) return { units, gap: await gap(input, "participation_failed", "과목을 확인해 참여를 보내지 못했습니다") };
  const payload = participationCommandPayload({
    participantId: input.projected.participantId, studentId: input.studentId, subjectKey: input.subject,
    sessionDate: input.makeupDate, classId: input.classId, status: decision.status,
    attendanceRecordId: input.cell.id, effectKey: input.projected.effectKey, actualMinutes: decision.actualMinutes,
    manualUnits: plan.manual ? (input.cell.sessionUnits ?? 1) : null,
    expectedMakeupUnits: input.makeupUnits, expectedTotalUnits: plan.expectedUnits, reportId: input.projected.reportId,
  });
  const sent = await sendParticipation(input.projected.effectKey, payload);
  return { units, gap: await participationFollowUp(input, sent) };
}

/** 시수 상태가 사라진 연결 예약은 옛 되돌림을 하지 않고 노쇼 명령만 보낸다. */
export async function handleMappedAbsence(input: {
  observeOnly: boolean;
  projected: ProjectedReservation;
  reservationId: string;
  studentId: string;
  subject: string | null;
  classId: string;
  makeupDate: string;
  attendanceRecordId: string | null;
}): Promise<EffectGap | null> {
  if (input.observeOnly) {
    return noteEffectGap({
      effectKey: input.projected.effectKey, kind: "observation", participantId: input.projected.participantId,
      reservationId: input.reservationId, error: "출결은 그대로 두고 참여 반영을 대기열에 남겼습니다",
    });
  }
  const payload = participationCommandPayload({
    participantId: input.projected.participantId, studentId: input.studentId, subjectKey: input.subject ?? "",
    sessionDate: input.makeupDate, classId: input.classId, status: "no_show",
    attendanceRecordId: input.attendanceRecordId, effectKey: input.projected.effectKey, actualMinutes: 0,
    manualUnits: null, expectedMakeupUnits: null, expectedTotalUnits: null, reportId: null,
  });
  if (!input.subject) delete payload.subject_key;
  const sent = await sendParticipation(input.projected.effectKey, payload);
  if (sent.ok && sent.projectionState === "done" && sent.verificationOk) return null;
  if (!sent.ok) {
    return noteEffectGap({
      effectKey: input.projected.effectKey, kind: "participation_failed", participantId: input.projected.participantId,
      reservationId: input.reservationId, error: sent.error,
    });
  }
  const failed = sent.projectionState === "failed";
  return noteEffectGap({
    effectKey: input.projected.effectKey, kind: failed ? "participation_failed" : "participation_pending",
    participantId: input.projected.participantId, reservationId: input.reservationId,
    error: sent.verificationCode ?? (failed ? "보강 반영을 확인하지 못했습니다" : "보강 반영이 끝나지 않았습니다"),
  });
}
