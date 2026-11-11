import { SampleBanner } from "@/features/mockup/sample";
import { requireSampleViewer } from "@/features/marketing/sample-access";
import { sampleMarketingReview } from "@/features/marketing/sample-data-operations";
import { MarketingInputReview } from "@/features/marketing/input-review";
import { MarketingInputBlueprint } from "@/features/marketing/input-blueprint";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";

export const metadata = { title: "마케팅 입력·검토 — 에이와" };

/** 업무별 입력·통합 검토 시안 — 🔴 DB를 읽지 않는다(예시 값). 머리글 = 앱 PageHeader(원장 2026-11-11 디자인 통일). */
export default async function MarketingInputsPage() {
  await requireSampleViewer();
  return <div className="space-y-5"><PageHeader title="업무별 입력과 통합 검토" description="행사·상담·학생 화면에서 입력한 근거를 같은 행사·학생에 연결합니다."/><SampleBanner/><BackLink href="/marketing" label="연간 운영계획·행사 업무"/><MarketingInputReview {...sampleMarketingReview()}/><MarketingInputBlueprint/></div>;
}
