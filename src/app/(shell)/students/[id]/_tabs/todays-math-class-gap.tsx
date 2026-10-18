import { SheetText } from "@/features/teacher-view/interface-label";
import type { ClassGap } from "@/features/integrations/todays-math/class-gap";

const kstDate = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium" });

// 지금 다니는 반이 없을 때 그 까닭 — 문장은 고정 조각만 SheetText로(강사뷰 번역), 반 이름·날짜는 값 그대로.
export function TodaysMathClassGap({ gap, pastClasses }: { gap: ClassGap; pastClasses: string[] }) {
  return <div className="text-text-dim mt-3 space-y-1.5 text-sm break-keep">
    {gap.kind === "sync_pending" ? <>
      <p><SheetText value={"aywa에는 지금 수학 반이 있는데 오늘 수학에는 아직 반영되지 않았어요."} /> <span className="text-foreground">{gap.aywaClasses.join(", ")}</span></p>
      <p><SheetText value={"명단은 1분마다 맞춰져요. 몇 분이 지나도 그대로면 확인이 필요하니 관리자에게 알려 주세요."} /></p>
    </> : gap.kind === "ended" ? <p>
      <SheetText value={"aywa에서 수학 반이 끝나 오늘 수학에서도 수강 종료로 처리됐어요."} />
      {gap.withdrawnAt ? <> ({kstDate.format(new Date(gap.withdrawnAt))})</> : null}
      {" "}<SheetText value={"지난 시험 기록은 그대로 남아 있어요."} />
    </p> : gap.kind === "not_in_math" ? <p>
      <SheetText value={"지금 다니는 수학 반이 없어 오늘 수학에 연결되지 않았어요. 오늘 수학은 지금 수학 반을 다니는 학생만 받아 와요."} />
    </p> : <p><SheetText value={"현재 연결된 수강 반이 없어요."} /></p>}
    {pastClasses.length ? <p><SheetText value={"지난 반:"} /> {pastClasses.join(", ")}</p> : null}
    <p className="text-xs"><SheetText value={"학생 계정(로그인) 발급 여부와는 관계없어요."} /></p>
  </div>;
}
