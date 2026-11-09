import { ONTOLOGY_VERSION, relations, entities, type Entity } from "./catalog";
import type { KnowledgeRecord } from "./records";
import type { RuleResult } from "./rules";
export type Node={id:string;type:Entity;label:string;source:string;href?:string;value?:unknown;state?:string;period?:string;detail?:string;attributes?:Record<string,unknown>};
export type Edge={from:string;to:string;relation:string;sourceRelation:string;basis:string;evidence:string[];asOf:string;period?:{from:string;through:string|null}|null};
export type Graph={version:string;tenant:string;observedAt:string;nodes:Node[];edges:Edge[];issues:{source:string;reason:string;count:number;examples?:{from:string;to:string;relation:string}[]}[]};
export type SourceGraph={nodes:{id:string;label:string;type?:string;kind?:string;source?:string;href?:string;value?:unknown;state?:string;period?:string;date?:string;detail?:string;attributes?:Record<string,unknown>}[];edges:{from:string;to:string;relation:string;basis?:string;evidence?:string[];asOf?:string;period?:{from:string;through:string|null}|null}[]};
const identities:Record<string,string>={students:"student",student:"student",teacher:"staff",staff:"staff",users:"staff",actor:"staff",class:"course",classes:"course",course:"course",invoice:"invoice",invoices:"invoice",enrollments:"enrollment",campaign:"campaign",marketing_campaigns:"campaign",touch:"touchpoint",marketing_touchpoints:"touchpoint",student_consultations:"student_consultation",enrollment_consultations:"intake",school:"school",academy_knowledge_records:"knowledge-version"};
const types:Record<string,Entity>={student:"Student",staff:"Staff",course:"Course",invoice:"Invoice",enrollment:"Enrollment",campaign:"Campaign",touchpoint:"Touchpoint",student_consultation:"Consultation",intake:"Consultation",school:"School"};
Object.assign(identities,{enrollment:"enrollment",lesson_report:"lesson_reports",lesson_reports:"lesson_reports",attendance_records:"attendance_records",student_grades:"student_grades",commitment:"commitment",student_care_commitments:"commitment",class_sheet_student_mark:"class_sheet_student_marks",class_sheet_student_marks:"class_sheet_student_marks",student_contribution_factor_records:"factor_record"});
Object.assign(types,{lesson_reports:"LearningRecord",attendance_records:"LearningRecord",student_grades:"LearningRecord",class_sheet_student_marks:"LearningRecord",commitment:"Commitment"});
Object.assign(identities,{student_onboarding_feedback:"student_onboarding_feedback",newcomer_checks:"newcomer_checks"});
Object.assign(types,{student_onboarding_feedback:"CareTask",newcomer_checks:"CareTask"});
export function canonicalId(tenant:string,source:string,id:string){
  const local=id.startsWith(`${tenant}:`)?id.slice(tenant.length+1):id;
  if(local===`tenant:${tenant}`)return `${tenant}:academy`;
  const i=local.indexOf(":"),prefix=i<0?local:local.slice(0,i),key=i<0?"":local.slice(i+1);
  // Marketing "consultation" refers to an intake, student consultations have a different namespace.
  if(prefix==="consultation"&&source==="marketing")return `${tenant}:intake:${key}`;
  const kind=identities[prefix];
  return kind?`${tenant}:${kind}:${key}`:`${tenant}:source:${source}:${local}`;
}
function nodeType(id:string,raw:string):Entity{
  const type=types[id.split(":")[1]];if(type)return type;
  const declared=entities.find(([kind])=>kind===raw)?.[0];if(declared)return declared;
  const value=raw.toLowerCase();
  if(/academy/.test(value))return "Academy";
  if(/metric/.test(value))return "Metric";
  if(/account|ledger|financial/.test(value))return "Finance";
  if(/channel/.test(value))return "Channel";
  if(/commitment|promise/.test(value))return "Commitment";
  if(/caretask|followup/.test(value))return "CareTask";
  if(/assessment|analysis|factor|axis/.test(value))return "Assessment";
  if(/observation|signal/.test(value))return "Observation";
  if(/grade|attendance|homework|lesson|progress|sheet/.test(value))return "LearningRecord";
  return "Evidence";
}
function displayLabel(n:SourceGraph["nodes"][number],old:Node|undefined,type:Entity){
  const generic=n.label===n.id||n.label==="학생"||n.label===n.kind||n.label===n.type||n.label===n.source||!!identities[n.label.toLowerCase()];
  if(generic&&old)return old.label;
  if(generic)return entities.find(([key])=>key===type)?.[1]??n.label;
  return n.type==="ExternalStudent"?`${n.source??"외부"} ${n.label}`:n.label;
}
export function unifyGraphs(tenant:string,observedAt:string,sources:{name:string;graph:SourceGraph}[]):Graph{
  const nodes=new Map<string,Node>(),edges:Edge[]=[],issues:Graph["issues"]=[];
  for(const {name,graph} of sources){
    for(const n of graph.nodes){const id=canonicalId(tenant,name,n.id),old=nodes.get(id),type=nodeType(id,n.type??n.kind??"");nodes.set(id,{...old,id,type,label:displayLabel(n,old,type),source:[...new Set([...(old?.source.split(" · ")??[]),n.source??name])].join(" · "),href:n.href??old?.href,value:n.value??old?.value,state:n.state??old?.state,period:n.period??n.date??old?.period,attributes:{...old?.attributes,...n.attributes,recordKind:n.type??n.kind??old?.attributes?.recordKind},detail:n.detail??(n.attributes?.detail?String(n.attributes.detail):n.attributes?.body?String(n.attributes.body):old?.detail)});}
    for(const e of graph.edges){let from=canonicalId(tenant,name,e.from),to=canonicalId(tenant,name,e.to),relation=Object.hasOwn(relations,e.relation)?e.relation:"RELATED_RECORD";
      if(e.relation==="enrolled_in")relation="ENROLLED_IN";
      if(e.relation==="currently_taught_by"){[from,to]=[to,from];relation="TEACHES";}
      if(e.relation==="billed_to")relation="BILLED_TO";
      if(e.relation==="uses_channel")relation="USES_CHANNEL";
      edges.push({from,to,relation,sourceRelation:e.relation,basis:e.basis??"원본의 명시 연결; 인과관계 아님",evidence:(e.evidence??[]).map(id=>canonicalId(tenant,name,id)),asOf:e.asOf??observedAt,period:e.period});
    }
  }
  const valid:Edge[]=[],seen=new Set<string>();
  for(const e of edges){const a=nodes.get(e.from),b=nodes.get(e.to),def=relations[e.relation];
    const reason=!a||!b?"대상 원기록을 확인하지 못한 관계":!def.from.includes(a.type)||!def.to.includes(b.type)?"관계의 개체 유형 불일치":null;
    if(reason){const example={from:e.from,to:e.to,relation:e.sourceRelation},issue=issues.find(i=>i.reason===reason);if(issue){issue.count++;if((issue.examples?.length??0)<10)(issue.examples??=[]).push(example);}else issues.push({source:"통합 검증",reason,count:1,examples:[example]});continue;}
    const key=JSON.stringify([e.from,e.to,e.relation,e.sourceRelation,e.basis,e.asOf,e.period]);if(!seen.has(key)){valid.push(e);seen.add(key);}
  }
  return {version:ONTOLOGY_VERSION,tenant,observedAt,nodes:[...nodes.values()],edges:valid,issues};
}
export function addNativeGraph(graph:Graph,records:KnowledgeRecord[],people:{id:string;name:string}[],staff:{id:string;display_name:string}[],ruleResults:RuleResult[]=[],studentId?:string){
  const nodes=new Map(graph.nodes.map(n=>[n.id,n])),edges=[...graph.edges],root=graph.tenant;
  const node=(id:string,type:Entity,label:string,extra:Partial<Node>={})=>{if(!nodes.has(id))nodes.set(id,{id,type,label,source:"AYWA 직접 기록",...extra});};
  const edge=(from:string,relation:string,to:string,basis:string)=>{const def=relations[relation];if(nodes.has(from)&&nodes.has(to)&&def.from.includes(nodes.get(from)!.type)&&def.to.includes(nodes.get(to)!.type))edges.push({from,to,relation,sourceRelation:relation,basis,evidence:[],asOf:graph.observedAt});};
  node(`${root}:academy`,"Academy","학원",{href:"/dashboard/management"});
  for(const p of people)node(`${root}:student:${p.id}`,"Student",p.name,{href:`/students/${p.id}?tab=hub`});
  for(const p of staff)node(`${root}:staff:${p.id}`,"Staff",p.display_name,{href:`/class-review/knowledge?teacher=${p.id}`});
  for(const r of records){const d=r.document,id=`${root}:knowledge:${r.record_id}`,type=d.kind==="observation"?"Observation":d.kind==="action"?"Action":d.kind==="okr"?"Objective":"Evidence";
    node(id,type,d.title,{href:`/work-records/knowledge?record=${r.record_id}`,period:d.date,state:"state" in d?d.state:"recorded",value:d.kind==="observation"?d.value:undefined,attributes:{document:d,version:r.version,recordedAt:r.recorded_at,authorId:r.author_id},detail:`${d.kind==="observation"?`사실: ${d.fact} / 해석: ${d.interpretation||"없음"} / `:""}${d.evidence} · v${r.version}`});
    const versionId=`${root}:knowledge-version:${r.id}`;node(versionId,"Evidence",`${d.title} · v${r.version}`,{href:`/work-records/knowledge?record=${r.record_id}`});edge(id,"RELATED_RECORD",versionId,"변경 불가 원본 버전");
    edge(`${root}:academy`,"RELATED_RECORD",id,"학원에 소속된 기록");
    const actor=`${root}:staff:${r.author_id}`;node(actor,"Staff",staff.find(x=>x.id===r.author_id)?.display_name??"기록 담당자");edge(actor,"OBSERVED",id,`서버 확인 작성자 · v${r.version}`);
    if("studentId" in d&&d.studentId)edge(id,"ABOUT",`${root}:student:${d.studentId}`,"명시된 학생 ID");
    if("ownerId" in d){const owner=`${root}:staff:${d.ownerId}`;node(owner,"Staff",staff.find(x=>x.id===d.ownerId)?.display_name??"담당자");edge(id,"ASSIGNED_TO",owner,"명시된 담당자");}
    if(d.kind==="content"&&d.campaignId)edge(id,"RELATED_RECORD",`${root}:campaign:${d.campaignId}`,"동일 캠페인 ID, 제출 집계를 자동 합산하지 않음");
  }
  for(const r of records){const d=r.document;if(d.kind==="action"&&d.originId)edge(`${root}:knowledge:${r.record_id}`,"RESPONDS_TO",`${root}:knowledge:${d.originId}`,"관찰에서 후속 처리까지 연결");}
  for(const r of ruleResults){const id=`${root}:rule:${studentId}:${r.id}:${r.through}`;node(id,"Assessment",r.title,{state:r.state,period:`${r.from}~${r.through}`,detail:`${r.version}: ${r.action}`});if(studentId)edge(id,"ABOUT",`${root}:student:${studentId}`,"기록 기반 검토 제안, 인과·퇴원 확률 아님");for(const e of r.evidence)edge(id,"EVIDENCED_BY",`${root}:knowledge:${e}`,"동일 관측 기간의 확인된 자료");
    for(const a of records)if(a.document.kind==="action"&&a.document.ruleId===r.id&&a.document.studentId===studentId)edge(`${root}:knowledge:${a.record_id}`,"RESPONDS_TO",id,"담당자 지정 후속 조치");
  }
  return {...graph,nodes:[...nodes.values()],edges};
}
