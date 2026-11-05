import Link from "next/link";
import { ArrowLeft } from "@/components/icons/aywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import {
  getApproverCandidates,
  getMyLeaveBalance,
  getMyLineTemplates,
} from "@/features/approvals/server/queries";
import { DraftComposer } from "./_composer";

export const metadata = { title: "기안하기 — 에이와" };

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
  // 네 조회는 서로 독립 — 함께 받는다(B4 직렬 워터폴 금지).
  // canWrite = 기안 액션(requireApprovalWriter)과 같은 canWriteTenant("approvals") — 주소로 바로 들어온 읽기 권한이면
  // 양식은 보이되 잠긴다(칸 비활성 + 안내, '결재 올리기'·결재선 저장 없음 — 원장 2026-11-05).
  const [balance, candidates, templates, canWrite] = await Promise.all([
    getMyLeaveBalance(user.id),
    getApproverCandidates(),
    getMyLineTemplates(),
    canWriteTenant(user.systemRole, "approvals"),
  ]);

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-4 p-4 md:p-6">
      <Link
        href="/approvals"
        className="text-text-dim hover:text-primary inline-flex items-center gap-1 text-sm font-medium transition"
      >
        <ArrowLeft className="size-4" /> 결재함으로
      </Link>

      {/* 설명 문장 없음(§4) — 양식 선택·결재선·상세가 화면 자체다. */}
      <PageHeader eyebrow="전자결재" title="결재 문서 작성" embedLabel="결재 문서 작성" />

      <DraftComposer
        drafterName={user.displayName}
        drafterJobTitle={user.jobTitle}
        candidates={candidates}
        templates={templates}
        // 기본 결재선은 없다 — 하이웍스처럼 기안자가 [+]로 매번 지정하거나 자주 쓰는 결재선을 불러온다.
        initialApproverIds={[]}
        periodEnd={balance.period?.end ?? null}
        remaining={balance.usageUnknown ? null : balance.remaining}
        today={kstToday()}
        canWrite={canWrite}
      />
    </div>
  );
}
