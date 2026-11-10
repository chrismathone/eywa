import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { isMergedStudent } from "@/features/students/status/merged";
import { isEnrollmentActiveOn, isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";
import { managementAccess } from "./access";
import {loadSourceReviews} from "./reviews";
import {reviewEvidenceGraph} from "../review-graph";
import {reportedFinancialView} from "../reported-financials";
import { accountingSchema,accountingTotals,periodBounds,revenueBridge,type StoredReport,type ManagementSnapshot,type KnowledgeGraph,type Metric } from "../model";
import { invoiceMetrics,type Invoice,type Student,type Enrollment,type ClassRow } from "../invoice-metrics";
import { ManagementInputError } from "../errors";
import { logDbError } from "@/lib/supabase/db-error";

export async function loadManagement(month:string):Promise<ManagementSnapshot> {
  const user=await managementAccess();
  const bounds=periodBounds(month),today=kstToday();
  if(month>today.slice(0,7))throw new ManagementInputError("미래 월은 아직 분석할 수 없습니다");
  const asOf=bounds.end<today?bounds.end:today,observedAt=new Date().toISOString();
  const db=createAdminClient(),tenant=user.tenantId;
  const [rawStudents,enrollments,classes,invoices,reportResult,syncResult,staff,intakes,reviewBatches]=await Promise.all([
    fetchAllPaged<Student>((f,t)=>db.from("students").select("id,makeedu_id,name,notes,school,grade,is_test,status,enrolled_at,withdrawn_at").eq("tenant_id",tenant).order("id").range(f,t)),
    fetchAllPaged<Enrollment>((f,t)=>db.from("enrollments").select("id,student_id,class_id,start_date,end_date,on_hold,is_transferred").eq("tenant_id",tenant).order("id").range(f,t)),
    fetchAllPaged<ClassRow>((f,t)=>db.from("classes").select("id,class_name,subject,teacher_id,is_makeup_pool").eq("tenant_id",tenant).order("id").range(f,t)),
    fetchAllPaged<Invoice>((f,t)=>db.from("invoices").select("id,student_id,period,amount_total,amount_paid,amount_discount,status,category,updated_at").eq("tenant_id",tenant).in("period",[month,bounds.previous]).order("id").range(f,t)),
    db.from("management_accounting_reports").select("id,version,document,updated_at").eq("tenant_id",tenant).order("period_end",{ascending:false}).limit(240),
    db.from("makeedu_sync_state").select("domain,synced_at,status,error").eq("tenant_id",tenant),
    fetchAllPaged<{id:string;display_name:string}>((f,t)=>db.from("users").select("id,display_name").eq("tenant_id",tenant).order("id").range(f,t)),
    fetchAllPaged<{id:string;student_id:string|null;consultation_path:string|null}>((f,t)=>db.from("enrollment_consultations").select("id,student_id,consultation_path").eq("tenant_id",tenant).gte("received_date",bounds.start).lte("received_date",asOf).order("id").range(f,t)),
    loadSourceReviews(month),
  ]);
  if(reportResult.error||syncResult.error){logDbError(reportResult.error??syncResult.error,"management.load");throw new ManagementInputError("경영 분석 자료를 불러오지 못했습니다");}
  const students=rawStudents.filter(s=>!s.is_test&&!isMergedStudent(s.notes));
  const ids=new Set(students.map(s=>s.id)),classMap=new Map(classes.filter(c=>!c.is_makeup_pool).map(c=>[c.id,c]));
  const validInvoices=invoices.filter(r=>ids.has(r.student_id));
  const current=invoiceMetrics(validInvoices.filter(r=>r.period===month)),previous=invoiceMetrics(validInvoices.filter(r=>r.period===bounds.previous));
  const active=enrollments.filter(e=>ids.has(e.student_id)&&classMap.has(e.class_id)&&e.start_date&&isEnrollmentActiveOn({startDate:e.start_date,endDate:e.end_date,onHold:e.on_hold,isTransferred:e.is_transferred},asOf));
  const byStudent=new Map<string,Set<string>>();
  for(const e of active){const set=byStudent.get(e.student_id)??new Set<string>();set.add(classMap.get(e.class_id)!.subject);byStudent.set(e.student_id,set);}
  const dual=[...byStudent.values()].filter(s=>s.has("english")&&s.has("math")).length;
  const withdrawal=students.filter(s=>s.withdrawn_at&&s.withdrawn_at>=bounds.start&&s.withdrawn_at<=asOf).length;
  const startingIds=new Set(enrollments.filter(e=>ids.has(e.student_id)&&classMap.has(e.class_id)&&e.start_date&&e.start_date<bounds.start&&isEnrollmentOnRosterOn({startDate:e.start_date,endDate:e.end_date,isTransferred:e.is_transferred},bounds.start)).map(e=>e.student_id));
  const cohortWithdrawals=students.filter(s=>startingIds.has(s.id)&&s.withdrawn_at&&s.withdrawn_at>=bounds.start&&s.withdrawn_at<=asOf).length;
  const reports:StoredReport[]=(reportResult.data??[]).map(r=>({id:r.id,version:r.version,updated_at:r.updated_at,document:accountingSchema.parse(r.document)}));
  // 같은 달에 손익계산서와 원장이 함께 있으면 손익계산서가 그 달의 손익 근거다(원장 집계는 늘 검토 대기).
  const inMonth=reports.filter(r=>r.document.start===bounds.start&&r.document.end===bounds.end);
  const monthly=inMonth.find(r=>r.document.sourceKind!=="ledger")??inMonth[0];
  const accounting=monthly?accountingTotals(monthly.document):null;
  const reportedFinancials=reportedFinancialView(reviewBatches,month);
  const metrics:Metric[]=[
    {id:"net_billed",label:"실청구액",value:current.net,unit:"원",definition:"청구월 기준 청구액−할인. 무효 청구 제외. 회계 매출·입금일 현금흐름과 구분",source:"MakeEdu → 에이와 청구 원장",href:`/billing?period=${month}`},
    {id:"collected",label:"해당 청구분 누적 수납",value:current.collected,unit:"원",definition:"선택 월 청구서의 현재까지 수납액. 이번 달 입금 합계가 아님",source:"MakeEdu → 에이와 청구 원장",href:"/billing/stats"},
    {id:"outstanding",label:"미수 잔액",value:current.outstanding,unit:"원",definition:"기존 수납관리의 완납·환불·무효 판정 적용",source:"에이와 수납관리",href:"/billing"},
    {id:"charged_students",label:"청구 학생 수",value:current.students,unit:"명",definition:"해당 월 양의 실청구가 있는 학생 중복 제거",source:"청구서·학생 ID",href:"/billing/stats"},
    {id:"per_student",label:"청구 학생당 실청구액",value:current.perStudent,unit:"원",definition:"실청구액÷청구 학생 수. 기준일 재원생당 매출과 구분",source:"실청구액·청구 학생 수",href:"/billing/stats"},
    {id:"active_students",label:"기준일 수강 학생",value:byStudent.size,unit:"명",definition:`${asOf}에 유효한 수강이 있는 학생. 보강용 반·현재 휴강 표시·테스트·병합 학생 제외. 과거 휴강 상태 이력은 미확인`,source:"에이와 학생·수강·반",href:"/students"},
    {id:"active_courses",label:"기준일 수강 건수",value:active.length,unit:"건",definition:"학생별 수강 관계 건수. 개설 반 수와 구분",source:"에이와 수강",href:"/timetable"},
    {id:"dual_ratio",label:"영어·수학 동시수강률",value:byStudent.size?dual/byStudent.size*100:null,unit:"%",definition:"기준일 영어·수학을 함께 듣는 학생÷기준일 수강 학생",source:"에이와 유효 수강 관계",href:"/students/stats"},
    {id:"withdrawals",label:"퇴원 기록 인원",value:withdrawal,unit:"명",definition:"학생 프로필 퇴원일 기준. 과목 종료·반 이동과 구분",source:"에이와 학생 퇴원일",href:"/withdrawals"},
    {id:"withdrawal_rate",label:"월초 수강 집단 퇴원율",value:startingIds.size?cohortWithdrawals/startingIds.size*100:null,unit:"%",definition:`월초 수강 집단 ${startingIds.size}명 중 ${asOf}까지 퇴원일이 기록된 ${cohortWithdrawals}명. 월중 신규생 제외; 과거 이력 완전성 검토 필요`,source:"에이와 수강·퇴원일",href:"/withdrawals"},
    {id:"operating_margin",label:reportedFinancials?"ECOUNT 기재 영업이익률":"월 영업이익률",value:reportedFinancials?reportedFinancials.margin:accounting?.margin??null,unit:"%",definition:reportedFinancials?"보고서 기재 영업손익÷보고서 매출. 사용자 확인 마감 월만 계산. 차량 원금·이자 혼합 비용이 포함된 조정 전 수치이며 채용 판단용 확정 손익이 아님":"같은 월의 대사 완료 회계 매출·영업비용이 필요. 누적 손익을 월별로 나누지 않음",source:"ECOUNT 손익계산서",href:`/dashboard/management?month=${month}#accounting`},
    {id:"labor_ratio",label:reportedFinancials?"보고서 매출 대비 인건비율":"월 인건비율",value:reportedFinancials?reportedFinancials.laborRatio:accounting?.laborRatio??null,unit:"%",definition:"급여·상여·퇴직·복리후생·4대보험 계정 순액÷같은 월 ECOUNT 매출. 임대·관리비 포함 전체 매출 기준. 미마감 월 보류",source:"ECOUNT 원장 계정 분류",href:`/dashboard/management?month=${month}#accounting`},
  ];
  const graph:KnowledgeGraph={schemaVersion:"aywa-management-v1",observedAt,nodes:[{id:`tenant:${tenant}`,type:"Academy",label:"학원",source:"에이와",href:"/dashboard"}],edges:[]};
  const nodeIds=new Set(graph.nodes.map(n=>n.id));
  const node=(id:string,type:string,label:string,source:string,href?:string)=>{if(!nodeIds.has(id)){nodeIds.add(id);graph.nodes.push({id,type,label,source,href});}};
  const edge=(from:string,relation:string,to:string,basis:string)=>graph.edges.push({from,relation,to,basis});
  for(const s of students){node(`student:${s.id}`,"Student",s.id,"에이와",`/students/${s.id}`);if(s.makeedu_id){node(`makeedu:${s.makeedu_id}`,"ExternalStudent",s.makeedu_id,"MakeEdu");edge(`student:${s.id}`,"identified_by",`makeedu:${s.makeedu_id}`,"저장된 makeedu_id 명시 연결");}}
  const staffIds=new Set(staff.map(t=>t.id));
  for(const c of classMap.values()){node(`class:${c.id}`,"Class",c.class_name,"에이와","/timetable");if(c.teacher_id&&staffIds.has(c.teacher_id))edge(`class:${c.id}`,"currently_taught_by",`teacher:${c.teacher_id}`,"현재 반 담당자. 과거 강사 평가에 소급 적용하지 않음");}
  const teachers=staff.filter(t=>classes.some(c=>c.teacher_id===t.id)).map(t=>{node(`teacher:${t.id}`,"Instructor",t.display_name,"에이와");return {id:t.id,label:t.display_name,students:new Set(active.filter(e=>classMap.get(e.class_id)?.teacher_id===t.id).map(e=>e.student_id)).size,courses:active.filter(e=>classMap.get(e.class_id)?.teacher_id===t.id).length};});
  for(const e of active)edge(`student:${e.student_id}`,"enrolled_in",`class:${e.class_id}`,`enrollments:${e.id}; ${e.start_date}~${e.end_date??"진행"}; 기준 ${asOf}`);
  for(const r of validInvoices){node(`invoice:${r.id}`,"Invoice",r.period,"MakeEdu/에이와","/billing");edge(`invoice:${r.id}`,"billed_to",`student:${r.student_id}`,"student_id");}
  for(const m of metrics){graph.nodes.push({id:`metric:${m.id}`,type:"Metric",label:m.label,source:m.source,href:m.href,value:m.value,period:month});edge(`tenant:${tenant}`,"measured_by",`metric:${m.id}`,m.definition);}
  edge("metric:per_student","derived_from","metric:net_billed","실청구액÷청구 학생 수");
  edge("metric:per_student","derived_from","metric:charged_students","실청구액÷청구 학생 수");
  for(const r of validInvoices.filter(r=>r.period===month&&r.status!=="void"))edge("metric:net_billed","derived_from",`invoice:${r.id}`,"선택 월의 무효를 제외한 청구액−할인 합계");
  for(const r of reports){
    node(`accounting:${r.id}`,r.document.sourceKind==="ledger"?"MonthlyLedger":"AccountingReport",`${r.document.start}~${r.document.end}`,r.document.sourceName,"/dashboard/management#accounting");
    edge(`tenant:${tenant}`,"has_accounting_report",`accounting:${r.id}`,`회사 범위 확인; 원본 해시 ${r.document.sourceHash}`);
    if(r.document.sourceKind==="ledger")for(const line of r.document.lines){
      const id=`ledger-account:${r.id}:${line.key}`;
      graph.nodes.push({id,type:"MonthlyAccountAmount",label:line.account,source:r.document.sourceName,value:line.amount,period:r.document.start.slice(0,7)});
      edge(`accounting:${r.id}`,"contains_account_amount",id,`${line.sourceCell}; 분류 ${line.category}; 검토 대기`);
    }
  }
  if(reportedFinancials){for(const id of ["operating_margin","labor_ratio"])edge(`metric:${id}`,reportedFinancials.closed?"derived_from":"awaits_close",`reported-financials:${reportedFinancials.batchId}`,"ECOUNT 보고서 분류 기준. 차량 원금·이자 조정 전; 채용 판단용 손익과 구분");}
  else if(monthly){for(const id of ["operating_margin","labor_ratio"])edge(`metric:${id}`,accounting?.ready?"derived_from":"awaits_reconciliation",`accounting:${monthly.id}`,accounting?.ready?"선택 월과 시작·종료일이 같은 대사 완료 보고서":"원장 또는 미확정 손익 자료; 확정 비율 계산에는 사용하지 않음");}
  const reviewGraph=reviewEvidenceGraph(tenant,reviewBatches);
  graph.nodes.push(...reviewGraph.nodes);graph.edges.push(...reviewGraph.edges);
  if(monthly&&reportedFinancials)edge(`reported-financials:${reportedFinancials.batchId}`,"reconciles_with",`accounting:${monthly.id}`,"같은 회사·월 원장 거래를 ECOUNT 보고서 표시 계정으로 재집계. 최초 원장 분류와 관리 손익 확정 상태는 변경하지 않음");
  const grouped=new Map<string,{label:string;inquiries:number;registered:number}>();
  for(const i of intakes){const label=i.consultation_path?.trim()||"유입경로 미기재",v=grouped.get(label)??{label,inquiries:0,registered:0};v.inquiries++;if(i.student_id&&ids.has(i.student_id))v.registered++;grouped.set(label,v);}
  return {month,asOf,observedAt,metrics,current,previous,bridge:revenueBridge(previous,current),reports,accounting,reportedFinancials,teachers,channels:[...grouped.values()],graph,reviewBatches,
    sources:[
      {name:"MakeEdu",state:"이관 자료 조회",updatedAt:(syncResult.data??[]).find(s=>s.domain==="invoices")?.synced_at??null,note:"연동 PC가 동기화한 청구 원장 기준. 표시 시각은 마지막으로 수집된 시각이며 실시간 동기화가 아님"},
      {name:"ECOUNT",state:reports.length?`${reports.length}개 기간 · 대사 검토 ${reports.filter(r=>!accountingTotals(r.document).ready).length}개`:"손익 파일 필요",updatedAt:reports[0]?.updated_at??null,note:"손익 엑셀·원장 CSV의 파일명·기간·해시·계정 금액 보관. 원장 내부 검산과 회계 마감을 구분하며 미확정 자료는 확정 수익률 계산에서 제외"},
      {name:"에이와 수업·상담",state:"현재 DB 조회",updatedAt:observedAt,note:"기존 업무 기록과 원본 ID로 연결"},
      {name:"Drive · Notion · Slack",state:"연결 범위 설정 필요",updatedAt:null,note:"대상 폴더·DB·채널을 확정한 후 읽기 전용 수집. 대화의 주장을 확인된 사실과 구분"},
    ]};
}
