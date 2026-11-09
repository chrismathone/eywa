import { z } from "zod";
const date = z.iso.date();
const text = z.string().trim().min(1).max(2000);
const amount = z.number().finite().min(0).max(1e12);
export const observerRoles = {deputy:"부원장",academic:"교무 담당",counsel:"상담 담당",desk:"데스크",assistant:"셔틀 보조",driver:"셔틀 기사",homeroom:"담임 강사"} as const;
export const signals = {
  attendance:"예정 수업 기준 출석률(%)", calls:"학부모 연결 상담 수(회)", shuttle:"편도 통학 시간(분)",
  study:"주간 자습실 이용(시간)", competitor:"경쟁 학원 언급(확인 1/없음 0)", mismatch:"등하원 불일치(건)",
  focus:"집중 저하 관찰(확인 1/없음 0)", retest:"재시험 실패(회)", complaint:"수업 불편 호소(확인 1/없음 0)",
  emotion:"감정·적응 관찰(메모)", friend:"친구 관계 관찰(메모)", identity:"외부 동일인 연결 검토 필요(1/0)",
} as const;
export type Signal = keyof typeof signals;
export const recordKinds = {observation:"현장 관찰",action:"후속 조치",okr:"OKR·목표",population:"학교·학년 전체 학생 수",balance:"재무상태",content:"홍보 콘텐츠 성과",staffing:"업무량·필요 인원"} as const;
export type RecordKind = keyof typeof recordKinds;
const base = {title:z.string().trim().min(2).max(160),date,evidence:text};
const observation = z.object({...base,kind:z.literal("observation"),studentId:z.uuid(),role:z.enum(Object.keys(observerRoles) as [keyof typeof observerRoles,...(keyof typeof observerRoles)[]]),signal:z.enum(Object.keys(signals) as [Signal,...Signal[]]),
  from:date,through:date,value:amount.nullable(),fact:text,interpretation:z.string().trim().max(2000),severity:z.number().int().min(1).max(3),state:z.enum(["submitted","confirmed","withdrawn"])});
