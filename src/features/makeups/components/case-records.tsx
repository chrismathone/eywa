import { MAKEUP_STATE, MAKEUP_REASON, makeupText } from "../status";
import type { MakeupCaseDetail } from "../server/read-types";
import { CaseHistory } from "./case-history";

const text = (value: unknown, fallback = "—") => typeof value === "string" && value ? value : fallback;
const SOURCE: Record<string, string> = { attendance: "출결", reservation: "기존 예약", manual: "수동 접수", import: "이관" };
const ATTENDANCE: Record<string, string> = { present: "출석", absent: "결석", planned_absent: "예정 결석", excused: "인정 결석", late: "지각", early_leave: "조퇴", makeup: "보강" };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function CaseRecords({ detail }: { detail: MakeupCaseDetail }) {
  const row = detail.case;
  return <section className="border-line space-y-4 rounded-lg border p-4">
    <h2 className="font-bold">보강 접수 내역</h2>
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[ ["학생", row.student_name], ["보강 사유", makeupText(MAKEUP_REASON, row.reason)], [row.reason === "additional" ? "수업" : row.reason === "class_cancelled" ? "휴강 수업" : "결석 수업", `${row.original_class_name ?? (row.reason === "additional" ? "결석분 아님" : "반 미지정")} · ${row.original_date ?? "—"}`],
        ["자격·진행", `${makeupText(MAKEUP_STATE, row.eligibility)} · ${makeupText(MAKEUP_STATE, row.lifecycle)}`],
        ["다음 담당·기한", `${row.owner_name ?? "미지정"} · ${row.due_date ?? "미지정"}`],
      ].map(([label, value]) => <div key={label}><dt className="font-medium">{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <p className="text-sm">목표 {row.target_minutes ?? "미정"}분 + 조정 {row.adjusted_minutes}분 − 검토 인정 {row.recognized_minutes}분 − 면제 {row.waived_minutes}분 = 의무 잔량 {row.outstanding_minutes ?? "미정"}분</p>
    <p className="whitespace-pre-wrap">{row.note || "접수 메모 없음"}</p>
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[["목표 분량", row.target_minutes], ["의무 잔량", row.outstanding_minutes], ["예약 중", row.committed_minutes], ["예약 가능", row.reservable_minutes]].map(([label, value]) =>
        <div key={String(label)} className="bg-bg-soft rounded-md p-3"><dt>{label}</dt><dd className="text-xl font-bold">{value === null ? "미정" : `${value}분`}</dd></div>)}
    </dl>
    {detail.policy ? <p className="text-sm">승인 정책 · {text(detail.policy.label, "승인 시 고정된 정책")} · {text(detail.policy.effective_from, "적용일 확인 필요")}</p> : <p className="text-sm">승인 정책·분량이 아직 확정되지 않았습니다.</p>}
    <ul className="space-y-2">{detail.sources.map(source => <li key={String(source.id)} className="border-line border-t pt-2">
      {SOURCE[text(source.source_kind)] ?? "연결 근거"} · 연결 {typeof source.created_at === "string" ? new Date(source.created_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "확인 필요"}
      {typeof record(source.snapshot).status === "string" ? <p>접수 당시 출결 · {ATTENDANCE[String(record(source.snapshot).status)] ?? "상태 확인 필요"}</p> : null}
      {typeof record(source.snapshot).slot_start === "string" ? <p>원수업 시작 · {String(record(source.snapshot).slot_start).slice(0, 5)}</p> : null}
      {source.source_conflict === true ? <span> · 원자료 정정 검토 필요</span> : null}
    </li>)}</ul>
    <CaseHistory caseId={row.id} />
  </section>;
}
