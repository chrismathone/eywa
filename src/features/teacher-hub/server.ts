import "server-only";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant,canWriteTenant } from "@/lib/auth/perm-matrix";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged,fetchAllPagedInChunks,fetchInChunks } from "@/lib/supabase/batch";
import { kstToday,kstDateOf,monthRange,shiftMonth } from "@/lib/date-kst";
import { getPortfolioGate } from "@/features/teacher-portfolio/server/queries";
import { loadTeacherPeriods } from "@/features/teacher-portfolio/server/store";
import { isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";
import { isMergedStudent } from "@/features/students/status/merged";
import { careDocumentSchema } from "@/features/student-care/model";
import { evidenceHref } from "@/features/student-care/model";
import { buildTeacherGraph,capacityRequestSchema,compareGrades,hasCurrentClassPeriod,metricView,monthSchema,promiseStatus,teacherInsights,type CapacityPlan,type HubClass,type HubEnrollment,type HubRecord,type HubStudent,type SourceCoverage,type TeacherHub } from "./model";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";

export class TeacherHubError extends Error { constructor(message:string,public status=400){super(message);} }
export async function teacherHubAccess(write=false){
  const [gate,user]=await Promise.all([getPortfolioGate(),getCurrentUser({teacherView:true})]);
  if(!gate||!user||user.tenantView||gate.tenantId!==user.tenantId||user.systemRole!=="master")throw new TeacherHubError("강사 분석을 열람할 권한이 없습니다",403);
  const modules=await Promise.all(["students","staff"].map(k=>canAccessTenant(user.systemRole,k as "students"|"staff")));
  if(modules.some(v=>!v))throw new TeacherHubError("학생·강사 자료를 열람할 권한이 없습니다",403);
  if(write){const readonly=await readonlyTeacherViewError();if(readonly||!await canWriteTenant(user.systemRole,"class_review"))throw new TeacherHubError("배정 기준을 변경할 권한이 없습니다",403);}
  return user;
}

type ClassRow={id:string;class_name:string;subject:string;teacher_id:string|null;closed_at:string|null;is_active:boolean;is_makeup_pool:boolean};
type ScheduleRow={id:string;class_id:string;teacher_id:string|null;valid_from:string|null;valid_to:string|null};
type DelegationRow={id:string;class_id:string;delegate_user_id:string;from_date:string;to_date:string};
type StudentRow={id:string;name:string;school:string|null;grade:string|null;is_test:boolean;notes:string|null};
const dbError=()=>new TeacherHubError("연결 자료를 불러오지 못했습니다. 다시 조회해 주세요.",503);

export async function loadTeacherHub(opts:{teacherId?:string;month?:string}={}):Promise<TeacherHub|null>{
  if(opts.teacherId&&!z.uuid().safeParse(opts.teacherId).success)throw new TeacherHubError("강사를 확인해 주세요",404);
  if(opts.month&&!monthSchema.safeParse(opts.month).success)throw new TeacherHubError("조회 월을 확인해 주세요");
  const user=await teacherHubAccess(),db=createAdminClient(),tenant=user.tenantId,today=kstToday(),observedAt=new Date().toISOString();
  if(opts.month&&opts.month>today.slice(0,7))throw new TeacherHubError("미래 월은 조회할 수 없습니다");
  // 강사 × 달 색인은 쌓이는 표 — 1,000행 상한이면 오래된 달의 강사가 목록에서 빠진다(B13) → 페이지로 전건(키 = 달·강사).
  const [index,classRows,schedules,delegations]=await Promise.all([
    fetchAllPaged<{teacher_id:string;month:string}>((a,b)=>db.from("teacher_portfolio_months").select("teacher_id,month").eq("tenant_id",tenant).order("month",{ascending:false}).order("teacher_id").range(a,b)).catch(()=>{throw dbError();}),
    fetchAllPaged<ClassRow>((a,b)=>db.from("classes").select("id,class_name,subject,teacher_id,closed_at,is_active,is_makeup_pool").eq("tenant_id",tenant).order("id").range(a,b)),
    fetchAllPaged<ScheduleRow>((a,b)=>db.from("class_schedules").select("id,class_id,teacher_id,valid_from,valid_to").eq("tenant_id",tenant).order("id").range(a,b)),
    fetchAllPaged<DelegationRow>((a,b)=>db.from("class_delegations").select("id,class_id,delegate_user_id,from_date,to_date").eq("tenant_id",tenant).is("revoked_at",null).lte("from_date",today).gte("to_date",today).order("id").range(a,b)),
  ]);
  const teacherIds=[...new Set([...index.map(r=>r.teacher_id),...classRows.map(c=>c.teacher_id),...schedules.map(s=>s.teacher_id),...delegations.map(d=>d.delegate_user_id)].filter((id):id is string=>!!id))];
  const people=await fetchInChunks<{id:string;display_name:string}>(teacherIds,ids=>db.from("users").select("id,display_name").eq("tenant_id",tenant).in("id",ids));
  const teachers=people.map(p=>({id:p.id,name:p.display_name})).sort((a,b)=>a.name.localeCompare(b.name,"ko"));
  if(!teachers.length)return null;
  const teacher=opts.teacherId?teachers.find(t=>t.id===opts.teacherId):teachers[0];
  if(!teacher)throw new TeacherHubError("강사를 찾을 수 없습니다",404);
  const months=[...new Set([today.slice(0,7),...index.filter(r=>r.teacher_id===teacher.id).map(r=>r.month)])].sort().reverse();
  const month=opts.month??index.find(r=>r.teacher_id===teacher.id)?.month??today.slice(0,7);
  if(!months.includes(month))months.push(month);
  const range=monthRange(month),end=range.to>today?today:range.to;
  const classes:HubClass[]=classRows.filter(c=>!c.is_makeup_pool&&c.is_active!==false&&(!c.closed_at||c.closed_at>=today)&&hasCurrentClassPeriod(schedules.filter(s=>s.class_id===c.id),today)).flatMap(c=>{
    const own=c.teacher_id===teacher.id,slots=schedules.filter(s=>s.class_id===c.id&&s.teacher_id===teacher.id&&hasCurrentClassPeriod([s],today)),delegated=delegations.filter(d=>d.class_id===c.id&&d.delegate_user_id===teacher.id);
    return own||slots.length||delegated.length?[{id:c.id,name:c.class_name,subject:c.subject,assignment:[own?"담임":"",slots.length?"교시 담당":"",delegated.length?"임시 위임":""].filter(Boolean).join(" · "),sourceIds:[...(own?[`classes:${c.id}`]:[]),...slots.map(s=>`class_schedules:${s.id}`),...delegated.map(d=>`class_delegations:${d.id}`)]}]:[];
  });
  const coverage:SourceCoverage[]=[];
  async function optional<T>(key:string,label:string,allowed:boolean,read:()=>Promise<T[]>,note:string,enabled=true):Promise<T[]>{
    if(!enabled)return [];
    if(!allowed){coverage.push({key,label,state:"forbidden",count:null,note:"원본 메뉴 열람 권한이 필요합니다"});return [];}
    try{const rows=await read();coverage.push({key,label,state:"ready",count:rows.length,note});return rows;}
    catch{coverage.push({key,label,state:"unavailable",count:null,note:"자료 조회 실패 · 0건으로 해석하지 않습니다"});return [];}
  }
  const [permissions,settings]=await Promise.all([Promise.all((["lesson_reports","consultations","documents","enrollment","ecs","mcs","newcomers"] as const).map(k=>canAccessTenant(user.systemRole,k))),getTenantSettings()]);
  const ecsOn=isModuleEnabled(settings.modules.disabled,"ecs"),mcsOn=isModuleEnabled(settings.modules.disabled,"mcs"),newcomersOn=isModuleEnabled(settings.modules.disabled,"newcomers");
  const proofPermissions={lesson_report:permissions[0],consultation:permissions[1],english_sheet:permissions[4]&&ecsOn,math_sheet:permissions[5]&&mcsOn};
  const [periods,rawEnrollments,reports,consults,careRows,sheetRows,capacityResult]=await Promise.all([
    loadTeacherPeriods(db,tenant,teacher.id,[month,shiftMonth(month,-1)]),
    fetchAllPagedInChunks<{id:string;student_id:string;class_id:string;start_date:string;end_date:string|null;on_hold:boolean;is_transferred:boolean}>(classes.map(c=>c.id),(ids,a,b)=>db.from("enrollments").select("id,student_id,class_id,start_date,end_date,on_hold,is_transferred").eq("tenant_id",tenant).in("class_id",ids).lte("start_date",today).or(`end_date.is.null,end_date.gte.${today}`).order("id").range(a,b)),
    optional("report","직접 작성 수업보고",permissions[0],()=>fetchAllPaged<{id:string;student_id:string;report_date:string;class_id:string|null}>((a,b)=>db.from("lesson_reports").select("id,student_id,report_date,class_id").eq("tenant_id",tenant).eq("created_by",teacher.id).is("revoked_at",null).gte("report_date",range.from).lte("report_date",end).order("id").range(a,b)),`${month} 수업일 기준 · 직접 작성 기록; 작성률은 저장 집계와 구분`),
    optional("consultation","직접 상담 기록",permissions[1],()=>fetchAllPaged<{id:string;student_id:string;consulted_at:string;follow_up_done:boolean|null}>((a,b)=>db.from("student_consultations").select("id,student_id,consulted_at,follow_up_done").eq("tenant_id",tenant).eq("counselor_id",teacher.id).gte("consulted_at",`${range.from}T00:00:00+09:00`).lte("consulted_at",`${end}T23:59:59.999+09:00`).order("id").range(a,b)),`${month} 상담일 기준 · 상담자ID 연결`),
    optional("promise","담당 약속",permissions[6],()=>fetchAllPaged<{id:string;student_id:string|null;due_on:string;state:string;document:unknown}>((a,b)=>db.from("student_care_commitments").select("id,student_id,due_on,state,document").eq("tenant_id",tenant).eq("owner_id",teacher.id).neq("state","cancelled").order("id").range(a,b)),"현재 담당 약속 전체 · 선택 월과 별도",newcomersOn),
    optional("sheet","마지막 수정한 영어 개별 시트",permissions[4],()=>fetchAllPaged<{id:string;class_id:string;student_id:string;mark_date:string;progress_note:string|null;score:string|null}>((a,b)=>db.from("class_sheet_student_marks").select("id,class_id,student_id,mark_date,progress_note,score").eq("tenant_id",tenant).eq("updated_by",teacher.id).gte("mark_date",range.from).lte("mark_date",end).order("id").range(a,b)),`${month} 기록일 기준 · 마지막 수정자 연결; 최초 작성자·당시 담당자와 다를 수 있음`,ecsOn),
    // 배정 상한(s2_0055) — 이번 달 것만. 표가 없거나 못 읽으면 '조회 확인 필요'로(0건으로 위장하지 않는다).
    db.from("teacher_capacity_plans").select("teacher_id,month,version,max_students,basis,updated_at").eq("tenant_id",tenant).eq("teacher_id",teacher.id).eq("month",today.slice(0,7)).maybeSingle(),
  ]);
  // 🔴 시안: 행사 접점(marketing_input_records)·업무문서(academy_work_records) 표가 이 DB에 없다.
  //    조회하지 않고 '연결 전'으로 밝힌다(0건으로 위장하지 않는다). 강사 이름에 예시 값을 붙이지도 않는다.
  coverage.push({key:"marketing",label:"작성한 행사 접점 근거",state:"unavailable",count:null,note:"행사 접점 기록 표가 연결되기 전입니다 · 0건으로 해석하지 않습니다"});
  coverage.push({key:"work",label:"제출·검토 업무문서",state:"unavailable",count:null,note:"업무문서 표가 연결되기 전입니다 · 0건으로 해석하지 않습니다"});
  const period=periods.find(p=>p.month===month)??null,previous=periods.find(p=>p.month===shiftMonth(month,-1))??null;
  const active=rawEnrollments.filter(e=>!e.on_hold&&isEnrollmentOnRosterOn({startDate:e.start_date,endDate:e.end_date,isTransferred:e.is_transferred},today));
  const relevantIds=[...new Set([...active.map(e=>e.student_id),...reports.map(r=>r.student_id),...sheetRows.map(r=>r.student_id),...consults.map(r=>r.student_id),...careRows.flatMap(r=>r.student_id?[r.student_id]:[]),...periods.flatMap(p=>p.items.flatMap(m=>m.detail.flatMap(r=>"studentId" in r&&typeof r.studentId==="string"?[r.studentId]:[])))])];
  const studentRows=await fetchInChunks<StudentRow>(relevantIds,ids=>db.from("students").select("id,name,school,grade,is_test,notes").eq("tenant_id",tenant).in("id",ids));
  const students:HubStudent[]=studentRows.filter(s=>!s.is_test&&!isMergedStudent(s.notes)).map(s=>({id:s.id,name:s.name,school:s.school,grade:s.grade}));
  const names=new Map(students.map(s=>[s.id,s.name]));
  const enrollments:HubEnrollment[]=active.filter(e=>names.has(e.student_id)).map(e=>({id:e.id,studentId:e.student_id,classId:e.class_id,start:e.start_date,end:e.end_date}));
  const records:HubRecord[]=[
    ...sheetRows.filter(r=>names.has(r.student_id)).map(r=>({id:r.id,kind:"sheet" as const,label:`${names.get(r.student_id)} 영어 개별 시트`,date:r.mark_date,href:`/ecs/${r.class_id}/month?month=${r.mark_date.slice(0,7)}`,source:"class_sheet_student_marks",studentId:r.student_id,state:"마지막 수정",note:[r.progress_note,r.score].filter(Boolean).join(" · ")||"출결·학습 칸 기록"})),
    ...reports.filter(r=>names.has(r.student_id)).map(r=>({id:r.id,kind:"report" as const,label:`${names.get(r.student_id)} 수업보고`,date:r.report_date,href:`/lesson_reports/${r.id}/print`,source:"lesson_reports",studentId:r.student_id})),
    ...consults.filter(r=>names.has(r.student_id)).map(r=>({id:r.id,kind:"consultation" as const,label:`${names.get(r.student_id)} 상담`,date:kstDateOf(r.consulted_at),href:`/consultations/${r.id}`,source:"student_consultations",studentId:r.student_id,state:r.follow_up_done?"후속 완료":"상담 기록"})),
    ...careRows.flatMap(r=>{const parsed=careDocumentSchema.safeParse(r.document);if(!parsed.success||!r.student_id||!names.has(r.student_id))return [];const doc=parsed.data;return [{id:r.id,kind:"promise" as const,label:doc.content.promise,date:r.due_on,href:`/students/${r.student_id}/care`,source:"student_care_commitments",studentId:r.student_id,state:promiseStatus(r.state,!!doc.acknowledged,r.due_on,today),note:doc.content.criterion,evidence:doc.evidence.filter(e=>e.revision===doc.revision&&proofPermissions[e.kind]).map(e=>({source:e.kind,id:e.recordId,href:evidenceHref(e.kind,e.recordId)}))}];}),
  ];
  records.sort((a,b)=>(b.date??"").localeCompare(a.date??"")||a.id.localeCompare(b.id));
  if(capacityResult.error)console.error("[teacher-hub] 배정 상한 조회 실패",capacityResult.error);
  const capacity=capacityResult.error?null:capacityResult.data as CapacityPlan|null;
  coverage.push({key:"capacity",label:"현재 월 배정 상한",state:capacityResult.error?"unavailable":"ready",count:capacity?1:0,note:capacityResult.error?"배정 상한을 불러오지 못했습니다 · 0건으로 해석하지 않습니다":capacity?`${capacity.month} 관리자가 입력한 기준 · 성과 자동 판정 아님`:"관리자가 적정 담당 학생 수와 근거를 입력하면 배정 여력을 계산합니다"});
  coverage.push({key:"portfolio",label:"월별 성과 집계",state:period?"ready":"unavailable",count:period?.items.length??null,note:period?`${period.closing.computedAt} 집계 · 지표별 근거는 최대 120행씩 그래프에 연결`:`${month} 집계가 없습니다. 직원 포트폴리오에서 지금 집계를 실행해 주세요.`});
  for(const c of coverage)if(["report","sheet","consultation","promise"].includes(c.key)&&c.state==="ready")c.count=records.filter(r=>r.kind===c.key).length;
  const invalidCare=careRows.filter(r=>!careDocumentSchema.safeParse(r.document).success).length;
  if(invalidCare)coverage.push({key:"invalid-care",label:"약속 문서 형식 확인",state:"unavailable",count:invalidCare,note:"형식이 맞지 않아 연결에서 제외된 원본 약속입니다. 원본 보정이 필요합니다."});
  const metrics=(period?.items??[]).filter(m=>!m.off).map(m=>metricView(m,month));
  const graph=buildTeacherGraph({tenant,teacher,month,today,observedAt,classes,students,enrollments,records,period,capacity,coverage});
  return {teacher,teachers,month,months,today,computedAt:period?.closing.computedAt??null,closing:period?.closing.closedAt?"마감 저장":"진행 중 / 집계 전",classes,students,enrollments,records,metrics,coverage,capacity,capacityReady:!capacityResult.error,canWrite:await canWriteTenant(user.systemRole,"class_review"),graph,grades:compareGrades(period,previous,new Set(names.keys())),insights:teacherInsights(metrics,records.filter(r=>r.kind==="promise"&&r.state?.startsWith("기한 경과")).length,capacity,new Set(enrollments.map(e=>e.studentId)).size)};
}

/** 이번 달 배정 상한 저장(s2_0055 save_teacher_capacity_plan — 원장 · 같은 요청 번호는 한 번만 · 버전 비교). 성과 판정·자동 배정이 아니다. */
export async function saveTeacherCapacity(raw:unknown){
  const input=capacityRequestSchema.parse(raw),user=await teacherHubAccess(true);
  if(input.month!==kstToday().slice(0,7))throw new TeacherHubError("현재 월의 배정 기준만 변경할 수 있습니다");
  const db=createAdminClient();
  const {data:person,error}=await db.from("users").select("id").eq("tenant_id",user.tenantId).eq("id",input.teacherId).maybeSingle();
  if(error||!person)throw new TeacherHubError("담당 강사를 확인해 주세요",404);
  const {data,error:saveError}=await db.rpc("save_teacher_capacity_plan",{p_tenant:user.tenantId,p_actor:user.id,p_teacher:input.teacherId,p_month:input.month,p_expected:input.version,p_request:input.requestId,p_max:input.maxStudents,p_basis:input.basis});
  if(saveError){
    const conflict=saveError.message.includes("version_conflict")||saveError.message.includes("request_conflict");
    if(!conflict)console.error("[teacher-hub] 배정 기준 저장 실패",saveError);
    throw new TeacherHubError(conflict?"다른 변경이 있습니다. 새로고침 후 확인해 주세요.":"배정 기준을 저장하지 못했습니다",conflict?409:400);
  }
  return data as {version:number;month:string};
}
