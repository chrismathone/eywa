import { z } from "zod";
import type { Metric, StoredPeriod } from "@/features/teacher-portfolio/model/types";
import type { GradeRow } from "@/features/teacher-portfolio/model/source-types";
import { METRIC_META } from "@/features/teacher-portfolio/evaluation/catalog";
import { payDataMonth } from "@/features/teacher-portfolio/model/pay-ratio";

export const monthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export const capacityRequestSchema = z.object({
  teacherId:z.uuid(), month:monthSchema, version:z.number().int().min(0), requestId:z.uuid(),
  maxStudents:z.number().int().min(0).max(2000), basis:z.string().trim().min(2).max(1500),
}).strict();
export type CapacityPlan={teacher_id:string;month:string;version:number;max_students:number;basis:string;updated_at:string};
export type TeacherChoice={id:string;name:string};
export type HubClass={id:string;name:string;subject:string;assignment:string;sourceIds:string[]};
export type HubStudent={id:string;name:string;school:string|null;grade:string|null};
export type HubEnrollment={id:string;studentId:string;classId:string;start:string;end:string|null};
export type RecordKind="report"|"sheet"|"consultation"|"promise"|"marketing"|"work";
export type HubRecord={id:string;kind:RecordKind;label:string;date:string|null;href:string;source:string;studentId?:string;state?:string;evidence?:{source:string;id:string;href:string}[];note?:string};
export type SourceCoverage={key:string;label:string;state:"ready"|"unavailable"|"forbidden";count:number|null;note:string};
export type HubMetric={id:string;label:string;raw:number|null;unit:string;state:"ready"|"missing"|"estimated";basis:string;reason:string;dataMonth:string;rowCount:number;context:string[]};
export type GraphNode={id:string;kind:string;label:string;href?:string;source?:string;sourceId?:string;date?:string;state?:string;value?:number|null;attributes?:Record<string,unknown>};
export type GraphEdge={from:string;to:string;relation:string;basis:"recorded"|"calculated";evidence:string[];asOf:string};
export type TeacherGraph={schema:"aywa-teacher-hub-v1";teacherId:string;month:string;observedAt:string;nodes:GraphNode[];edges:GraphEdge[];coverage:SourceCoverage[];scope:{liveAsOf:string;metricMonth:string;allHistoryLoaded:false;maxMetricEvidenceRows:number}};
export type TeacherHub={teacher:TeacherChoice;teachers:TeacherChoice[];month:string;months:string[];today:string;computedAt:string|null;closing:string;classes:HubClass[];students:HubStudent[];enrollments:HubEnrollment[];records:HubRecord[];metrics:HubMetric[];coverage:SourceCoverage[];capacity:CapacityPlan|null;capacityReady:boolean;canWrite:boolean;graph:TeacherGraph;grades:ReturnType<typeof compareGrades>;insights:string[]};

export function metricView(m:Metric,month:string):HubMetric {
  const meta=METRIC_META[m.id as keyof typeof METRIC_META];
  const unavailable=m.missing||m.uncounted||("newcomer" in m&&m.newcomer);
  const raw=!unavailable&&!m.estimated&&typeof m.raw==="number"&&Number.isFinite(m.raw)?m.raw:null;
  return {id:m.id,label:m.label??meta?.short??m.id,raw,unit:meta?.unit??("unit" in m?m.unit:"점"),
    state:m.estimated?"estimated":raw===null?"missing":"ready",basis:m.basis,reason:m.reason,
    dataMonth:m.id==="payRatio"?payDataMonth(month):month,rowCount:m.detail.length,
    context:m.id==="churn"?[`전월 담당 분모 ${m.base}명 · 반영 종료 ${m.counted}명 · 담당 기준 ${m.need}일`]:m.id==="counsel"?[`대상 ${m.total}명 · 상담 ${m.consulted}명`]:m.id==="grades"?(m.kinds??[]).map(k=>`${k.kind}: ${k.average.toFixed(1)}% · ${k.count}건 · ${k.measure==="submit"?"제출률":k.measure==="take"?"응시율":"점수율"}`):m.id==="payRatio"?[`담당 학생 ${m.students??"미확인"}명 · 반 ${m.classes??"미확인"}개`,m.source??"급여 원본 확인 필요"]:[]};
}