const action = z.object({...base,kind:z.literal("action"),studentId:z.uuid().nullable(),ownerId:z.uuid(),due:date,originId:z.uuid().nullable(),ruleId:z.string().regex(/^R(10|[1-9])$/).nullable(),plan:text,result:z.string().trim().max(2000),state:z.enum(["open","done","cancelled"])});
const okr = z.object({...base,kind:z.literal("okr"),ownerId:z.uuid(),from:date,through:date,objective:text,keyResult:text,baseline:z.number().finite(),target:z.number().finite(),actual:z.number().finite().nullable(),direction:z.enum(["higher","lower"]),unit:z.string().trim().min(1).max(20),metricId:z.string().max(80),state:z.enum(["active","closed","cancelled"])});
const population = z.object({...base,kind:z.literal("population"),school:z.string().trim().min(1).max(100),grade:z.string().trim().min(1).max(30),total:z.number().int().positive().max(100000)});
const balance = z.object({...base,kind:z.literal("balance"),currentAssets:amount,currentLiabilities:amount,totalDebt:amount,equity:z.number().finite().min(-1e12).max(1e12)});
const content = z.object({...base,kind:z.literal("content"),campaignId:z.uuid().nullable(),url:z.url().regex(/^https?:\/\//),publishedOn:date,from:date,through:date,views:amount.nullable(),visits:amount.nullable(),inquiries:amount.nullable(),registrations:amount.nullable()});
const staffing = z.object({...base,kind:z.literal("staffing"),role:z.string().trim().min(1).max(100),from:date,through:date,requiredHours:amount,productiveHours:z.number().positive().max(1000),currentPeople:z.number().int().min(0).max(1000)});
export const knowledgeDocument = z.discriminatedUnion("kind",[observation,action,okr,population,balance,content,staffing]).superRefine((d,ctx)=>{
  const fail=(message:string)=>ctx.addIssue({code:"custom",message});
  if("from" in d&&d.from>d.through)fail("시작일이 종료일보다 늦습니다");
  if(d.kind==="observation"){
    if(d.through>d.date)fail("관찰 기간은 기록 기준일을 넘을 수 없습니다");
    if(!["emotion","friend"].includes(d.signal)&&d.value===null)fail("확인한 수치를 입력해 주세요. 미측정은 저장하지 않습니다");
    if(d.signal==="attendance"&&d.value!==null&&d.value>100)fail("출석률은 0~100%입니다");
    if(["competitor","focus","complaint","identity"].includes(d.signal)&&![0,1].includes(d.value??-1))fail("확인 1 또는 확인한 없음 0을 입력해 주세요");
    if(["calls","mismatch","retest"].includes(d.signal)&&!Number.isInteger(d.value))fail("횟수는 정수로 입력해 주세요");
  }
  if(d.kind==="action"&&d.state==="done"&&!d.result.trim())fail("완료에는 결과가 필요합니다");
  if(d.kind==="okr"&&((d.direction==="higher"&&d.target<=d.baseline)||(d.direction==="lower"&&d.target>=d.baseline)))fail("기준값과 목표값의 방향을 확인해 주세요");
  if(d.kind==="content"&&d.publishedOn>d.through)fail("게시일과 측정 기간을 확인해 주세요");
});
export type KnowledgeDocument = z.infer<typeof knowledgeDocument>;
export const saveRequest = z.object({id:z.uuid(),expectedVersion:z.number().int().min(0),document:knowledgeDocument});
export type KnowledgeRecord = {id:string;record_id:string;version:number;author_id:string;actor_id:string;recorded_at:string;document:KnowledgeDocument};
export function latestRecords(rows:KnowledgeRecord[]){const m=new Map<string,KnowledgeRecord>();for(const r of rows)if(!m.has(r.record_id)||m.get(r.record_id)!.version<r.version)m.set(r.record_id,r);return [...m.values()];}
export function validateTransition(old:KnowledgeRecord|undefined,next:KnowledgeDocument,actor:string,reviewer:boolean){
  if(old&&old.document.kind!==next.kind)throw Error("기록 유형은 변경할 수 없습니다");
  if(old&&old.author_id!==actor&&!reviewer)throw Error("본인 기록만 수정할 수 있습니다");
  if(next.kind==="observation"&&next.state==="confirmed"&&!reviewer)throw Error("확인된 관찰로 처리할 권한이 없습니다");
  if(!reviewer&&old?.document.kind==="observation"&&old.document.state==="confirmed"&&next.kind==="observation"&&next.state!=="submitted")throw Error("확인된 관찰 변경은 다시 검토 요청해 주세요");
  if(next.kind!=="observation"&&!reviewer)throw Error("경영 기록을 작성할 권한이 없습니다");
  if(next.kind==="observation"&&old?.document.kind==="observation"&&old.document.studentId!==next.studentId)throw Error("대상 학생은 변경할 수 없습니다");
}
export function okrProgress(d:Extract<KnowledgeDocument,{kind:"okr"}>,actual=d.actual){
  if(actual===null||d.target===d.baseline)return null;
  if((d.direction==="higher"&&d.target<d.baseline)||(d.direction==="lower"&&d.target>d.baseline))return null;
  return (actual-d.baseline)/(d.target-d.baseline)*100;
}
export function contextualResult(d:KnowledgeDocument,students?:{school:string|null;grade:string|null}[]){
  if(d.kind==="okr"){const p=okrProgress(d);return p===null?"실적 미측정":`기준 대비 목표 진행 ${p.toFixed(1)}% · ${d.state==="closed"?"마감":"진행 중"}`;}
  if(d.kind==="balance")return `유동비율 ${d.currentLiabilities>0?(100*d.currentAssets/d.currentLiabilities).toFixed(1)+"%":"분모 0 · 보류"} / 부채비율 ${d.equity>0?(100*d.totalDebt/d.equity).toFixed(1)+"%":"자본 0 이하 · 보류"}`;
  if(d.kind==="population"){if(!students)return `${d.school} ${d.grade} 전체 ${d.total}명 · 재원생 대비 비율은 통합 그래프의 운영 보완 자료에서 확인`;const n=students.filter(s=>s.school===d.school&&s.grade===d.grade).length;return `기준일 수강 ${n}명 / 학교 전체 ${d.total}명 · ${(100*n/d.total).toFixed(1)}% (현재 학적과 비교; 기준일 차이 확인)`;}
  if(d.kind==="staffing"){const n=d.requiredHours/d.productiveHours;return `필요 ${n.toFixed(2)}인분 · 정수 배치 ${Math.ceil(n)}명 · 현재 ${d.currentPeople}명 (시간대·자격 별도 검토)`;}
  if(d.kind==="content")return `조회 ${d.views??"미측정"} · 유입 ${d.visits??"미측정"} · 문의 ${d.inquiries??"미측정"} · 등록 ${d.registrations??"미측정"} (제출 집계, 캠페인 실적에 자동 합산하지 않음)`;
  if(d.kind==="observation")return `${signals[d.signal]} · ${d.value??"사실 메모"} · ${d.state==="confirmed"?"확인됨":d.state==="withdrawn"?"철회":"검토 요청"}`;
  return d.state==="done"?`완료 · ${d.result}`:d.state==="cancelled"?"취소":`기한 ${d.due} · ${d.plan}`;
}
