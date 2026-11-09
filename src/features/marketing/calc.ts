import { channels,seasons,type Allocation,type AttributionModel,type Campaign,type CampaignResult,type MarketingData,type MarketingGraph } from "./model";
const days=(a:string,b:string)=>(Date.parse(a)-Date.parse(b))/86400000;
export const monthAfter=(date:string,n:number)=>{const [y,m]=date.slice(0,7).split("-").map(Number);return new Date(Date.UTC(y!,m!-1+n,1)).toISOString().slice(0,7);};
export const cohortEnd=(date:string)=>{const [y,m]=date.slice(0,7).split("-").map(Number);return new Date(Date.UTC(y!,m!+2,0)).toISOString().slice(0,10);};

/** Descriptive attribution, never an estimate of incremental/causal revenue. */
export function attribute(data:MarketingData,model:AttributionModel="linear",lookback=90):CampaignResult[] {
  const campaignMap=new Map(data.campaigns.map(c=>[c.id,c])),people=new Map(data.people.map(p=>[p.id,p])),intakes=new Map(data.intakes.map(c=>[c.id,c]));
  const resolved=data.touches.filter(t=>t.document.active&&t.document.verified&&t.document.date<=data.today).map(t=>{
    const d=t.document,consult=d.consultationId?intakes.get(d.consultationId):null,studentId=d.studentId??consult?.studentId??null;
    return {...t,studentId,contact:studentId?`s:${studentId}`:d.consultationId?`c:${d.consultationId}`:null};
  }).filter(t=>t.contact&&(!t.studentId||people.has(t.studentId))&&(!t.document.consultationId||intakes.has(t.document.consultationId))&&!(t.document.studentId&&t.document.consultationId&&t.document.studentId!==intakes.get(t.document.consultationId)?.studentId));
  const eligible=resolved.filter(t=>{const c=campaignMap.get(t.document.campaignId)?.document;return c?.state==="held"&&c.precision==="day"&&c.objective==="acquisition"&&t.document.kind!=="invited"&&t.document.date>=c.start&&(t.document.kind==="inquiry"?days(t.document.date,c.end)<=lookback:t.document.date<=c.end);});
  const allocations:Allocation[]=[];
  for(const p of data.people){
    // Both profile registration and a real first course must exist. Earlier course history indicates an existing customer.
    const entry=p.enrolledAt;
    if(!entry||!p.firstClass||p.firstClass<entry||p.firstClass>data.today||entry>data.today)continue;
    const matches=eligible.filter(t=>t.studentId===p.id&&days(entry,t.document.date)>=0&&days(entry,t.document.date)<=lookback&&days(entry,campaignMap.get(t.document.campaignId)!.document.end)<=lookback);
    if(!matches.length)continue;
    const ordered=[...matches].sort((a,b)=>a.document.date.localeCompare(b.document.date)||a.id.localeCompare(b.id));
    // Same-day ties share credit; repeated contacts in the same campaign do not buy additional weight.
    const selected=model==="linear"?ordered:ordered.filter(t=>t.document.date===(model==="first"?ordered[0]:ordered.at(-1))!.document.date);
    const ids=[...new Set(selected.map(t=>t.document.campaignId))],months=[0,1,2].map(n=>monthAfter(entry,n));
    const bills=[...new Map(data.bills.filter(b=>b.studentId===p.id&&months.includes(b.month)&&b.status!=="void").map(b=>[b.id,b])).values()];
    const revenue=bills.length?bills.reduce((n,b)=>n+(b.status==="refunded"?0:b.net),0):null;
    for(const id of ids)allocations.push({campaignId:id,studentId:p.id,enrolledOn:entry,weight:1/ids.length,touchIds:matches.filter(t=>t.document.campaignId===id).map(t=>t.id),invoiceIds:bills.map(b=>b.id),revenue:revenue===null?null:revenue/ids.length,mature:cohortEnd(entry)<data.today});
  }
  return data.campaigns.map(c=>{
    const d=c.document,t=resolved.filter(t=>t.document.campaignId===c.id),a=allocations.filter(a=>a.campaignId===c.id),gaps:string[]=[];
    const enrollments=a.reduce((n,a)=>n+a.weight,0),revenue=a.length&&a.every(a=>a.revenue!==null)?a.reduce((n,a)=>n+a.revenue!,0):!a.length&&d.measurementClosed&&days(data.today,d.end)>lookback?0:null;
    if(d.state!=="held")gaps.push("실제 진행 확인");if(d.precision!=="day")gaps.push("정확한 집행일");
    if(d.objective!=="acquisition")gaps.push("신규 모집 성과와 별도 평가");
    if(d.actualCost===null)gaps.push("실제 비용·배부 근거");if(!d.measurementClosed)gaps.push("접점·등록·청구 대사 마감");
    if(days(data.today,d.end)<=lookback)gaps.push(`${lookback}일 전환 관찰 중`);
    const ready=gaps.length===0,positiveCost=d.actualCost!==null&&d.actualCost>0;
    if(!enrollments)gaps.push(d.measurementClosed?"대사한 신규 등록 0명":"신규 등록 연결 없음");
    const revenueReady=ready&&a.every(a=>a.mature)&&revenue!==null;
    if(a.some(a=>!a.mature))gaps.push("등록월 포함 3개월 관찰 중");
    if(enrollments&&revenue===null)gaps.push("등록 학생 청구자료 필요");
    return {id:c.id,contacts:new Set(t.filter(t=>t.document.kind!=="invited").map(t=>t.contact)).size,inquiries:new Set(t.map(t=>t.document.consultationId).filter(Boolean)).size,invited:new Set(t.filter(t=>t.document.kind==="invited").map(t=>t.contact)).size,attended:new Set(t.filter(t=>t.document.kind==="attended").map(t=>t.contact)).size,enrollments,uniqueEnrollments:a.length,revenue,cpe:ready&&enrollments>0?d.actualCost!/enrollments:null,roas:revenueReady&&positiveCost?revenue!/d.actualCost!*100:null,roi:revenueReady&&positiveCost&&d.variableCost!==null?(revenue!-d.variableCost-d.actualCost!)/d.actualCost!*100:null,ready,revenueReady,gaps,allocations:a};
  });
}

