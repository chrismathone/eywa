import { ChartCard,DonutChart } from "@/components/analytics/charts";
import { palette } from "@/components/analytics/chart-math";
import { hasUnassignedSubject, needsEnrollmentLink, type FollowupView } from "./followup-model";
import a from "@/components/analytics/analytics.module.css";
import s from "./followup-workspace.module.css";
export function FollowupVisuals({data}:{data:FollowupView}){
  if(data.error)return null;
  const ranges=[{label:"등록 예정",min:-Infinity,max:-1},{label:"0–7일",min:0,max:7},{label:"8–30일",min:8,max:30},{label:"31–60일",min:31,max:60},{label:"61–90일",min:61,max:90},{label:"90일 후속",min:91,max:Infinity}];
  const stages=ranges.map(r=>({label:r.label,value:data.students.filter(s=>s.row.elapsedDays>=r.min&&s.row.elapsedDays<=r.max).length}));
  const unlinked=data.students.filter(needsEnrollmentLink).length;
  const assigned=data.students.filter(s=>!needsEnrollmentLink(s)&&!hasUnassignedSubject(s)).length,reports=data.students.flatMap(s=>s.reports);
  const feedback=[{label:"확인 완료",value:reports.filter(r=>r.review_state==="confirmed").length,color:palette[1]},{label:"확인 대기",value:reports.filter(r=>r.review_state==="pending").length,color:palette[0]},{label:"보완 요청",value:reports.filter(r=>r.review_state==="revision").length,color:palette[4]}];
  return <details className={`${s.visualSummary} ${a.dashboard}`} open><summary>전체 관리 대상 · 정착 단계와 담당 현황</summary><div className={s.visualGrid}>
    <ChartCard title="90일 정착 단계" note="학생당 한 구간 · 관리 완료율이 아닌 등록 경과일 구성"><DonutChart data={stages.filter(r=>r.value>0)} label="관리 학생" unit="명"/></ChartCard>
    <ChartCard title="과목별 관리 책임자 배정" note="학생당 한 구간 · 수강 연결 누락과 관리자 미지정을 구분"><DonutChart data={[{label:"모든 과목 지정",value:assigned,color:palette[1]},{label:"담당 미지정",value:data.students.length-assigned-unlinked,color:palette[4]},{label:"수강 연결 필요",value:unlinked,color:palette[2]}]} label="담당 배정" unit="명"/></ChartCard>
    <ChartCard title="피드백 확인 상태" note="조회된 보고 건수 기준 · 학생 수 및 후속 조치 완료율과 다름"><DonutChart data={feedback} label="적응 보고" unit="건"/></ChartCard>
  </div></details>;
}
