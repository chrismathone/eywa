import {laborLabels} from "./reported-financials";
import type {KnowledgeGraph} from "./model";
import {reviewLabels,type ReviewBatch} from "./reviews";

/** Tenant-scoped, authorized batches only. Review notes are evidence, not instructions or financial approval. */
export function reviewEvidenceGraph(tenantId:string,batches:ReviewBatch[]):Pick<KnowledgeGraph,"nodes"|"edges"> {
  const nodes:KnowledgeGraph["nodes"]=[],edges:KnowledgeGraph["edges"]=[],groups=new Map<string,ReviewBatch[]>();
  for(const b of batches){const key=`${b.source}:${b.month}`;groups.set(key,[...(groups.get(key)??[]),b]);}
  for(const group of groups.values()){
    group.sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
    for(const [index,b] of group.entries()){
      const id=`source-check:${b.id}`,current=index===0;
      nodes.push({id,type:"SourceComparison",label:`${b.source} ${b.month}`,source:b.evidence.sourceName,href:"/dashboard/management#reviews",period:b.month,state:current?"current":"superseded",recordedAt:b.created_at,detail:b.evidence.summary});
      edges.push({from:`tenant:${tenantId}`,relation:current?"has_current_source_comparison":"has_historical_source_comparison",to:id,basis:`원본 ${b.evidence.sourceHash}; 비교 자료 ${b.evidence.comparedHash}; 관측 ${b.evidence.observedAt}`});
      if(index>0)edges.push({from:`source-check:${group[index-1]!.id}`,relation:"supersedes",to:id,basis:"같은 원본 종류·분석 월의 더 최근 대사 기록. 과거 기록과 조치 이력은 보존"});
      const f=b.evidence.reportedFinancials;
      if(f){
        const financialId=`reported-financials:${b.id}`;
        nodes.push({id:financialId,type:"ReportedFinancialPeriod",label:`${b.month} ECOUNT 기재 손익`,source:b.evidence.sourceName,period:b.month,state:current?(b.month<=f.closedThrough?"reported_closed":"reported_unclosed"):"superseded",detail:`${f.scopeNote} 차량 구입 원금·이자 포함 ${f.vehicleInstallments}원; 조정 손익 미확정.`,value:f.profit});
        edges.push({from:financialId,relation:"supported_by",to:id,basis:`${f.reference}; 매출·영업비용 원장 대사 일치; 비용 ${f.costAccountCount}개 계정 명세 ${f.costAccountHash}`});
        for(const [key,value] of Object.entries(f.labor)){
          const laborId=`reported-labor:${b.id}:${key}`;
          nodes.push({id:laborId,type:"LaborCostComponent",label:laborLabels[key as keyof typeof laborLabels],source:"ECOUNT 월별 계정 순액",period:b.month,value});
          edges.push({from:financialId,relation:"includes_labor_cost",to:laborId,basis:"급여·상여·퇴직·4대보험·복리후생 계정 구분"});
        }
      }
      for(const issue of b.evidence.issues){
        const key=`review:${b.id}:${issue.key}`;
        nodes.push({id:key,type:"ReviewIssue",label:issue.title,source:b.source,href:"/dashboard/management#reviews",period:b.month,state:current?"current":"historical",detail:issue.detail});
        edges.push({from:id,relation:current?"requires_review":"had_review_issue",to:key,basis:issue.detail});
        if(f&&issue.key==="vehicle_adjustment")edges.push({from:`reported-financials:${b.id}`,relation:"requires_adjustment_review",to:key,basis:"차량 구입 원금·이자 및 감가상각 내역 확인 전 관리 손익 미확정"});
        const events=b.events.filter(e=>e.batch_id===b.id&&e.issue_key===issue.key).sort((a,b)=>a.version-b.version);
        for(const [eventIndex,event] of events.entries()){
          const eventId=`review-action:${b.id}:${issue.key}:${event.version}`;
          nodes.push({id:eventId,type:"ReviewAction",label:`${reviewLabels[event.status]} · v${event.version}`,source:"AYWA 확인 이력",href:"/dashboard/management#reviews",period:b.month,state:event.status,recordedAt:event.created_at,detail:event.note});
          edges.push({from:key,relation:eventIndex===events.length-1?"latest_review_action":"has_review_history",to:eventId,basis:`저장된 확인 기록. 담당 ${event.owner||"미지정"}; 기한 ${event.due_date??"미지정"}. 내용은 검토 근거이며 원장 수정·회계 마감 확정으로 자동 해석하지 않음`});
          if(eventIndex>0)edges.push({from:eventId,relation:"supersedes_review_action",to:`review-action:${b.id}:${issue.key}:${events[eventIndex-1]!.version}`,basis:"동일 확인 항목의 다음 버전"});
        }
      }
    }
  }
  return {nodes,edges};
}