export function seasonEvidence(data:MarketingData,results:CampaignResult[]) {
  const groups=new Map<string,{label:string;years:Set<string>;events:number;enrollments:number;cost:number;cpe:number[]}>();
  for(const c of data.campaigns){const r=results.find(r=>r.id===c.id);if(!r?.ready||c.document.actualCost===null)continue;
    const d=c.document,key=[d.channel,d.season,d.audience.trim(),Math.ceil((days(d.end,d.start)+1)/30)].join(":");
    const g=groups.get(key)??{label:`${channels[d.channel]} · ${seasons[d.season]} · ${d.audience||"대상 미분류"}`,years:new Set<string>(),events:0,enrollments:0,cost:0,cpe:[]};
    g.years.add(d.start.slice(0,4));g.events++;g.enrollments+=r.enrollments;g.cost+=d.actualCost!;if(r.cpe!==null)g.cpe.push(r.cpe);groups.set(key,g);
  }
  return [...groups.values()].map(g=>({label:g.label,years:g.years.size,events:g.events,enrollments:g.enrollments,cpe:g.enrollments?g.cost/g.enrollments:null,sufficient:!g.label.includes("대상 미분류")&&g.years.size>=2&&g.events>=3&&g.enrollments>=10}));
}

export function channelSummary(campaigns:Campaign[],results:CampaignResult[]){
  return Object.entries(channels).map(([key,label])=>{
    const rows=campaigns.filter(c=>c.document.channel===key&&c.document.state==="held"&&c.document.objective==="acquisition"),r=results.filter(r=>rows.some(c=>c.id===r.id));
    const count=rows.length,ready=count>0&&r.length===count&&r.every(r=>r.ready),cost=count&&rows.every(c=>c.document.actualCost!==null)?rows.reduce((n,c)=>n+c.document.actualCost!,0):null,enrollments=r.reduce((n,r)=>n+r.enrollments,0),revenue=count&&r.every(r=>r.revenue!==null)?r.reduce((n,r)=>n+r.revenue!,0):null;
    const revenueReady=ready&&r.every(r=>r.revenueReady)&&revenue!==null,variable=count&&rows.every(c=>c.document.variableCost!==null)?rows.reduce((n,c)=>n+c.document.variableCost!,0):null;
    return {key,label,count,ready,cost,enrollments,revenue,cpe:ready&&cost!==null&&enrollments>0?cost/enrollments:null,roas:revenueReady&&cost!==null&&cost>0?revenue!/cost*100:null,roi:revenueReady&&cost!==null&&cost>0&&variable!==null?(revenue!-variable-cost)/cost*100:null};
  }).filter(r=>r.count>0);
}

