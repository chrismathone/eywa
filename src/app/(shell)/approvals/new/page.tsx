import Link from "next/link";
import { ArrowLeft } from "@/components/icons/eywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
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
 * 화면 안에 있고(휴가신청서·품의서·지출결의서·업무연락, 2026-08-18 4종), 그 아래 결재선 표 →
 * 상세 입력 → 상신.
 *
 * ⚠️ 입사일 미등록(연차 계산 불가)은 **휴가신청서만** 막는다 — 품의서·지출결의서·업무연락은
 *    연차와 무관하므로 기안할 수 있어야 한다(composer가 leave 선택 시에만 안내·차단).
 */
export default async function NewApprovalPage() {
  const user = await requireAccess("approvals");
  // 세 조회는 서로 독립 — 함께 받는다(B4 직렬 워터폴 금지).
  const [balance, candidates, templates] = await Promise.all([
    getMyLeaveBalance(user.id),
    getApproverCandidates(),
    getMyLineTemplates(),
  ]);

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
        description="문서 종류를 고르고 결재선을 지정해 상신합니다."
        embedLabel="결재 문서 작성"
      />

      <DraftComposer
        drafterName={user.displayName}
        drafterJobTitle={user.jobTitle}
        candidates={candidates}
        templates={templates}
        // 기본 결재선은 없다 — 하이웍스처럼 기안자가 [+]로 매번 지정하거나 자주 쓰는 결재선을 불러온다.
        initialApproverIds={[]}
        periodEnd={balance.period?.end ?? null}
        remaining={balance.remaining}
        today={kstToday()}
      />
    </div>
  );
}