/** Matched observations, not causal teacher effects or an entry-level adjustment. */
export function compareGrades(current:StoredPeriod|null,previous:StoredPeriod|null,allowedStudentIds?:ReadonlySet<string>){
  const rows=(p:StoredPeriod|null):GradeRow[]=>{const m=p?.items.find(m=>m.id==="grades");return m&&!m.off&&!m.missing&&!m.estimated&&!m.uncounted?(m.detail as GradeRow[]).filter(r=>!allowedStudentIds||allowedStudentIds.has(r.studentId)):[];};
  const prior=new Map(rows(previous).map(r=>[r.studentId,r]));
  const distribution=[{label:"60% 미만",count:0},{label:"60–79%",count:0},{label:"80–89%",count:0},{label:"90% 이상",count:0}];
  const pairs:{studentId:string;kind:string;before:number;after:number;change:number}[]=[];
  let excludedDistribution=0;
  for(const row of rows(current)){
    const scores=(["check","school","other"] as const).flatMap(k=>{const v=row.byKind?.[k];return v&&v.count>0&&Number.isFinite(v.average)?[v]:[];});
    if(scores.length){const average=scores.reduce((n,v)=>n+v.average*v.count,0)/scores.reduce((n,v)=>n+v.count,0);distribution[average<60?0:average<80?1:average<90?2:3].count++;}else excludedDistribution++;
    for(const kind of ["check","school","other"] as const){
      const a=prior.get(row.studentId)?.byKind?.[kind],b=row.byKind?.[kind];
      if(a&&b&&a.count>0&&b.count>0&&Number.isFinite(a.average)&&Number.isFinite(b.average))pairs.push({studentId:row.studentId,kind,before:a.average,after:b.average,change:b.average-a.average});
    }
  }
  return {distribution,pairs,excludedDistribution,averageChange:pairs.length?pairs.reduce((n,p)=>n+p.change,0)/pairs.length:null};
}
export function promiseStatus(state:string,acknowledged:boolean,dueOn:string,today:string){return state==="completed"?"완료":dueOn<today?acknowledged?"기한 경과":"기한 경과 · 인수 대기":!acknowledged?"인수 대기":"진행 중";}
export function hasCurrentClassPeriod(slots:readonly {valid_from:string|null;valid_to:string|null}[],today:string){return !slots.length||slots.some(s=>(!s.valid_from||s.valid_from<=today)&&(!s.valid_to||s.valid_to>=today));}
export function capacityRemaining(plan:CapacityPlan|null,currentStudents:number){return plan?plan.max_students-currentStudents:null;}

