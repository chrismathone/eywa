import Link from "next/link";
import { ArrowLeft } from "@/components/icons/eywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { leavePeriodLabel } from "@/features/leave/accrual";
import { formatLeaveDays } from "@/features/leave/request-days";
import { APPROVAL_FORM_LABEL } from "@/features/approvals/types";
import { getApprovalLinePreview, getMyLeaveBalance } from "@/features/approvals/server/queries";
import { LeaveDraftForm } from "./_leave-form";

export const metadata = { title: "기안하기 — eywa" };

/**
 * 기안 — 양식을 고르고 문서를 써서 올린다. 지금 양식은 **휴가신청서 하나**라 바로 그 폼을 편다
 * (양식이 둘 이상이 되면 이 자리에 양식 선택 카드가 붙는다 — 문서 껍데기는 이미 양식 중립이다).
 *
 * 그룹웨어 관행대로 **결재선을 올리기 전에 보여준다** — 누가 어떤 순서로 받는지 모르고 올리면
 * 나중에 "왜 저 사람한테 갔지"가 된다.
 */
export default async function NewApprovalPage() {
  const user = await requireAccess("approvals");
  const [balance, line] = await Promise.all([
    getMyLeaveBalance(user.id),
    getApprovalLinePreview(user.id),
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

          {/* 결재선 미리보기 — 올리기 전에 순서를 보여준다. */}
          <div className="border-line bg-bg-soft/40 rounded-xl border px-4 py-3">
            <p className="micro mb-2">결재선</p>
            {line.length === 0 ? (
              <p className="text-danger text-xs">
                결재선이 비어 있어 상신할 수 없습니다 — 관리자에게 문의하세요.
              </p>
            ) : (
              <ol className="flex flex-wrap items-center gap-2">
                <li className="border-line bg-card text-text-dim rounded-lg border px-2.5 py-1 text-xs">
                  기안 <b className="text-foreground">{user.displayName}</b>
                </li>
                {line.map((m, i) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <span className="text-text-faint text-xs">→</span>
                    <span className="border-line bg-card text-text-dim rounded-lg border px-2.5 py-1 text-xs">
                      {i + 1}차 {m.roleLabel} <b className="text-foreground">{m.name}</b>
                      {m.jobTitle ? <span className="text-text-faint"> {m.jobTitle}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <LeaveDraftForm
            periodEnd={period.end}
            remaining={balance.remaining}
            today={kstToday()}
            hasLine={line.length > 0}
          />
        </section>
      )}
    </div>
  );
}
