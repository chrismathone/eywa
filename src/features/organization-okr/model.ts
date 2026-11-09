import { z } from "zod";
import type { SourceGraph } from "@/features/academy-knowledge/graph";

const text = z.string().trim().max(2000);
const date = z.iso.date();
export const sources = { manual: "직접 측정 · 근거 입력", tasks: "이 KR의 실행 과제 완료율", work: "담당자가 제출한 업무 문서 수", lessons: "담당자가 작성한 수업보고서 수" } as const;
export const scopes = { organization: "조직", team: "팀", individual: "개인" } as const;
export const states = { draft: "기획 중", active: "실행 중", closed: "회고 완료", archived: "보관" } as const;
export const confidenceLabels = { ontrack: "순조로움", risk: "조정 필요", blocked: "지원 필요" } as const;
export const evidenceSchema = z.object({ kind:z.enum(["work","lessons"]), id:z.uuid(), version:z.number().int().positive().nullable(), date, label:z.string().max(250), href:z.string().startsWith("/").max(300) });
export type Evidence = z.infer<typeof evidenceSchema>;
export const krSchema = z.object({
  id:z.uuid(), title:z.string().trim().min(2).max(200), definition:text, population:text, guardrail:text,
  baseline:z.number().finite().nullable(), target:z.number().finite().nullable(), actual:z.number().finite().nullable(),
  direction:z.enum(["higher","lower"]), unit:z.string().trim().min(1).max(20), source:z.enum(["manual","tasks","work","lessons"]),
  measuredOn:date.nullable(), evidence:text, refs:z.array(evidenceSchema).max(100),
});
export const taskSchema=z.object({id:z.uuid(),krId:z.uuid(),title:z.string().trim().min(2).max(250),due:date,status:z.enum(["todo","doing","blocked","done"]),result:text});
export const documentSchema=z.object({
  scope:z.enum(["organization","team","individual"]),ownerId:z.uuid(),parentId:z.uuid().nullable(),team:z.string().trim().max(80),
  title:z.string().trim().min(2).max(200),why:text,from:date,through:date,state:z.enum(["draft","active","closed","archived"]),
  krs:z.array(krSchema).min(1).max(8),tasks:z.array(taskSchema).max(40),
  checkin:z.object({date:date.nullable(),confidence:z.enum(["ontrack","risk","blocked"]),result:text,learning:text,help:text,next:text}),
}).superRefine((d,ctx)=>{
  const fail=(message:string)=>ctx.addIssue({code:"custom",message});
  if(d.through<d.from)fail("목표 종료일을 시작일 이후로 입력해 주세요");
  if(d.scope==="organization"&&d.parentId)fail("조직 목표에는 상위 목표를 연결하지 않습니다");
  if(d.scope==="team"&&!d.team)fail("팀 이름을 입력해 주세요");
  if(new Set(d.krs.map(k=>k.id)).size!==d.krs.length||new Set(d.tasks.map(t=>t.id)).size!==d.tasks.length)fail("중복 항목을 확인해 주세요");
  for(const k of d.krs){
    if(k.baseline!==null&&k.target!==null&&(k.direction==="higher"?k.target<=k.baseline:k.target>=k.baseline))fail("목표값은 개선 방향에 맞게 기준값과 다르게 입력해 주세요");
    if(k.actual!==null&&(!k.measuredOn||!k.evidence))fail("실적에는 측정일과 확인 근거가 필요합니다");
    if(d.state==="active"&&(k.baseline===null||k.target===null||!k.definition||!k.population||!k.guardrail))fail("실행 전 각 KR의 기준·목표·산식·대상·품질 기준을 입력해 주세요");
    if(k.source==="tasks"&&(k.unit!=="%"||(k.baseline!==null&&(k.baseline<0||k.baseline>100))||(k.target!==null&&(k.target<0||k.target>100))))fail("과제 완료율은 0~100%로 설정해 주세요");
    if((k.source==="work"||k.source==="lessons")&&k.unit!=="건")fail("자동 집계 건수의 단위는 ‘건’입니다");
  }
  for(const t of d.tasks){if(!d.krs.some(k=>k.id===t.krId))fail("실행 과제를 핵심결과에 연결해 주세요");if(t.due<d.from||t.due>d.through)fail("과제 기한은 목표 기간 안으로 설정해 주세요");if(t.status==="done"&&!t.result)fail("완료한 과제에는 처리 결과를 남겨 주세요");}
  if((d.checkin.result||d.checkin.learning||d.checkin.help||d.checkin.next)&&!d.checkin.date)fail("주간 점검 내용을 남길 때에는 점검일도 입력해 주세요");
  if(d.checkin.date&&(!d.checkin.result||!d.checkin.next))fail("주간 점검에는 결과와 다음 실행 계획을 적어 주세요");
  if(d.checkin.confidence==="blocked"&&!d.checkin.help)fail("필요한 지원을 적어 주세요");
  if(d.state==="closed"&&(!d.checkin.date||!d.checkin.learning))fail("마감 전 점검일과 회고를 작성해 주세요");
});
export type OkrDocument=z.infer<typeof documentSchema>;
export type KR=z.infer<typeof krSchema>;
export type Review={note:string;verdict:"acknowledged"|"revise"|"support";reviewerId:string;at:string;version:number};
export type OkrRecord={id:string;owner_id:string;version:number;document:OkrDocument;review:Review|null;updated_at:string};
export const requestSchema=z.object({id:z.uuid(),version:z.number().int().nonnegative(),action:z.enum(["save","review"]),document:documentSchema.optional(),note:text.optional(),verdict:z.enum(["acknowledged","revise","support"]).optional()});
export function progress(k:KR):number|null {if(k.baseline===null||k.target===null||k.actual===null)return null;const span=k.target-k.baseline;if(!span||(k.direction==="higher"?span<0:span>0))return null;return Math.round((k.actual-k.baseline)/span*1000)/10;}
export function validateGoal(d:OkrDocument,today:string,parent?:Pick<OkrRecord,"id"|"document">){
  documentSchema.parse(d);
  if(d.checkin.date&&(d.checkin.date>today||d.checkin.date<d.from||d.checkin.date>d.through))throw Error("점검일은 목표 기간 안의 실제 날짜로 입력해 주세요");
  if(d.krs.some(k=>k.measuredOn&&(k.measuredOn>today||k.measuredOn<d.from||k.measuredOn>d.through)))throw Error("측정일은 목표 기간 안의 실제 날짜로 입력해 주세요");
  if(d.parentId){const rank={organization:0,team:1,individual:2};if(!parent||parent.document.state!=="active"||rank[parent.document.scope]>=rank[d.scope]||d.from<parent.document.from||d.through>parent.document.through)throw Error("실행 중인 상위 목표와 기간을 확인해 주세요");}
}
export function assertSave(old:OkrRecord|null,d:OkrDocument,actor:string,manager:boolean){
  if(old&&(old.owner_id!==actor||d.ownerId!==old.owner_id||d.scope!==old.document.scope))throw Error("담당자 본인이 작성하며, 목표의 담당자·범위는 변경할 수 없습니다");
  if(!old&&d.ownerId!==actor)throw Error("자신의 목표로 작성해 주세요");
  if(d.scope!=="individual"&&!manager)throw Error("조직·팀 목표를 관리할 권한이 없습니다");
}
export function attention(d:OkrDocument,today:string){const result:string[]=[];
  if(d.krs.some(k=>k.baseline===null||k.target===null))result.push("기준·목표 설정");
  if(d.state==="active"&&d.krs.some(k=>k.actual===null))result.push("미측정 KR");
  if(d.tasks.some(t=>t.status!=="done"&&t.due<today))result.push("과제 기한 경과");
  if(d.checkin.confidence==="blocked")result.push("지원 요청");
  const cutoff=new Date(`${today}T00:00:00Z`);cutoff.setUTCDate(cutoff.getUTCDate()-7);
  if(d.state==="active"&&(!d.checkin.date||d.checkin.date<cutoff.toISOString().slice(0,10)))result.push("주간 점검 필요");
  return result;
}
export const templates=[
  {name:"강사 · 학습과 정착",title:"담당 학생이 약속한 학습 목표를 달성하도록 돕는다",kr:"상담에서 합의한 진도 약속의 기한 내 이행률",definition:"기한 내 증거 확인된 약속 ÷ 해당 기간 만기 약속 × 100",population:"내 담당 학생의 해당 기간 만기 약속",guardrail:"진도만 앞당기지 않고 이해도·과제 수행을 함께 확인",unit:"%"},
  {name:"상담 · 신입생 90일",title:"신입생의 요구와 약속을 놓치지 않고 정착을 돕는다",kr:"30·60·90일 점검의 기한 내 완료율",definition:"기한 내 결과까지 기록한 필수 점검 ÷ 해당 기간 도래한 필수 점검 × 100",population:"내 담당 신입생의 필수 점검",guardrail:"통화 횟수와 별도로 미해결 요구·퇴원 사유를 확인",unit:"%"},
  {name:"홍보 · 유입과 등록",title:"근거가 확인되는 신규 등록을 만든다",kr:"캠페인 유입 중 실제 등록 전환율",definition:"유입 경로가 확인된 실제 등록 인원 ÷ 중복 제거한 해당 캠페인 신규 문의 인원 × 100",population:"동일 캠페인·동일 관찰 기간의 신규 문의",guardrail:"비용·환불·90일 재원 유지율을 함께 확인",unit:"%"},
  {name:"경영지원 · 정확한 운영",title:"담당 업무의 누락과 재작업을 줄인다",kr:"필수 업무의 기한 내 정확한 처리율",definition:"기한 내 검토 완료된 업무 ÷ 해당 기간 만기 업무 × 100",population:"내 담당 정기 업무",guardrail:"완료 표시만 하지 않고 검토·증빙·재작업 여부 확인",unit:"%"},
] as const;
export function blankGoal(ownerId:string,today:string,template:(typeof templates)[number]=templates[0]):OkrDocument{return {scope:"individual",ownerId,parentId:null,team:"",title:template.title,why:"",from:today,through:`${today.slice(0,4)}-12-31`,state:"draft",krs:[{id:crypto.randomUUID(),title:template.kr,definition:template.definition,population:template.population,guardrail:template.guardrail,baseline:null,target:null,actual:null,direction:"higher",unit:template.unit,source:"manual",measuredOn:null,evidence:"",refs:[]}],tasks:[],checkin:{date:null,confidence:"ontrack",result:"",learning:"",help:"",next:""}};}
export function okrGraph(rows:OkrRecord[],names:Record<string,string>):SourceGraph{
 const g:SourceGraph={nodes:[],edges:[]};const node=(n:SourceGraph["nodes"][number])=>{if(!g.nodes.some(x=>x.id===n.id))g.nodes.push(n);};
 for(const r of rows){const d=r.document,goal=`okr:${r.id}`,staff=`staff:${d.ownerId}`;node({id:staff,type:"Staff",label:names[d.ownerId]??"담당자"});node({id:goal,type:"Objective",label:d.title,href:`/organization/okr?goal=${r.id}`,state:d.state,period:`${d.from}~${d.through}`,attributes:{version:r.version}});g.edges.push({from:goal,to:staff,relation:"ASSIGNED_TO",basis:"목표 담당자",asOf:r.updated_at});
 if(d.parentId&&rows.some(x=>x.id===d.parentId))g.edges.push({from:goal,to:`okr:${d.parentId}`,relation:"ALIGNS_WITH",basis:"작성자가 연결한 상위 목표 · 인과관계 증명 아님"});
 for(const k of d.krs){const id=`okr_kr:${r.id}:${k.id}`;node({id,type:"Metric",label:k.title,value:k.actual,period:`${d.from}~${d.through}`,detail:k.definition,attributes:{baseline:k.baseline,target:k.target,unit:k.unit,progress:progress(k),measuredOn:k.measuredOn,source:k.source,evidence:k.evidence,guardrail:k.guardrail}});g.edges.push({from:goal,to:id,relation:"MEASURED_BY",basis:"합의한 핵심결과"});
 for(const e of k.refs){const evidence=`${e.kind==="work"?"academy_work_records":"lesson_reports"}:${e.id}`;node({id:evidence,type:e.kind==="lessons"?"LearningRecord":"Evidence",label:e.label,href:e.href,period:e.date,attributes:{version:e.version}});g.edges.push({from:id,to:evidence,relation:"EVIDENCED_BY",basis:"집계 시점의 원본 기록 참조",asOf:k.measuredOn??"",evidence:[evidence]});}}
 for(const t of d.tasks){const id=`okr_task:${r.id}:${t.id}`;node({id,type:"Action",label:t.title,state:t.status,detail:t.result,period:t.due});g.edges.push({from:id,to:`okr_kr:${r.id}:${t.krId}`,relation:"CONTRIBUTES_TO",basis:"담당자의 실행 계획"},{from:id,to:staff,relation:"ASSIGNED_TO",basis:"목표 담당자가 수행"});}
 if(d.checkin.date){const id=`okr_checkin:${r.id}:${r.version}`;node({id,type:"Observation",label:`${d.checkin.date} 주간 점검`,detail:d.checkin.result,attributes:{help:d.checkin.help,next:d.checkin.next,confidence:d.checkin.confidence}});g.edges.push({from:goal,to:id,relation:"REVIEWED_THROUGH",basis:"담당자 자기 점검"});}
 if(r.review){const id=`okr_review:${r.id}:${r.review.version}`,reviewer=`staff:${r.review.reviewerId}`;node({id:reviewer,type:"Staff",label:names[r.review.reviewerId]??"검토자"});node({id,type:"Observation",label:"관리자 피드백",detail:r.review.note});g.edges.push({from:goal,to:id,relation:"REVIEWED_THROUGH",basis:`v${r.review.version}에 대한 피드백`},{from:reviewer,to:id,relation:"OBSERVED",basis:"피드백 작성자"});}}
 return g;
}