export function marketingGraph(data:MarketingData,results:CampaignResult[],model:AttributionModel,lookback:number):MarketingGraph {
  const g:MarketingGraph={schemaVersion:"aywa-marketing-v1",observedAt:data.observedAt,model,lookbackDays:lookback,revenueWindow:"등록월 포함 3개 청구월 / 실청구 / 인과효과 아님",nodes:[],edges:[]},ids=new Set<string>();
  const node=(n:MarketingGraph["nodes"][number])=>{if(!ids.has(n.id)){ids.add(n.id);g.nodes.push(n);}};
  const edge=(from:string,relation:string,to:string,basis:string)=>g.edges.push({from,relation,to,basis});
  const intakes=new Map(data.intakes.map(i=>[i.id,i]));
  for(const c of data.campaigns){const d=c.document,cid=`campaign:${c.id}`;node({id:cid,type:"Campaign",label:d.title,source:"AYWA 마케팅",href:`/billing/management/marketing?year=${d.start.slice(0,4)}&campaign=${c.id}`,period:d.start,state:d.state,detail:`${d.start}~${d.end} / ${d.precision} / ${d.objective}`});
    node({id:`channel:${d.channel}`,type:"Channel",label:channels[d.channel],source:"담당자 분류"});edge(cid,"uses_channel",`channel:${d.channel}`,"자동 제안 분류는 확인 전 검토 대상");
    for(const s of d.sources){const id=`source:${s.provider}:${s.key}`;node({id,type:"SourceRecord",label:s.title,source:s.provider,href:s.url,recordedAt:s.observedAt,detail:s.excerpt});edge(id,"documents",cid,"일정 기록만으로 진행·매출을 확정하지 않음");}
    if(d.duplicateOf)edge(cid,"duplicate_of",`campaign:${d.duplicateOf}`,"담당자 지정 / 중복 집계 제외");
    if(d.actualCost!==null){node({id:`cost:${c.id}`,type:"MarketingCost",label:"확인 실제 집행비",source:d.costBasis,value:d.actualCost});edge(cid,"incurs",`cost:${c.id}`,"행사 기간 총액, 공통비는 배부 근거 필요");}
  }
  for(const t of data.touches.filter(t=>t.document.active)){const d=t.document,id=`touch:${t.id}`,currentStudent=d.consultationId?intakes.get(d.consultationId)?.studentId:d.studentId,student=d.consultationId&&d.studentId&&d.studentId!==currentStudent?null:currentStudent;node({id,type:"Touchpoint",label:({inquiry:"문의",invited:"초대",attended:"참석"})[d.kind],source:d.basis,period:d.date,state:d.verified?"verified":"review",detail:d.reference});edge(`campaign:${d.campaignId}`,"has_touchpoint",id,"기록된 관계");
    if(d.consultationId){const q=intakes.get(d.consultationId);node({id:`consultation:${d.consultationId}`,type:"Consultation",label:q?.name??"입학상담",source:"AYWA",href:"/enrollment"});edge(id,"links_consultation",`consultation:${d.consultationId}`,"동일 학원 상담 ID");}
    if(student){node({id:`student:${student}`,type:"Student",label:data.people.find(p=>p.id===student)?.name??"학생",source:"AYWA",href:`/students/${student}?tab=hub`});edge(id,"belongs_to",`student:${student}`,"확인된 학생 ID / 이름 자동 병합 없음");}
  }
  for(const r of results){for(const a of r.allocations){const id=`entry:${a.studentId}:${a.enrolledOn}`;node({id,type:"Enrollment",label:"신규 등록 관측",source:"학생 등록일 + 최초 수강 이력",period:a.enrolledOn});edge(`student:${a.studentId}`,"has_registration",id,"이전 수강 없음 / 현재 저장 이력 범위");edge(`campaign:${r.id}`,"attributed_registration",id,`${model} / ${lookback}일 / 가중치 ${a.weight} / 인과 추론 아님`);
    for(const billId of a.invoiceIds){const b=data.bills.find(b=>b.id===billId)!;node({id:`invoice:${b.id}`,type:"Invoice",label:`${b.month} 청구`,source:"MakeEdu → AYWA",period:b.month,value:b.status==="refunded"?0:b.net,state:b.status});edge(id,"observed_billing",`invoice:${b.id}`,"등록월 포함 3개 청구월 / 전액환불 0 / 회계 매출 아님");}
  }for(const [key,value] of Object.entries({cpe:r.cpe,roas:r.roas,roi:r.roi})){const id=`marketing_metric:${r.id}:${key}`;node({id,type:"Metric",label:key.toUpperCase(),source:"검증된 비용·접점·청구",value,state:value===null?"insufficient":"calculated"});edge(`campaign:${r.id}`,"measured_by",id,`${model}, ${lookback}일, ${r.gaps.join(" / ")}`);}}
  for(const input of data.inputRecords??[]){
    const id=`marketing_input:${input.id}`,student=input.consultation_id?intakes.get(input.consultation_id)?.studentId:input.student_id;
    node({id,type:"InputRecord",label:"담당자 제출 근거",source:"업무 화면 입력",recordedAt:input.created_at,period:input.document.date,state:input.status,detail:`${input.document.reference}${input.review_note?` / 확인 의견: ${input.review_note}`:""}`,href:"/billing/management/marketing/inputs"});
    node({id:`actor:${input.actor_id}`,type:"Staff",label:"기록 담당자",source:"로그인 계정"});edge(`actor:${input.actor_id}`,"submitted",id,"서버에서 확인한 작성자");
    if(input.campaign_id&&ids.has(`campaign:${input.campaign_id}`))edge(id,"proposes_link_to",`campaign:${input.campaign_id}`,"제출 근거 / 확정 실적과 별도");
    if(input.consultation_id){node({id:`consultation:${input.consultation_id}`,type:"Consultation",label:intakes.get(input.consultation_id)?.name??"입학상담",source:"AYWA",href:`/enrollment/${input.consultation_id}`});edge(id,"records_context",`consultation:${input.consultation_id}`,"현재 상담 ID");}
    if(student&&data.people.some(p=>p.id===student)){node({id:`student:${student}`,type:"Student",label:data.people.find(p=>p.id===student)!.name,source:"AYWA",href:`/students/${student}?tab=hub`});edge(id,"records_context",`student:${student}`,"현재 학생 또는 상담의 등록 전환 관계");}
    if(input.touch_id&&ids.has(`touch:${input.touch_id}`))edge(id,"confirmed_as",`touch:${input.touch_id}`,`검토 버전 ${input.version}`);
    if(input.reviewer_id){node({id:`actor:${input.reviewer_id}`,type:"Staff",label:"검토 담당자",source:"로그인 계정"});edge(`actor:${input.reviewer_id}`,"reviewed",id,input.reviewed_at??"검토 시점");}
  }
  for(const o of data.operations??[]){
    const id=`operation:${o.campaign_id}`;node({id,type:"EventPlan",label:"행사 기획·회고",source:"AYWA 행사 운영",href:`/marketing?event=${o.campaign_id}`,state:data.campaigns.find(c=>c.id===o.campaign_id)?.document.state??"review",detail:`${o.document.brief}\n회고: ${o.document.retrospective}\n개선: ${o.document.nextAction}`});
    edge(`campaign:${o.campaign_id}`,"operated_by_plan",id,`템플릿 ${o.document.template} v${o.template_version} / 기획 버전 ${o.version}`);
    node({id:`actor:${o.document.ownerId}`,type:"Staff",label:"행사 책임자",source:"로그인 계정 배정"});edge(`actor:${o.document.ownerId}`,"owns",id,"기획 책임자 지정");
    const planning=o.document.annualPlanning;
    if(planning){
      for(const ref of planning.referenceIds){
        if(ids.has(`campaign:${ref}`))edge(`campaign:${ref}`,"informs_annual_plan",id,`${planning.targetYear}년 / ${planning.decision} / ${planning.reason} / 준비: ${planning.considerations} / 기획 참고 관계, 매출 인과관계 아님`);
      }
    }
  }
  for(const w of data.workItems??[]){
    const id=`work:${w.id}`;node({id,type:"WorkItem",label:w.document.title,source:"AYWA 행사 업무",period:w.document.due,state:w.document.status,detail:w.document.result,href:`/marketing?event=${w.campaign_id}`});edge(`campaign:${w.campaign_id}`,"requires_work",id,`업무 버전 ${w.version}`);
    if(w.document.assigneeId){node({id:`actor:${w.document.assigneeId}`,type:"Staff",label:"업무 담당자",source:"로그인 계정 배정"});edge(`actor:${w.document.assigneeId}`,"assigned_to",id,"담당자가 실제 결과를 기록");}
  }
  return g;
}
