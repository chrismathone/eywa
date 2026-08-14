import { STEP_DECISION_LABEL, type StepDecision } from "@/features/approvals/types";
import type { ApprovalDocRow } from "@/features/approvals/server/queries";

/**
 * 결재란 — 종이 결재 문서의 우상단 도장 칸을 그대로 옮긴 것(그룹웨어 표준).
 * 칸 = [기안] [1차 검토] [2차 승인] … 각 칸에 **역할 · 이름 · 결과 · 날짜**.
 *
 * ⚠️ 사람 표시는 **이름 텍스트만** — 이름 앞 아바타/이니셜 배지는 이 프로젝트에서 영구 금지다.
 * ⚠️ 지금 차례인 칸은 테두리를 세워 어디서 멈춰 있는지 한눈에 보이게 한다.
 */

const DECISION_TONE: Record<StepDecision, string> = {
  pending: "text-text-faint",
  approved: "text-green",
  rejected: "text-danger",
};

function Cell({
  role,
  name,
  body,
  tone,
  active,
}: {
  role: string;
  name: string;
  body: string;
  tone: string;
  active?: boolean;
}) {
  return (
    <div
      className={`w-[92px] shrink-0 overflow-hidden rounded-lg border text-center ${
        active ? "border-primary ring-primary/30 ring-2" : "border-line"
      }`}
    >
      <p className="border-line bg-bg-soft text-text-dim border-b py-0.5 text-[10px] font-semibold">
        {role}
      </p>
      <p className="text-foreground truncate px-1 pt-1.5 text-[12px] font-medium">{name}</p>
      <p className={`px-1 pb-1.5 text-[10px] ${tone}`}>{body}</p>
    </div>
  );
}

export function ApprovalStamps({ doc }: { doc: ApprovalDocRow }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Cell
        role="기안"
        name={doc.drafterName}
        body={doc.submittedAt.slice(5, 10).replace("-", "/")}
        tone="text-text-faint"
      />
      {doc.steps.map((s) => (
        <Cell
          key={s.stepNo}
          role={`${s.stepNo}차 ${s.roleLabel}`}
          name={s.approverName}
          body={
            s.decision === "pending"
              ? doc.status === "pending" && doc.currentStep === s.stepNo
                ? "결재 차례"
                : STEP_DECISION_LABEL[s.decision]
              : `${STEP_DECISION_LABEL[s.decision]} ${(s.decidedAt ?? "").slice(5, 10).replace("-", "/")}`
          }
          tone={DECISION_TONE[s.decision]}
          active={doc.status === "pending" && doc.currentStep === s.stepNo}
        />
      ))}
    </div>
  );
}
