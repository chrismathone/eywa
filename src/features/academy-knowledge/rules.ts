import type {KnowledgeRecord, Signal} from "./records";
export type Fact = {value:number;from:string;through:string;evidence:string[];complete:boolean};
export type Facts = Partial<Record<Signal|"events"|"referrals"|"highRevenue"|"highChurn"|"roles",Fact>>;
type Condition={key:keyof Facts;op:"lt"|"gt"|"gte"|"eq";value:number};
export const rules:{id:string;title:string;scope:"student"|"teacher";conditions:Condition[];mode?:"any";action:string}[]=[
  {id:"R1",title:"매출 기여와 퇴원 동시 점검",scope:"teacher",conditions:[{key:"highRevenue",op:"eq",value:1},{key:"highChurn",op:"eq",value:1}],action:"동일 기간·담당 집단을 확인하고 학생 배정·소통 지원을 검토"},
  {id:"R2",title:"출석 저하와 상담 공백",scope:"student",conditions:[{key:"attendance",op:"lt",value:80},{key:"calls",op:"eq",value:0}],action:"48시간 내 보호자 상담을 계획하고 연결 결과 기록"},
  {id:"R3",title:"지속 참여·추천 가정",scope:"student",mode:"any",conditions:[{key:"events",op:"gte",value:2},{key:"referrals",op:"gte",value:1}],action:"참여 이유를 확인하고 만족 경험을 기록"},
  {id:"R4",title:"통학 부담과 자습 이용",scope:"student",conditions:[{key:"shuttle",op:"gt",value:35},{key:"study",op:"lt",value:1}],action:"통학 동선·시간표 지원 가능성 확인"},
  {id:"R5",title:"경쟁 학원 언급과 소통 공백",scope:"student",conditions:[{key:"competitor",op:"eq",value:1},{key:"calls",op:"eq",value:0}],action:"보호자의 요구를 직접 확인하고 상담 약속 기록"},
  {id:"R6",title:"등하원 변화와 집중 저하",scope:"student",conditions:[{key:"mismatch",op:"gte",value:1},{key:"focus",op:"eq",value:1}],action:"관찰 시점과 맥락을 대조하고 학생 적응 상담"},
  {id:"R7",title:"반복 등하원 불일치 확인",scope:"student",conditions:[{key:"mismatch",op:"gte",value:2}],action:"이동·일정·출결 입력 오류부터 확인; 친구 갈등으로 단정하지 않음"},
  {id:"R8",title:"재시험과 수업 불편",scope:"student",conditions:[{key:"retest",op:"gte",value:2},{key:"complaint",op:"eq",value:1}],action:"학습 난도·피드백·반 적합성을 담당 강사와 점검"},
  {id:"R9",title:"외부 학생 식별 검토",scope:"student",conditions:[{key:"identity",op:"eq",value:1}],action:"원본 ID·학생을 대조해 수동 확인; 이름·전화만으로 자동 병합하지 않음"},
  {id:"R10",title:"여러 담당자의 교차 관찰",scope:"student",conditions:[{key:"roles",op:"gte",value:3}],action:"최근 30일의 서로 다른 작성자·업무 역할 관찰을 함께 검토"},
];
export type RuleResult={id:string;title:string;state:"triggered"|"clear"|"insufficient";action:string;evidence:string[];missing:string[];version:string;from:string;through:string};
const compare=(n:number,c:Condition)=>c.op==="lt"?n<c.value:c.op==="gt"?n>c.value:c.op==="gte"?n>=c.value:n===c.value;
export function evaluateRules(facts:Facts,from:string,through:string,scope:"student"|"teacher"="student"):RuleResult[]{
  return rules.filter(r=>r.scope===scope).map(r=>{
    const values=r.conditions.map(c=>{const f=facts[c.key];return f&&f.complete&&f.from===from&&f.through===through?compare(f.value,c):null;});
    const state=r.mode==="any"?(values.includes(true)?"triggered":values.includes(null)?"insufficient":"clear"):(values.includes(false)?"clear":values.includes(null)?"insufficient":"triggered");
    return {id:r.id,title:r.title,state,action:r.action,evidence:[...new Set(r.conditions.flatMap(c=>facts[c.key]?.evidence??[]))],missing:r.conditions.filter((_,i)=>values[i]===null).map(c=>c.key),version:"rules-2.0",from,through};
  });
}
/** Equal role labels from one person cannot manufacture multi-observer consensus. */
export function observationFacts(records:KnowledgeRecord[],studentId:string,from:string,through:string):Facts{
  const rows=records.filter(r=>r.document.kind==="observation"&&r.document.studentId===studentId&&r.document.state==="confirmed"&&r.document.through>=from&&r.document.through<=through&&r.document.date<=through);
  const out:Facts={};
  for(const r of [...rows].sort((a,b)=>a.recorded_at.localeCompare(b.recorded_at))){const d=r.document;if(d.kind!=="observation"||d.value===null||d.from!==from||d.through!==through)continue;out[d.signal]={value:d.value,from,through,evidence:[r.record_id],complete:true};}
  // Maximum matching author→role avoids counting a single author or a single role multiple times.
  const rolesByAuthor=new Map<string,Set<string>>();
  for(const r of rows){const d=r.document;if(d.kind!=="observation"||d.severity<2||d.value===0)continue;const roles=rolesByAuthor.get(r.author_id)??new Set();roles.add(d.role);rolesByAuthor.set(r.author_id,roles);}
  const owners=new Map<string,string>();
  function match(author:string,seen:Set<string>):boolean{for(const role of rolesByAuthor.get(author)??[]){if(seen.has(role))continue;seen.add(role);const old=owners.get(role);if(!old||match(old,seen)){owners.set(role,author);return true;}}return false;}
  for(const author of rolesByAuthor.keys())match(author,new Set());
  // No submitted observations is missing coverage, not proof of no concern.
  if(rows.length)out.roles={value:owners.size,from,through,evidence:rows.map(r=>r.record_id),complete:true};
  return out;
}
