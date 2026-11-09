import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import { getRefundRequestById } from "@/features/billing/server/refund-queries";
import { getCurrentUser } from "@/lib/auth/current-user";
import { viewAsTeacher } from "@/lib/auth/view-as";
import { loadRefundLink } from "@/features/withdrawal-reports/server/refund-steps";
import { linkedCompletionLock, linkedDeleteLock, linkedEditLock } from "@/features/withdrawal-reports/refund-decision";
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
  // 연결은 읽기 권한자에게도 읽는다 — 대체됨 경고·상한은 보는 사람 모두에게(리뷰 r2 I4 · 돈이 나가기 전에 읽게).
  const link = await loadRefundLink(actor.tenantId, id).catch(() => "error" as const);
  const who = { id: actor.id, directorLevel: actor.systemRole === "master" && !(await viewAsTeacher()) };
  const account = { id: user.id, directorLevel: user.systemRole === "master" };
  const failed = "퇴원보고서 연결을 확인하지 못해 잠갔습니다. 새로고침해 주세요.";
  const completionLock = link === "error" ? failed : linkedCompletionLock(link, who, account);
  // 이어진 요청서 — 대체됨 경고(새 요청서 링크·담당) · 잠금 사유 · 상한(원장 승인 줄 낸 돈 합) · 고치기·지우기 잠금(담당 데스크(재직)·원장만 · 완료된 것은 지우지 않음).
  const linked = link === "error"
    ? { superseded: null, lock: failed, cap: null, capLines: 0, editLock: failed, deleteLock: failed, canceledOnly: false, clearLock: failed }
    : link ? { superseded: link.supersededBy, lock: completionLock, cap: link.cap, capLines: link.capLines, canceledOnly: link.canceledOnly,
        clearLock: linkedCompletionLock(link, who, account, true),
        editLock: linkedEditLock(link, who, account), deleteLock: linkedDeleteLock(link, !!refund.data.result.completedDate.trim(), who, account) }
    : null;

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
      <RefundSheet data={refund.data} id={id} userId={user.id} canWrite={canWrite} completionLock={completionLock} linked={linked} />
    </div>
  );
}
