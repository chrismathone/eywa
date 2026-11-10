import { EmbedLink as Link } from "@/components/embed-link";
import { SampleBanner } from "@/features/mockup/sample";
import { requireSampleViewer } from "@/lib/auth/sample-viewer";
import { sampleMarketingReview } from "@/features/marketing/sample-data-operations";
import { MarketingInputReview } from "@/features/marketing/input-review";
import { MarketingInputBlueprint } from "@/features/marketing/input-blueprint";
import s from "@/features/marketing/inputs.module.css";

export const metadata = { title: "마케팅 입력·검토 — 에이와" };

/** 업무별 입력·통합 검토 시안 — 🔴 DB를 읽지 않는다(예시 값). */
export default async function MarketingInputsPage() {
  await requireSampleViewer();
  return <main className={s.page}><SampleBanner/><Link href="/marketing">← 연간 운영계획·행사 업무</Link><h1>업무별 입력과 통합 검토</h1><p>행사·상담·학생 화면에서 입력한 근거를 같은 행사·학생에 연결합니다.</p><MarketingInputReview {...sampleMarketingReview()}/><MarketingInputBlueprint/></main>;
}
