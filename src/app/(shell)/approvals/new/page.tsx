import Link from "next/link";
import { ArrowLeft } from "@/components/icons/eywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { leavePeriodLabel } from "@/features/leave/accrual";
import { formatLeaveDays } from "@/features/leave/request-days";
import { approvalLineFor } from "@/features/approvals/access";
import {
  getApproverCandidates,
  getMyLeaveBalance,
  getMyLineTemplates,
} from "@/features/approvals/server/queries";
import { DraftComposer } from "./_composer";

export const metadata = { title: "기안하기 — eywa" };

/**
 * 기안(결재 문서 작성) — **하이웍스 '결재 문서 작성' 화면 흐름**(원장 스크린샷 대조 2026-08-14):
 * 기안하기를 누르면 양식이 박힌 폼이 아니라 **문서 작성 화면**으로 온다. 문서 종류(양식) 선택이
 * 화면 안에 있고, 그 아래 결재선 표 → 상세 입력 → 상신. 지금 양식은 휴가신청서 하나라 선택지가
 * 하나지만 구조는 양식 중립이다(_composer.tsx).
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
    <div className="mx-auto w-full max-w-[900px] space-y-4 p-4 md:p-6">
      <Link
        href="/approvals"
        className="text-text-dim hover:text-primary inline-flex items-center gap-1 text-xs font-medium transition"
      >
        <ArrowLeft className="size-3.5" /> 결재함으로
      </Link>

      <PageHeader
        eyebrow="전자결재"
        title="결재 문서 작성"
        description={
          period
            ? `연차 사용 기간 ${leavePeriodLabel(period)} · 부여 ${formatLeaveDays(period.granted)} · 잔여 ${formatLeaveDays(balance.remaining)}`
            : "문서 종류를 고르고 결재선을 지정해 상신합니다."
        }
        embedLabel="결재 문서 작성"
      />

      {!period ? (
        <div className="border-line bg-card rounded-2xl border border-dashed p-8 text-center">
          <p className="text-foreground text-sm font-medium">입사일이 등록되지 않았습니다</p>
          <p className="text-text-dim mt-1 text-xs">
            연차는 입사일에서 계산합니다 — 사무실(직원관리)에 입사일 등록을 요청하면 바로 계산됩니다.
          </p>
        </div>
      ) : (
        <DraftComposer
          drafterName={user.displayName}
          drafterJobTitle={user.jobTitle}
          candidates={candidates}
          templates={templates}
          initialApproverIds={approvalLineFor(user.id)}
          periodEnd={period.end}
          remaining={balance.remaining}
          today={kstToday()}
        />
      )}
    </div>
  );
}
