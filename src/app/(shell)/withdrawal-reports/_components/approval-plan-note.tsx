import { titledName, type StaffOption } from "@/features/withdrawal-reports/model";
import { missingApproverNotice, type ReportApproval } from "@/features/withdrawal-reports/request-options";

/**
 * 요청 창의 보고서별 승인 안내(원장 2026-11-03 — 관리자 승인 생략은 **보고서마다**) — 작성 강사 · 과목 → 생략 / 승인할 관리자.
 * 보고서가 하나이고 생략도 아니면 그리지 않는다(위의 '관리자 승인' 칸 하나로 충분).
 */
export function ApprovalPlanNote({ plan, byTeacher, staff, labels, settingsUnavailable = false }: {
  plan: readonly ReportApproval[]; byTeacher: Readonly<Record<string, string[]>>; staff: readonly StaffOption[]; labels: Readonly<Record<string, string>>;
  /** 학원 설정을 못 읽었다 — 승인자 없음 대신 '다시 시도해 주세요'(3차 재리뷰 2026-11-06). */
  settingsUnavailable?: boolean;
}) {
  if (!plan.length || (plan.length === 1 && !plan[0].skip)) return null;
  // 승인자는 직급이 있으면 '정유진 부원장'(원장 2026-11-05) · 없으면 이름. 작성 강사는 이름만(리뷰 2026-11-06 — 직급 표기는 승인자에만).
  const approverOf = (id: string) => titledName(staff.find(u => u.id === id), "담당자");
  const nameOf = (id: string) => staff.find(u => u.id === id)?.name ?? "담당자";
  if (plan.every(p => p.skip))
    return <p role="note" className="border-line rounded-lg border border-dashed px-3 py-2 text-sm">관리자 승인 생략 — 작성 강사가 이 과목 관리자입니다. 보고서를 제출하면 바로 승인 완료로 넘어갑니다.</p>;
  return <ul role="note" aria-label="보고서별 승인" className="border-line space-y-1 rounded-lg border border-dashed px-3 py-2 text-sm">
    {plan.map(p => {
      const who = byTeacher[p.teacherId] ?? [];
      return <li key={p.teacherId}>
        <b>{nameOf(p.teacherId)}</b> · {p.subjects.map(s => labels[s] ?? s).join("·")} 보고서 — {p.skip
          ? <span className="text-muted-foreground">관리자 승인 생략(작성 강사가 과목 관리자)</span>
          : who.length ? `${who.map(approverOf).join(", ")} 승인`
          : <span className="text-att-late-ink">{p.candidates.length ? "승인할 관리자를 골라 주세요" : missingApproverNotice(staff, p, settingsUnavailable) ?? "선택할 수 있는 관리자가 없습니다"}</span>}
      </li>;
    })}
  </ul>;
}
