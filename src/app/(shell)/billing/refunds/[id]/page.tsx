import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import { getRefundRequestById } from "@/features/billing/server/refund-queries";
import { getCurrentUser } from "@/lib/auth/current-user";
import { viewAsTeacher } from "@/lib/auth/view-as";
import { loadRefundLink } from "@/features/withdrawal-reports/server/refund-steps";
import { linkedCompletionLock } from "@/features/withdrawal-reports/refund-decision";
import { RefundSheet } from "../_components/refund-sheet";

export const metadata = { title: "환불 요청서 — 에이와" };

export default async function RefundViewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("billing");
  const { id } = await params;
  const [refund, canWrite] = await Promise.all([
    getRefundRequestById(id),
    canWriteTenant(user.systemRole, "billing"),
  ]);
  if (!refund) notFound();
  const name = refund.data.student.name || "(이름 미입력)";
  // 퇴원보고서에 이어진 요청서(원장 2026-11-06) — 환불완료일자는 그 데스크 담당과 원장급만(저장 액션 · DB 트리거와 같은 판정 `linkedCompletionLock`).
  // 화면 행위자(강사뷰면 대상 직원)와 실제 로그인 계정(`user` — DB 트리거가 보는 계정) 둘 다 통과해야 연다(팀장 결정 2026-11-06). 못 읽으면 잠근다(저장 액션도 막는다).
  const actor = (await getCurrentUser({ teacherView: true })) ?? user;
  const link = canWrite ? await loadRefundLink(actor.tenantId, id).catch(() => "error" as const) : null;
  const completionLock = link === "error" ? "퇴원보고서 연결을 확인하지 못해 환불완료일자를 잠갔습니다. 새로고침해 주세요."
    : linkedCompletionLock(link, { id: actor.id, directorLevel: actor.systemRole === "master" && !(await viewAsTeacher()) }, { id: user.id, directorLevel: user.systemRole === "master" });

  return (
    <div className="print-portrait space-y-4 p-6">
      <header className="print:hidden">
        <BackLink href="/billing?tab=refunds" label="환불 요청서 목록으로" />
        <h1 className="text-foreground mt-1 text-lg font-bold">환불 요청서 — {name}</h1>
        <p className="text-text-dim text-xs">
          {new Date(refund.createdAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} 작성
          {refund.authorName ? ` · ${refund.authorName}` : ""} · 데이터베이스(수납·결제)에 저장됨
        </p>
      </header>
      <RefundSheet data={refund.data} id={id} userId={user.id} canWrite={canWrite} completionLock={completionLock} />
    </div>
  );
}
