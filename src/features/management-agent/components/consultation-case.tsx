import { consultationCase } from "../server/queries";
import { CASE_LABEL, EVENT_LABEL, RESULT_LABEL } from "../model";
import { CaseControls } from "./case-controls";
import { RefreshCasesButton } from "./refresh-button";
import { adviceSchema } from "../advice";
import { WindowLink } from "@/components/workspace/window-link";

export async function ConsultationCase({ consultationId, byCaseId = false }: { consultationId: string; byCaseId?: boolean }) {
  const data = await consultationCase(consultationId, byCaseId);
  if (!data) return null;
  const advice = "row" in data && data.row ? adviceSchema.safeParse(data.row.ai_advice) : null;
  return <section id="management-followup" className="border-line bg-card space-y-4 rounded-2xl border p-4">
    <h2 className="text-base font-bold">후속조치 처리·확인</h2>
    {"error" in data ? <p role="alert" className="text-sm">{data.error}</p> : "empty" in data ? <>
      <p className="text-sm">아직 감지된 후속조치가 없습니다. 기한이 된 미완료 상담을 확인합니다.</p>
      {data.manager ? <RefreshCasesButton /> : null}
    </> : <>
      {byCaseId && data.row.status !== "blocked" ? <WindowLink href={`/consultations/${data.row.consultation_id}`} title="상담 원본" className="text-sm underline">상담 원본 확인</WindowLink> : null}
      <p className="text-sm font-bold">{data.row.studentName ?? "학생 기록 확인 필요"} · {CASE_LABEL[data.row.status]} · {data.row.assigneeName ?? (data.row.assignee_id ? "담당자 이름 확인 필요" : "담당자 지정 필요")}</p>
      <p className="text-text-dim text-xs">예정일 {data.row.source_due_on} · 원본 확인 {new Date(data.row.last_checked_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}{data.mode === "observe" ? " · 관찰 중: 추가 외부 알림 없음" : ""}</p>
      {data.row.result_kind ? <p className="text-sm">{RESULT_LABEL[data.row.result_kind]}: {data.row.result_note}</p> : null}
      {data.row.verification_note ? <p className="text-sm">확인 근거: {data.row.verification_note}</p> : null}
      {advice?.success ? <details className="space-y-2 text-sm">
        <summary className="cursor-pointer font-bold">AI 검토용 대응안{data.row.ai_version !== data.row.version ? " · 이전 기록 기준" : ""}</summary>
        <p>{advice.data.summary}</p>
        <ul className="list-disc space-y-1 pl-5">{advice.data.actions.map((a,i) => <li key={i}>{a}</li>)}</ul>
        <p>확인할 근거: {advice.data.verification}</p>
      </details> : null}
      {data.writable ? <CaseControls row={data.row} manager={data.manager} /> : null}
      {data.manager ? <RefreshCasesButton /> : null}
      <details className="text-sm"><summary className="cursor-pointer font-bold">최근 처리 이력 {data.events.length}건</summary>
        <ol className="mt-3 space-y-3">{data.events.map((event) => <li key={event.id}>
          <span className="font-bold">{EVENT_LABEL[event.kind] ?? "상태 변경"}</span>
          <span className="text-text-dim ml-2 text-xs">{new Date(event.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</span>
          {event.note ? <p className="whitespace-pre-wrap">{event.note}</p> : null}
        </li>)}</ol>
      </details>
    </>}
  </section>;
}
