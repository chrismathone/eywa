"use client";
import { EmbedLink } from "@/components/embed-link";
import type { ReportConsultation } from "@/features/withdrawal-reports/consultation";

export function ConsultationLinks({ records, selected, editable, pending, onChange }: {
  records: ReportConsultation[]; selected: string[]; editable: boolean; pending: boolean; onChange: (ids: string[]) => void;
}) {
  const linked = records.filter(r => selected.includes(r.id));
  const label = (r: ReportConsultation) => `${new Date(r.consultedAt).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })} · ${{ student: "학생", parent: "학부모", both: "학생·학부모" }[r.audience ?? "both"]}`;
  return <div className="space-y-2">
    {linked.map(r => <details key={r.id}><summary className="cursor-pointer">{label(r)} · {r.summary.slice(0, 60) || "상담기록"}</summary><p className="whitespace-pre-wrap">{r.summary}</p><EmbedLink href={`/consultations/${r.id}`} className="text-primary underline">상담기록 보기</EmbedLink></details>)}
    {selected.some(id => !records.some(r => r.id === id)) && <p>연결된 상담 중 현재 열람할 수 없는 기록이 있습니다.</p>}
    {editable && <details><summary className="cursor-pointer">등록된 상담 연결{selected.length ? ` (${selected.length}건)` : ""}</summary>
      {records.length ? <div className="max-h-64 space-y-2 overflow-y-auto py-2">{records.map(r => <label key={r.id} className="flex items-start gap-2">
        <input type="checkbox" style={{ width: "auto", marginTop: 4 }} checked={selected.includes(r.id)} disabled={pending || (!selected.includes(r.id) && selected.length >= 20)} onChange={e => onChange(e.target.checked ? [...selected, r.id] : selected.filter(id => id !== r.id))} />
        <span>{label(r)} · {r.summary.slice(0, 120) || "상담기록"}</span>
      </label>)}</div> : <p>연결할 수 있는 상담기록이 없습니다.</p>}
    </details>}
    {!editable && !selected.length && <span>연결된 상담 없음</span>}
  </div>;
}
