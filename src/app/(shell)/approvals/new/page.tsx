import Link from "next/link";
import { ArrowLeft } from "@/components/icons/eywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { leavePeriodLabel } from "@/features/leave/accrual";
import { formatLeaveDays } from "@/features/leave/request-days";
import { APPROVAL_FORM_LABEL } from "@/features/approvals/types";
import { approvalLineFor } from "@/features/approvals/access";
import {
  getApproverCandidates,
  getMyLeaveBalance,
  getMyLineTemplates,
} from "@/features/approvals/server/queries";
import { LeaveDraftForm } from "./_leave-form";

export const metadata = { title: "기안하기 — eywa" };

/**
 * 기안 — 양식을 고르고 문서를 써서 올린다. 지금 양식은 **휴가신청서 하나**라 바로 그 폼을 편다
 * (양식이 둘 이상이 되면 이 자리에 양식 선택 카드가 붙는다 — 문서 껍데기는 이미 양식 중립이다).
 *
 * 결재선은 폼 안 **결재선 편집기**(하이웍스 대응)에서 기안자가 직접 지정한다 — 후보·저장된 결재선을
 * 서버에서 내려주고, 초기값은 기본 결재선(approvalLineFor)이다.
 */
export default async function NewApprovalPage() {
  const user = await requireAccess("approvals");
  // 세 조회는 서로 독립 — 함께 받는다(B4 직렬 워터폴 금지).
  const [balance, candidates, templates] = await Promise.all([
    getMyLeaveBalance(user.id),
    getApproverCandidates(),
    getMyLineTemplates(),
  ]);
  const period = balance.period;

  return (
    <div className="mx-auto w-full max-w-[860px] space-y-5 p-4 md:p-6">
      <Link
        href="/approvals"
        className="text-text-dim hover:text-primary inline-flex items-center gap-1 text-xs font-medium transition"
      >
        <ArrowLeft className="size-3.5" /> 결재함으로
      </Link>

      <PageHeader
        eyebrow="전자결재"
        title="기안하기"
        description="양식을 골라 문서를 작성하면 결재선에 순서대로 올라갑니다."
        embedLabel="기안하기"
      />

      {/* 양식 — 지금은 하나뿐이라 카드 하나. 늘어나면 여기가 선택 그리드가 된다. */}
      <section className="border-primary/30 bg-primary-soft/40 rounded-2xl border p-4">
        <p className="text-primary text-[13px] font-bold">{APPROVAL_FORM_LABEL.leave}</p>
        <p className="text-text-dim mt-0.5 text-xs">
          연차·반차를 신청합니다. 잔여 연차는 입사일 기준 법정 일수에서 자동으로 계산됩니다.
        </p>
      </section>

      {!period ? (
        <div className="border-line bg-card rounded-2xl border border-dashed p-8 text-center">
          <p className="text-foreground text-sm font-medium">입사일이 등록되지 않았습니다</p>
          <p className="text-text-dim mt-1 text-xs">
            연차는 입사일에서 계산합니다 — 사무실(직원관리)에 입사일 등록을 요청하면 바로 계산됩니다.
          </p>
        </div>
      ) : (
        <section className="border-line bg-card shadow-card space-y-4 rounded-2xl border p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-foreground text-sm font-bold">문서 작성</h2>
            <p className="text-text-faint text-[11px]">
              연차 사용 기간 <span className="num">{leavePeriodLabel(period)}</span> · 부여{" "}
              {formatLeaveDays(period.granted)} · 잔여{" "}
              <b className="text-foreground">{formatLeaveDays(balance.remaining)}</b> · 일요일은
              차감하지 않습니다
            </p>
          </div>

          <LeaveDraftForm
            periodEnd={period.end}
            remaining={balance.remaining}
            today={kstToday()}
            drafterName={user.displayName}
            candidates={candidates}
            templates={templates}
            initialApproverIds={approvalLineFor(user.id)}
          />
        </section>
      )}
    </div>
  );
}
