import { SheetText } from "@/features/teacher-view/interface-label";
import { EyIcon } from "@/components/icons/aywa-icons";

/** '오늘 수학' 출처 표시 — 사이드바 연결 앱과 같은 계산기 아이콘(성적 입력 칸 · 성적 현황 시험정보). 표시 전용. */
export function TodaysMathChip({ title = "오늘 수학 채점 결과와 같은 값" }: { title?: string }) {
  return <span className="bg-primary-soft text-primary inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-0.5 text-xs font-semibold" title={title}>
    <EyIcon name="calculator" size={12} strokeWidth={2} className="shrink-0" />
    <SheetText value={"오늘 수학"} />
  </span>;
}
