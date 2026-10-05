"use client";

import { EmbedLink as Link } from "@/components/embed-link";
import type { PeriodsConfig } from "@/features/timetable/lib/periods";
import type { MakeupCaseDetail } from "../server/read-types";
import { MAKEUP_ACTION, MAKEUP_BLOCK, MAKEUP_STATE, makeupText } from "../status";
import { CommandForm } from "./command-form";
import { SessionFields } from "./session-fields";
import { ReasonField, formText } from "./form-fields";
import { ParticipationForm, SubmissionForm } from "./participation-form";
import { FulfillmentReview } from "./fulfillment-review";
import { participantAttendanceLink, participantAvailability, participantEvidence, participantRecordHref } from "./session-ui";

const ATTENDANCE_LINK: Record<string, string> = { linked: "연결됨", pending: "연결 확인 대기", failed: "연결 확인 실패", none: "연결된 출결 없음" };
export function SessionOperations({ detail, periods, actorId, recordView = "attendance" }: {
  detail: MakeupCaseDetail; periods: PeriodsConfig; actorId: string; recordView?: "teacher" | "attendance";
}) {
  return <section className="space-y-3"><h2 className="font-bold">예정 회차·실제 실시</h2>
    {!detail.sessions.length ? <p>연결된 회차가 없습니다.</p> : null}
    {detail.sessions.map(session => <div key={session.id} className="border-line space-y-3 rounded-lg border p-4">
      <h3 className="font-bold">{session.session_date} · {session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)} · {makeupText(MAKEUP_STATE, session.state)}</h3>
      <p>실시 강사 {session.teacher_name ?? "확인 필요"} · 강의실 {session.classroom_name ?? "확인 필요"} · {session.taken}/{session.capacity ?? "미설정"}명</p>
      {detail.participants.filter(participant => participant.session_id === session.id).map(participant => {
        const actions = participantAvailability(detail, participant, session, actorId);
        const { active, previous } = participantEvidence(detail.fulfillments, participant.id);
        const recordHref = participantRecordHref(recordView, detail.case.id, participant, session);
        return <div key={participant.id} className="space-y-3">
        <p>{makeupText(MAKEUP_STATE, participant.status)} · 예정 {participant.planned_minutes}분 · 실제 {participant.actual_minutes ?? "미입력"}분</p>
        <p className="text-sm">실시 인정 · {active?.state === "verified" ? "인정 완료" : active ? makeupText(MAKEUP_STATE, active.state) : previous ? "인정 정정 후 재확인 필요" : "미인정"}</p>
        <p className="text-sm">출결 연결 · {makeupText(ATTENDANCE_LINK, participantAttendanceLink(detail, participant))}</p>
        {typeof participant.anchor_class_name === "string" ? <p className="text-sm">출결·보고서 반 · {participant.anchor_class_name}</p> : null}
        <ul className="space-y-1 text-sm">{(Object.keys(actions) as Array<keyof typeof actions>).filter(key => !actions[key].allowed).map(key =>
          <li key={key}>{makeupText(MAKEUP_ACTION, key)} · {makeupText(MAKEUP_BLOCK, actions[key].reason ?? "")}</li>)}</ul>
        {actions.cancel.allowed ? <details><summary className="min-h-6 cursor-pointer">이 학생의 예약 취소</summary>
          <CommandForm action="cancel" revision={participant.revision} label="이 학생 예약 취소" payload={data => ({ participant_id: participant.id, reason: formText(data, "reason"), cause: "student" })}>
            <ReasonField /><p className="text-sm">원결석과 보강 건은 남기고 예약 점유만 해제합니다.</p>
          </CommandForm>
        </details> : null}
        {actions.reschedule.allowed ? <details><summary className="min-h-6 cursor-pointer">이 학생의 일정 변경</summary>
          <CommandForm action="reschedule" revision={session.revision} label="일정 변경" payload={data => ({ session_id: session.id, participant_id: participant.id,
            session_date: formText(data, "session_date"), teacher_id: formText(data, "teacher_id"), classroom_id: formText(data, "classroom_id"),
            class_id: formText(data, "class_id") || null, period_ids: data.getAll("period_ids").map(String), reason: formText(data, "reason"),
          })}>
            <SessionFields subject={session.subject_key} periods={periods} initialDate={session.session_date} allowJoin={false} /><ReasonField />
          </CommandForm>
        </details> : null}
        {actions.record.allowed ? <>
          {recordView === "attendance" ? <p className="text-sm">보고서는 실시 강사의 수업 기록에서 작성합니다. 출결 연결은 출석부에서 확인해 주세요.</p> : null}
          {recordHref ? <Link href={recordHref} className="text-primary inline-block min-h-6 underline">
            {recordView === "teacher" ? "수업 기록에서 출결·보고서 작성" : "실시 반의 월별 출석부 확인"}
          </Link> : <p className="text-sm">출결·보고서 반을 지정한 뒤 출석부에서 확인해 주세요.</p>}
          <ParticipationForm participant={participant} session={session} fulfillments={detail.fulfillments} />
        </> : null}
        {actions.submit.allowed && active && ["draft", "returned"].includes(active.state) ?
          <SubmissionForm key={active.id} participant={participant} session={session} revision={active.revision} fulfillments={detail.fulfillments} /> : null}
        {detail.fulfillments.filter(fulfillment => fulfillment.participant_id === participant.id).map(fulfillment => <FulfillmentReview key={fulfillment.id} fulfillment={fulfillment} detail={detail} actorId={actorId} />)}
      </div>; })}
    </div>)}
  </section>;
}
