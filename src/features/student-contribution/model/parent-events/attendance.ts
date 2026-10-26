import type { EventAttendance, EventMarker } from "./types";

export const EVENT_POLICY = "registration-unless-cancelled-direct-siblings-v2";
export const validEventDate = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day)
  && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
const compact = (v: string) => v.normalize("NFKC").trim().replace(/\s+/g, "").toLowerCase();
const cancelled = /^(?:true|1|☑|취소|신청취소|예약취소|참석취소)$/;
const attended = /^(?:true|1|☑|o|ㅇ|○|참석|실참석|참석완료)$/;
const absent = /^(?:false|0|x|불참|미참석|참석불가)$/;
const noCancellation = /^(?:false|0|취소없음|취소아님|미취소|취소안함)$/;
const registrationConfirmation = /^(?:참석확인(?:완료)?|참석화인|참석예정|완료|확인|확인완료|통화완료|통화함|전화완료|전화돌림|부재(?:중)?|미연결|전화기off|o|○)$/;
export const ambiguousAbsence = /취소|불참|미참석|참석불가|안오|못오|안옴|못옴|못가|어렵|다음에|다음번|불가|힘들|결석|노쇼/;

/** A call result is not attendance. Free-text cancellation mentions require review. */
export function decideEventAttendance(input: {
  eligibleList: boolean; eventDate: string; today: string; markers: readonly EventMarker[]; eventCancelled?: boolean;
}): EventAttendance {
  const result = (state: EventAttendance["state"], basis: EventAttendance["basis"], reasons: string[] = []): EventAttendance => ({ state, basis, reasons });
  if (!input.eligibleList) return result("excluded", "not_registration");
  if (!validEventDate(input.eventDate) || !validEventDate(input.today)) return result("review", "unconfirmed", ["event_date_invalid"]);
  if (input.eventCancelled) return result("cancelled", "cancellation");
  let hasCancellation = false, hasAttendance = false;
  const reasons = new Set<string>();
  for (const marker of input.markers) {
    if (marker.kind === "other_event_attendance") continue;
    const value = compact(marker.value);
    if (!value || value === "-") continue;
    if (marker.kind === "cancellation") {
      if (cancelled.test(value)) hasCancellation = true;
      else if (!noCancellation.test(value)) reasons.add("cancellation_ambiguous");
    } else if (marker.kind === "absence_checkbox") {
      if (!/^(?:false|0|☐)$/.test(value)) reasons.add("absence_meaning_unconfirmed");
    } else if (marker.kind === "attendance") {
      if (attended.test(value)) hasAttendance = true;
      else if (cancelled.test(value)) hasCancellation = true;
      else if (absent.test(value)) reasons.add("absence_meaning_unconfirmed");
      else if (registrationConfirmation.test(value)) continue;
      else reasons.add("attendance_marker_unknown");
    } else if (ambiguousAbsence.test(value) && !noCancellation.test(value)) {
      reasons.add("cancellation_context_unconfirmed");
    } else if (/^(?:x|×|✕|false|0|n|no|불)$/.test(value)) {
      reasons.add("absence_meaning_unconfirmed");
    } else if (marker.kind === "confirmation" && value.length <= 5 && !registrationConfirmation.test(value)) {
      reasons.add("confirmation_marker_unknown");
    }
  }
  if (hasAttendance && hasCancellation) reasons.add("attendance_cancellation_conflict");
  if (reasons.size) return result("review", "unconfirmed", [...reasons].sort());
  if (hasCancellation) return result("cancelled", "cancellation");
  if (input.eventDate > input.today) return result("scheduled", "future_event");
  return result("recognized", hasAttendance ? "explicit_attendance" : "registration_policy");
}