export function buildTeacherGraph(input:{tenant:string;teacher:TeacherChoice;month:string;today:string;observedAt:string;classes:HubClass[];students:HubStudent[];enrollments:HubEnrollment[];records:HubRecord[];period:StoredPeriod|null;capacity:CapacityPlan|null;coverage:SourceCoverage[]}){
  const nodes=new Map<string,GraphNode>(),edges:GraphEdge[]=[];
  const id=(kind:string,key:string)=>`${input.tenant}:${kind}:${key}`;
  const root=id("teacher",input.teacher.id);
  const node=(kind:string,key:string,label:string,extra:Omit<GraphNode,"id"|"kind"|"label">={})=>{const keyId=id(kind,key);nodes.set(keyId,{...nodes.get(keyId),id:keyId,kind,label,...extra});return keyId;};
  const edge=(from:string,relation:string,to:string,evidence:string[]=[],basis:GraphEdge["basis"]="recorded",asOf=input.today)=>edges.push({from,relation,to,basis,evidence,asOf});
  node("teacher",input.teacher.id,input.teacher.name,{source:"users",sourceId:input.teacher.id,href:`/staff/${input.teacher.id}`});
  for(const s of input.students)node("student",s.id,s.name,{source:"students",sourceId:s.id,href:`/students/${s.id}/hub`});
  const studentIds=new Set(input.students.map(s=>s.id));
  for(const c of input.classes){const cid=node("class",c.id,c.name,{source:"classes",sourceId:c.id,href:"/timetable",attributes:{assignment:c.assignment,subject:c.subject}});edge(root,"assigned_to_class",cid,c.sourceIds);}
  for(const e of input.enrollments)if(studentIds.has(e.studentId)&&nodes.has(id("class",e.classId))){
    const eid=node("enrollment",e.id,"현재 수강",{source:"enrollments",sourceId:e.id,attributes:{start:e.start,end:e.end}});
    edge(id("student",e.studentId),"has_enrollment",eid,[`enrollments:${e.id}`]);edge(eid,"enrolled_in",id("class",e.classId),[`enrollments:${e.id}`]);
  }
  for(const r of input.records){
    const rid=node(r.source,r.id,r.label,{source:r.source,sourceId:r.id,href:r.href,date:r.date??undefined,state:r.state,attributes:{category:r.kind,note:r.note}});
    edge(root,r.kind==="promise"?"owns_commitment":r.kind==="sheet"?"last_updated":"recorded",rid,[`${r.source}:${r.id}`]);
    if(r.studentId&&studentIds.has(r.studentId))edge(rid,"concerns_student",id("student",r.studentId),[`${r.source}:${r.id}`]);
    for(const proof of r.evidence??[]){const pid=node(proof.source,proof.id,"이행·검토 근거",{source:proof.source,sourceId:proof.id,href:proof.href});edge(rid,"supported_by",pid,[`${proof.source}:${proof.id}`]);}
  }
  const period=input.period;
  if(period){
    const sourceId=`${input.teacher.id}:${input.month}`,pid=node("portfolio",sourceId,`${input.month} 저장 집계`,{source:"teacher_portfolio_months",sourceId,href:`/class-review?tab=portfolio&teacher=${input.teacher.id}`,date:period.closing.computedAt,attributes:{closing:period.closing,from:period.start,through:period.end}});
    edge(root,"has_monthly_snapshot",pid,[`teacher_portfolio_months:${sourceId}`]);
    for(const m of period.items.filter(m=>!m.off)){
      const view=metricView(m,input.month),mid=node("metric",`${sourceId}:${m.id}`,view.label,{value:view.raw,state:view.state,attributes:{...view,sourcePath:`payload.items[id=${m.id}]`}});
      edge(pid,"contains_metric",mid,[pid],"calculated",period.closing.computedAt);
      m.detail.slice(0,120).forEach((entry,i)=>{
        const r=entry as unknown as Record<string,unknown>;
        if(typeof r.studentId==="string"&&!studentIds.has(r.studentId))return;
        const sid=typeof r.studentId==="string"?r.studentId:null;
        const allowed=["day","className","type","counted","note","tests","average","daily","monthly","byKind","state","consulted","status","points","waiting","rows","billed","share"];
        const attributes=Object.fromEntries(allowed.filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
        const rid=node("snapshot_evidence",`${sourceId}:${m.id}:${i}`,`${view.label} 근거 ${i+1}`,{source:"teacher_portfolio_months",sourceId,href:sid?`/students/${sid}/hub`:`/class-review?tab=portfolio&teacher=${input.teacher.id}`,attributes:{...attributes,sourcePath:`payload.items[id=${m.id}].detail[${i}]`,computedAt:period.closing.computedAt}});
        edge(mid,"supported_by",rid,[pid],"calculated",period.closing.computedAt);
        if(sid)edge(rid,"concerns_student",id("student",sid),[pid],"calculated",period.closing.computedAt);
      });
    }
  }
  if(input.capacity){const p=input.capacity,pid=node("capacity",`${p.teacher_id}:${p.month}`,"월별 배정 상한",{source:"teacher_capacity_plans",sourceId:`${p.teacher_id}:${p.month}`,value:p.max_students,date:p.updated_at,attributes:{basis:p.basis,version:p.version,month:p.month}});edge(root,"has_capacity_plan",pid,[pid]);}
  // The name lookup also contains prior-month students. Export only nodes with evidence in this graph.
  const connected=new Set([root,...edges.flatMap(e=>[e.from,e.to])]);
  return {schema:"aywa-teacher-hub-v1" as const,teacherId:input.teacher.id,month:input.month,observedAt:input.observedAt,nodes:[...nodes.values()].filter(n=>connected.has(n.id)),edges,coverage:input.coverage,scope:{liveAsOf:input.today,metricMonth:input.month,allHistoryLoaded:false as const,maxMetricEvidenceRows:120}};
}

export function teacherInsights(metrics:HubMetric[],overdue:number,capacity:CapacityPlan|null,students:number){
  const byId=new Map(metrics.map(m=>[m.id,m]));const notes:string[]=[];
  const revenue=byId.get("revenue"),churn=byId.get("churn"),pay=byId.get("payRatio");
  if(revenue?.raw!=null&&churn?.raw!=null)notes.push(`담당 매출 지표 ${revenue.raw.toFixed(1)}${revenue.unit}와 퇴원율 ${churn.raw.toFixed(1)}%를 함께 확인하세요. 매출 비중·퇴원 분모·제외 사유를 각각 원본에서 확인할 수 있습니다.`);
  if(pay?.raw!=null)notes.push(`급여비율 ${pay.raw.toFixed(1)}%는 ${pay.dataMonth} 자료 기준입니다. 선택 월 성과와 비용의 대상 월이 다를 수 있습니다.`);
  if(overdue)notes.push(`기한이 지난 담당 약속 ${overdue}건이 있습니다. 학생 추가 배정 전에 실행 증거와 후속 일정을 확인하세요.`);
  const remaining=capacityRemaining(capacity,students);
  if(remaining!==null)notes.push(remaining>=0?`입력한 상한 기준 추가 배정 여력은 ${remaining}명입니다. 학생 수준·과목·시간표 적합성은 별도로 확인합니다.`:`현재 담당 학생이 입력한 상한보다 ${-remaining}명 많습니다. 배정과 담당 반 구성을 검토하세요.`);
  if(metrics.some(m=>m.state!=="ready"))notes.push("자료 없음·과거 추정 항목은 실제 0점·0% 실적으로 해석하지 않습니다.");
  return notes;
}
