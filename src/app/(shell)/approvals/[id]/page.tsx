import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "@/components/icons/eywa-icon-compat";
import { Pill } from "@/components/atoms/pill";
import { requireAccess } from "@/lib/auth/require-access";
import { APPROVAL_FORM_LABEL, docStatusLabel } from "@/features/approvals/types";
import { formatLeaveDays } from "@/features/leave/request-days";
import { getApprovalDoc, isMyTurn } from "@/features/approvals/server/queries";
import { ApprovalStamps } from "./_stamps";
import { DecidePanel, WithdrawPanel } from "./_decide-panel";

export const metadata = { title: "결재 문서 — eywa" };

const LEAVE_KIND_LABEL = { annual: "연차", half: "반차" } as const;

/**
 * 결재 문서 1건 — 종이 결재 문서의 배치를 그대로 옮겼다: **상단 좌측 표제·문서번호 / 우측 결재란**,
 * 아래 본문(양식 항목), 맨 아래 처리(내 차례면 승인·반려, 기안자면 회수).
 *
 * 열람 자격은 RLS(기안자·결재자·원장)가 정한다 — 못 보는 문서는 조회가 비어 404로 떨어진다([[#77]]:
 * 화면 조건이 아니라 데이터 게이트가 판정한다).
 */
export default async function ApprovalDocPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("approvals");
  const { id } = await params;

  const doc = await getApprovalDoc(id).catch(() => null);
  if (!doc) notFound();

  const status = docStatusLabel(doc.status);
  const myTurn = isMyTurn(doc, user.id);
  const canWithdraw =
    doc.drafterId === user.id &&
    doc.status === "pending" &&
    doc.steps.every((s) => s.decision === "pending");
  const leave = doc.leave;

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-4 p-4 md:p-6">
      <Link
        href="/approvals"
        className="text-text-dim hover:text-primary inline-flex items-center gap-1 text-xs font-medium transition print:hidden"
      >
        <ArrowLeft className="size-3.5" /> 결재함으로
      </Link>

      {/* 문서 — A4 종이 한 장 느낌(흰 판 + 표제 + 결재란) */}
      <article className="border-line bg-card shadow-card space-y-5 rounded-2xl border p-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="micro">{APPROVAL_FORM_LABEL[doc.form] ?? doc.form}</p>
            <h1 className="text-foreground mt-1 text-[19px] font-bold tracking-tight break-keep">
              {doc.title}
            </h1>
            <p className="text-text-dim mt-1 text-xs">
              문서번호 <span className="num">{doc.docNo}</span> · 기안{" "}
              <b className="text-foreground">{doc.drafterName}</b>
              {doc.drafterJobTitle ? <span className="text-text-faint"> {doc.drafterJobTitle}</span> : null}
              {" · "}
              <span className="num">{doc.submittedAt.slice(0, 10)}</span>
              <span className="ml-2">
                <Pill color={status.color}>{status.label}</Pill>
              </span>
            </p>
          </div>
          <ApprovalStamps doc={doc} />
        </header>

        {leave ? (
          <table className="border-line w-full border-collapse border text-sm">
            <tbody className="[&_th]:bg-bg-soft/60 [&_th]:text-text-dim [&_td]:text-foreground [&_th]:border-line [&_td]:border-line [&_th]:border [&_td]:border [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_td]:text-[13px]">
              <tr>
                <th className="w-[110px]">휴가 종류</th>
                <td>{LEAVE_KIND_LABEL[leave.kind]}</td>
                <th className="w-[110px]">일수</th>
                <td className="num">{formatLeaveDays(leave.days)}</td>
              </tr>
              <tr>
                <th>기간</th>
                <td className="num" colSpan={3}>
                  {leave.startDate}
                  {leave.endDate !== leave.startDate ? ` ~ ${leave.endDate}` : ""}
                </td>
              </tr>
              <tr>
                <th>사유</th>
                <td className="break-keep" colSpan={3}>
                  {leave.reason ?? "—"}
                </td>
              </tr>
              <tr>
                <th>연차 근거</th>
                <td className="text-text-dim text-xs" colSpan={3}>
                  사용 기간{" "}
                  <span className="num">
                    {leave.periodStart} ~ {leave.periodEnd}
                  </span>{" "}
                  · 부여 <span className="num">{formatLeaveDays(leave.grantedDays)}</span> — 기안
                  시점으로 동결된 값입니다
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="text-text-faint text-sm">양식 내용을 불러오지 못했습니다.</p>
        )}

        {/* 결재 의견 — 처리한 칸만 모아 보여준다(반려 사유가 여기 남는다). */}
        {doc.steps.some((s) => s.comment) ? (
          <section className="space-y-1">
            <p className="micro">결재 의견</p>
            {doc.steps
              .filter((s) => s.comment)
              .map((s) => (
                <p key={s.stepNo} className="text-text-dim text-[13px] break-keep">
                  <b className="text-foreground">{s.approverName}</b> — {s.comment}
                </p>
              ))}
          </section>
        ) : null}

        {doc.outcomeNote ? (
          <p className="border-line text-text-dim border-t pt-3 text-xs">{doc.outcomeNote}</p>
        ) : null}
      </article>

      {myTurn ? <DecidePanel documentId={doc.id} /> : null}
      {canWithdraw ? <WithdrawPanel documentId={doc.id} /> : null}
    </div>
  );
}
