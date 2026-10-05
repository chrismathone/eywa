"use client";

import { EmbedLink as Link } from "@/components/embed-link";
import type { PeriodsConfig } from "@/features/timetable/lib/periods";
import type { MakeupCaseDetail } from "../server/read-types";
import { MAKEUP_STATE, makeupText } from "../status";
import { CommandForm } from "./command-form";
import { SessionFields } from "./session-fields";
import { ReasonField, formText } from "./form-fields";
import { ParticipationForm, SubmissionForm } from "./participation-form";
import { FulfillmentReview } from "./fulfillment-review";

export function SessionOperations({ detail, periods, actorId }: { detail: MakeupCaseDetail; periods: PeriodsConfig; actorId: string }) {
  return <section className="space-y-3"><h2 className="font-bold">예정 회차·실제 실시</h2>
    {!detail.sessions.length ? <p>연결된 회차가 없습니다.</p> : null}
    {detail.sessions.map(session => <div key={session.id} className="border-line space-y-3 rounded-lg border p-4">
      <h3 className="font-bold">{session.session_date} · {session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)} · {makeupText(MAKEUP_STATE, session.state)}</h3>
      <p>실시 강사 {session.teacher_name ?? "확인 필요"} · 강의실 {session.classroom_name ?? "확인 필요"} · {session.taken}/{session.capacity ?? "미설정"}명</p>
      {detail.participants.filter(participant => participant.session_id === session.id).map(participant => <div key={participant.id} className="space-y-3">
        <p>{makeupText(MAKEUP_STATE, participant.status)} · 예정 {participant.planned_minutes}분 · 실제 {participant.actual_minutes ?? "미입력"}분</p>
        {session.state === "confirmed" && detail.permissions.cancel && participant.status === "unknown" ? <details><summary className="min-h-6 cursor-pointer">이 학생의 예약 취소</summary>
          <CommandForm action="cancel" revision={participant.revision} label="이 학생 예약 취소" payload={data => ({ participant_id: participant.id, reason: formText(data, "reason"), cause: "student" })}>
            <ReasonField /><p className="text-sm">원결석과 보강 건은 남기고 예약 점유만 해제합니다.</p>
          </CommandForm>
        </details> : null}
        {session.state === "confirmed" && detail.permissions.reschedule && participant.status === "unknown" ? <details><summary className="min-h-6 cursor-pointer">이 학생의 일정 변경</summary>
          <CommandForm action="reschedule" revision={session.revision} label="일정 변경" payload={data => ({ session_id: session.id, participant_id: participant.id,
            session_date: formText(data, "session_date"), teacher_id: formText(data, "teacher_id"), classroom_id: formText(data, "classroom_id"),
            class_id: formText(data, "class_id") || null, period_ids: data.getAll("period_ids").map(String), reason: formText(data, "reason"),
          })}>
            <SessionFields subject={session.subject_key} periods={periods} initialDate={session.session_date} allowJoin={false} /><ReasonField />
          </CommandForm>
        </details> : null}
        {detail.permissions.participation && (session.teacher_id === actorId || detail.permissions.assign) && participant.status !== "cancelled" ? <>
          <Link href={`/onescreen?date=${session.session_date}`} className="text-primary inline-block min-h-6 underline">수업 기록에서 출결·보고서 작성</Link>
          <ParticipationForm participant={participant} session={session} />
        </> : null}
        {detail.permissions.submit && (session.teacher_id === actorId || detail.permissions.assign) && ["present", "partial"].includes(participant.status) ?
          detail.fulfillments.filter(fulfillment => fulfillment.participant_id === participant.id && ["draft", "returned"].includes(fulfillment.state))
            .map(fulfillment => <SubmissionForm key={fulfillment.id} participant={participant} session={session} revision={fulfillment.revision} />) : null}
        {detail.fulfillments.filter(fulfillment => fulfillment.participant_id === participant.id).map(fulfillment => <FulfillmentReview key={fulfillment.id} fulfillment={fulfillment} detail={detail} actorId={actorId} />)}
      </div>)}
    </div>)}
  </section>;
}
