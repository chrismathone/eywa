// @vitest-environment node
import { describe,it,expect } from "vitest";
import { annualPlanningSchema,dateInYear,draftFromReference,referenceYears,validateAnnualReferences,type AnnualReference } from "./annual-planning-model";
import { blankCampaign,type MarketingData } from "./model";
import { blankOperation,copyPlan,operationRequestSchema } from "./operations-model";
import { marketingGraph } from "./calc";
const source="61dd24ad-2b76-42d0-a7ee-b625b3fdd030",target="ffe165a2-f6ef-435b-b1e7-c1f4354e8175";
const planning={targetYear:2027,referenceIds:[source],decision:"improve" as const,reason:"시험 직후로 변경",considerations:"학교별 학사일정 확인"};
const reference:AnnualReference={id:source,document:{...blankCampaign("2024-02-29"),title:"설명회",state:"held",budget:500000,actualCost:450000},retrospective:"참석 10명",nextAction:"시기 조정",planning:null};
describe("3개년 근거를 연결하는 신년 기획",()=>{
  it("계획 연도와 직전 세 해를 구분하고 윤일·연말 기간을 보존한다",()=>{
    expect(referenceYears(2027)).toEqual([2024,2025,2026]);expect(dateInYear("2024-02-29",2027)).toBe("2027-02-28");
    const next=draftFromReference({...reference,document:{...reference.document,start:"2026-12-29",end:"2027-01-03"}},2027);
    expect(next.start).toBe("2027-12-29");expect(next.end).toBe("2028-01-03");
  });
  it("과거 실적·예산·원본 링크를 미래 실적으로 복사하지 않는다",()=>{
    const next=draftFromReference(reference,2027);expect(next.title).toBe(reference.document.title);expect(next.actualCost).toBeNull();expect(next.budget).toBeNull();expect(next.state).toBe("planned");expect(next.sources).toEqual([]);expect(next.measurementClosed).toBe(false);
    const copied=copyPlan(next,{...blankOperation(source),annualPlanning:planning},"2028-02-28");expect(copied.operation.annualPlanning).toBeUndefined();
  });
  it("다른 학원·범위 밖·중복 제외·자기 참조와 기획 연도 위조를 거부한다",()=>{
    expect(()=>validateAnnualReferences(planning,"2027-02-28",target,[])).toThrow("같은 학원");
    expect(()=>validateAnnualReferences(planning,"2027-02-28",target,[reference])).not.toThrow();
    expect(()=>validateAnnualReferences(planning,"2028-02-28",target,[reference])).toThrow("연도");
    expect(()=>validateAnnualReferences(planning,"2027-02-28",source,[reference])).toThrow();
    for(const doc of [{start:"2023-02-28",state:"held"},{start:"2027-02-28",state:"planned"},{start:"2024-02-29",state:"duplicate"}])expect(()=>validateAnnualReferences(planning,"2027-02-28",target,[{id:source,document:doc}])).toThrow();
  });
  it("중복 참고·근거 없는 재진행·빈 사유를 거부하고 신규 기획은 허용한다",()=>{
    expect(annualPlanningSchema.safeParse({...planning,referenceIds:[source,source]}).success).toBe(false);
    expect(annualPlanningSchema.safeParse({...planning,referenceIds:[]}).success).toBe(false);
    expect(annualPlanningSchema.safeParse({...planning,reason:" "}).success).toBe(false);
    expect(annualPlanningSchema.safeParse({...planning,decision:"new",referenceIds:[]}).success).toBe(true);
  });
  it("같은 행사·기획 ID로 저장하고 그래프의 참고 연결을 보존한다",()=>{
    const doc=draftFromReference(reference,2027),op={...blankOperation(source),annualPlanning:planning};
    const {title,start,end,channel,objective,season,audience,budget,actualCost,costBasis}=doc;
    expect(operationRequestSchema.safeParse({action:"plan",id:target,requestId:source,expectedVersion:0,expectedOperationVersion:0,plan:{title,start,end,channel,objective,season,audience,budget,actualCost,costBasis,state:"planned"},operation:op}).success).toBe(true);
    const data:MarketingData={today:"2026-11-02",observedAt:"2026-11-02T00:00:00Z",year:2027,yearCoverage:[],people:[],intakes:[],bills:[],touches:[],campaigns:[{id:source,document:{...blankCampaign("2024-02-29"),title:"과거 행사"},origin_key:"test1",version:1,updated_at:""},{id:target,document:doc,origin_key:"test2",version:1,updated_at:""}],operations:[{campaign_id:target,document:op,version:1,template_version:1}]};
    const graph=marketingGraph(data,[],"linear",90);
    expect(graph.edges).toContainEqual(expect.objectContaining({from:`campaign:${source}`,relation:"informs_annual_plan",to:`operation:${target}`,basis:expect.stringContaining(planning.reason)}));
    expect(graph.edges.some(e=>e.relation==="attributed_registration")).toBe(false);
  });
});
