import { ChartCard,DonutChart,RankBars } from "@/components/analytics/charts";
import type { TeacherHub,RecordKind } from "./model";
import a from "@/components/analytics/analytics.module.css";
import s from "./workspace.module.css";
const labels:Record<RecordKind,string>={report:"수업보고",sheet:"강사 시트",consultation:"상담",promise:"약속 이행",marketing:"행사 접점",work:"업무문서"};
export function TeacherVisuals({data}:{data:TeacherHub}){
  const records=(Object.keys(labels) as RecordKind[]).filter(kind=>data.coverage.find(c=>c.key===kind)?.state==="ready").map(kind=>({label:labels[kind],value:data.records.filter(r=>r.kind===kind).length}));
  const classes=data.classes.map(c=>({label:c.name,value:new Set(data.enrollments.filter(e=>e.classId===c.id).map(e=>e.studentId)).size})).sort((a,b)=>b.value-a.value).slice(0,8);
  return <section className={a.dashboard} aria-label="강사 업무 시각화"><div className={s.halfGrid}>
    <ChartCard title="작성·이행 기록의 구성" tag={data.month} note="조회 가능한 기록만 표시 · 약속은 현재 전체, 그 외 기록은 선택 월 · 역량 점수와 다름"><DonutChart data={records} label="확인된 기록" unit="건"/></ChartCard>
    <ChartCard title="담당 반별 학생 분포" tag="상위 8개 반" note={`${data.today} 기준 · 반 안에서는 중복 제거, 여러 반을 수강하는 학생은 반별로 표시`}><RankBars data={classes} unit="명"/></ChartCard>
  </div></section>;
}
