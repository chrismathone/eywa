import { SheetText } from "@/features/teacher-view/interface-label";
import type { ClassGap } from "@/features/integrations/todays-math/class-gap";

// 지금 다니는 반이 없을 때 그 까닭 — 문장은 고정 조각만 SheetText로(강사뷰 번역), 반 이름은 값 그대로.
export function TodaysMathClassGap({ gap }: { gap: ClassGap }) {
  return <div className="text-text-dim mt-3 space-y-1.5 text-sm break-keep">
    {gap.kind === "sync_pending" ? <>
      <p><SheetText value={"에이와에는 지금 수학 반이 있는데 오늘 수학에는 아직 반영되지 않았어요."} /> <span className="text-foreground">{gap.aywaClasses.join(", ")}</span></p>
      <p><SheetText value={"명단은 1분마다 맞춰져요. 몇 분이 지나도 그대로면 확인이 필요하니 관리자에게 알려 주세요."} /></p>
    </> : <p><SheetText value={"현재 연결된 수강 반이 없어요."} /></p>}
    <p className="text-xs"><SheetText value={"학생 계정(로그인) 발급 여부와는 관계없어요."} /></p>
  </div>;
}
