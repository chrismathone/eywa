import "server-only";
import { getFamilyLoyalty } from "./family-loyalty";
import { getLiveContext } from "./live-context";
import { getContributionGate } from "./access";
import { getContributionReadIdentity } from "./identity-query";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { effectiveAttendanceRecords, type EffectiveAttendanceRecord } from "@/features/attendance/effective-records";
import { isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";
import { isLiveTuition, lessonPaid, type HistoryInvoice } from "@/features/students/stats/history-aywa";
import { resolveObservations, validMonth, type Observation, type FactorRecord } from "../model/factors";

type Invoice=HistoryInvoice&{id:string;payment_method:string|null};
type Enrollment={id:string;class_id:string;start_date:string;end_date:string|null;is_transferred:boolean;on_hold:boolean};
type Attendance=EffectiveAttendanceRecord&{status:string;homework_required:boolean|null;homework_done:boolean|null};
type Grade={id:string;subject:string;score:number|null;max_score:number|null;taken_on:string;exam_name:string};
export function monthWindow(month:string,today:string) {
  if(!validMonth(month)||month>today.slice(0,7))throw new Error("조회할 월을 확인해 주세요.");
  const [y,m]=month.split("-").map(Number);
  const end=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
  return {asOf:end<today?end:today,six:new Date(Date.UTC(y,m-6,1)).toISOString().slice(0,10),year:new Date(Date.UTC(y,m-12,1)).toISOString().slice(0,10)};
}
export async function getFactorWorkspace(studentId:string,requestedMonth?:string) {
  const c=await getLiveContext(studentId);const gate=await getContributionGate();
  if(!c||!gate)return null;
  const month=validMonth(requestedMonth)&&requestedMonth<=c.today.slice(0,7)?requestedMonth:c.today.slice(0,7);
  const {asOf,six,year}=monthWindow(month,c.today);
  const {data:student,error}=await c.db.from("students").select("id,name,enrolled_at,withdrawn_at,school,grade").eq("tenant_id",c.tenant).eq("id",studentId).single();
  if(error||!student)return null;
  const auto:Observation[]=[];const warnings:string[]=[];
  const identity=await getContributionReadIdentity();
  const sourceIds=identity.ids.filter(id=>identity.resolve(id)===studentId&&(c.readable===null||c.readable.has(id)));
  function put(factorId:string,value:number|string,evidence:string,table:string,ids:string[],state:Observation["state"]="measured",tab="overview") {
    auto.push({factorId,value,evidence,state,source:"auto",refs:ids.map(id=>({table,id})),href:`/students/${studentId}?tab=${tab}`,version:0});
  }
  // Isolate source failures; never turn failed reads or unavailable denominators into zero.
  async function read(label:string,run:()=>Promise<void>){try{await run();}catch{warnings.push(`${label} 자료를 불러오지 못했습니다. 해당 자동값은 미측정으로 표시합니다.`);}}
  await Promise.all([
    read("가족 재원",async()=>{
      // Current relations and hold flags cannot reconstruct historical family enrollment.
      if(month!==c.today.slice(0,7))return;
      const family=await getFamilyLoyalty(studentId);
      if(family.state!=="ready")return;
      const value=family.selfActive?family.activeSiblings!:0;
      put("F13",value,`${family.asOf} 기준 본인 포함 ${family.activeCount}명 동시 재원. ${family.members.map(m=>`${m.name}(${m.active?"재원·수강 확인":"현재 재원 가산 제외"})`).join(" · ")}. 동일 보호자 휴대폰/직접 연결, 수동 제외 우선. 미연결 가족은 학생 정보에서 보완. 현재 가족 자료이며 과거 월로 소급하지 않습니다.`,"students",family.members.map(m=>m.id));
    }),
    read("수납",async()=>{
      const rows=await fetchAllPagedInChunks<Invoice>(sourceIds,(ids,a,b)=>c.db.from("invoices").select("id,student_id,period,status,category,line_items,amount_paid,payment_method").eq("tenant_id",c.tenant).in("student_id",ids).eq("period",month).order("id").range(a,b));
      const tuition=rows.filter(isLiveTuition);
      if(tuition.length){
        const paid=tuition.reduce((s,r)=>{const p=lessonPaid(r.line_items,r.amount_paid);return s+p.general+p.eie;},0);
        put("F01",paid,`${month} 청구 ${tuition.length}건의 수업료 순수납. 조회 시점의 납부·환불 상태이며 결제월 현금 매출과 다릅니다.`,"invoices",tuition.map(r=>r.id),"measured","billing");
      }
      const methods=[...new Set(rows.filter(r=>r.status!=="void"&&Number(r.amount_paid)>0).map(r=>r.payment_method).filter(Boolean))];
      if(methods.length)put("F39",methods.join(" · "),`${month} 청구분에서 확인된 결제 수단. 자동 결제 계약 여부는 별도 확인.`,"invoices",rows.map(r=>r.id),"measured","billing");
    }),
    read("수강",async()=>{
      const rows=await fetchAllPagedInChunks<Enrollment>(sourceIds,(ids,a,b)=>c.db.from("enrollments").select("id,class_id,start_date,end_date,is_transferred,on_hold").eq("tenant_id",c.tenant).in("student_id",ids).lte("start_date",asOf).or(`end_date.is.null,end_date.gte.${asOf}`).order("id").range(a,b));
      const live=rows.filter(r=>isEnrollmentOnRosterOn({startDate:r.start_date,endDate:r.end_date,isTransferred:r.is_transferred},asOf));
      const classes=await fetchAllPagedInChunks<{id:string;subject:string|null;is_makeup_pool:boolean;closed_at:string|null}>([...new Set(live.map(r=>r.class_id))],(ids,a,b)=>c.db.from("classes").select("id,subject,is_makeup_pool,closed_at").eq("tenant_id",c.tenant).in("id",ids).order("id").range(a,b));
      const visible=classes.filter(r=>!r.is_makeup_pool&&(!r.closed_at||r.closed_at>=asOf)&&live.some(e=>e.class_id===r.id&&!e.on_hold));
      // on_hold is a current flag, not a historical interval: historical months need confirmation.
      if(live.length&&classes.length===new Set(live.map(r=>r.class_id)).size&&visible.every(r=>r.subject))
        put("F02",new Set(visible.map(r=>r.subject!.trim())).size,`${asOf} 수강 기간에 포함된 과목. 휴원 상태는 현재 저장값 기준.`,"enrollments",live.map(r=>r.id),month===c.today.slice(0,7)?"measured":"partial","classes");
      const holds=live.filter(r=>r.on_hold);
      if(month===c.today.slice(0,7)&&holds.length)put("F40",`현재 휴원 처리된 수강 ${holds.length}건`,"과거 휴원 횟수·기간 전체를 뜻하지 않습니다.","enrollments",holds.map(r=>r.id),"measured","classes");
    }),
    read("출결·과제",async()=>{
      if(!c.attendance)return;
      const rows=await fetchAllPagedInChunks<Attendance>(sourceIds,(ids,a,b)=>c.db.from("attendance_records").select("id,student_id,class_id,session_date,slot_start,recorded_at,status,homework_required,homework_done").eq("tenant_id",c.tenant).in("student_id",ids).gte("session_date",six).lte("session_date",asOf).order("id").range(a,b));
      const current=effectiveAttendanceRecords(rows);
      const counted=current.filter(r=>["present","late","absent","early_leave"].includes(r.status));
      if(counted.length){const n=counted.filter(r=>r.status!=="absent").length;
        put("F08",Math.round(n/counted.length*1000)/10,`${six}~${asOf}: 출석·지각·조퇴 ${n} / 출결 기록 ${counted.length}교시. 보강 제외. 전체 예정 교시와 대사되지 않아 점수 반영 전 확인 필요.`,"attendance_records",counted.map(r=>r.id),"partial","attendance");}
      const required=current.filter(r=>r.homework_required===true);
      if(required.length){const n=required.filter(r=>r.homework_done===true).length;
        put("F09",Math.round(n/required.length*1000)/10,`${six}~${asOf}: 완료 ${n} / 과제 체크 ${required.length}건. 출결표 외 과제 및 미입력 확인 후 확정해 주세요.`,"attendance_records",required.map(r=>r.id),"partial","attendance");}
    }),
    read("성적",async()=>{
      const rows=await fetchAllPagedInChunks<Grade>(sourceIds,(ids,a,b)=>c.db.from("student_grades").select("id,subject,score,max_score,taken_on,exam_name").eq("tenant_id",c.tenant).in("student_id",ids).gte("taken_on",year).lte("taken_on",asOf).order("taken_on",{ascending:false}).order("id").range(a,b));
      const grades=rows.filter(r=>r.score!==null&&Number(r.max_score)>0).sort((a,b)=>b.taken_on.localeCompare(a.taken_on)||b.id.localeCompare(a.id));
      if(grades.length)put("F35",grades.slice(0,6).map(r=>`${r.taken_on} ${r.subject} ${r.exam_name}: ${r.score}/${r.max_score}`).join("\n"),`최근 12개월 성적 ${grades.length}건 중 최근 6건. 동일 시험 조건인지 확인 후 추이를 판단하세요.`,"student_grades",grades.map(r=>r.id),"measured","grades");
    }),
  ]);
  if(student.enrolled_at&&student.enrolled_at<=asOf){
    const end=student.withdrawn_at&&student.withdrawn_at<asOf?student.withdrawn_at:asOf;
    if(end>=student.enrolled_at)put("F06",Math.round((Date.parse(end)-Date.parse(student.enrolled_at))/86400000/30.4375*10)/10,`${student.enrolled_at}~${end}, 1개월=365.25/12일. 휴원 차감 전 경과 기간.`,"students",[studentId]);
  }
  if(student.school&&month===c.today.slice(0,7))put("F42",`${student.school} ${student.grade??""}`.trim(),"현재 학생 기본정보의 학교·학년. 생활권·학군 수요는 별도 기록.","students",[studentId]);
  let records:FactorRecord[]=[];let storageReady=true;
  try{records=await fetchAllPaged<FactorRecord>((a,b)=>createAdminClient().from("student_contribution_factor_records").select("id,factor_id,value,state,evidence,version,recorded_at,actor_id").eq("tenant_id",c.tenant).eq("student_id",studentId).eq("month",month).order("id").range(a,b));}
  catch{storageReady=false;warnings.push("팩터 입력 기록을 불러오지 못했습니다. 저장된 값의 누락을 막기 위해 입력·종합 판정을 잠시 보류합니다.");}
  const actorIds=[...new Set(records.map(r=>r.actor_id))];
  const actors=await fetchAllPagedInChunks<{id:string;display_name:string}>(actorIds,(ids,a,b)=>c.db.from("users").select("id,display_name").eq("tenant_id",c.tenant).in("id",ids).order("id").range(a,b));
  const names=Object.fromEntries(actors.map(r=>[r.id,r.display_name]));
  return {student:{id:student.id,name:student.name},month,asOf,today:c.today,canWrite:gate.canWrite&&storageReady,storageReady,warnings,
    observations:resolveObservations(auto,records).map(o=>({...o,actor:o.actor?names[o.actor]??"담당자":undefined})),
    history:records.sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at)).map(r=>({...r,actor:names[r.actor_id]??"담당자"}))};
}
export type FactorWorkspace=NonNullable<Awaited<ReturnType<typeof getFactorWorkspace>>>;
