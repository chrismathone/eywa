// @vitest-environment node
import { describe,it,expect } from "vitest";
import { blankOperation,copyPlan,instantiateTasks,offsetDate,nextYearDate,taskDocumentSchema,operationRequestSchema } from "./operations-model";
import { blankCampaign,type MarketingData } from "./model";
import { submitInputSchema } from "./input-model";
import { marketingGraph } from "./calc";
const actor="61dd24ad-2b76-42d0-a7ee-b625b3fdd030",event="ffe165a2-f6ef-435b-b1e7-c1f4354e8175";
describe("행사 기획을 실제 업무와 연결",()=>{
  it("설명회 상대 기한은 연도·월·윤일 경계를 넘어서도 날짜와 일치한다",()=>{
    expect(offsetDate("2028-03-01",-1)).toBe("2028-02-29");
    expect(nextYearDate("2027-07-09")).toBe("2028-07-09");expect(nextYearDate("2028-02-29")).toBe("2029-02-28");
    const tasks=instantiateTasks("seminar","2027-01-05",actor);
    expect(tasks[0].due).toBe("2026-12-01");expect(tasks).toHaveLength(14);
    expect(tasks.every(t=>t.due===offsetDate("2027-01-05",t.offset))).toBe(true);
  });
  it("다음 회차 복사는 계획만 남기고 관측 비용·회고·링크를 비운다",()=>{
    const c={...blankCampaign("2026-07-09"),end:"2026-07-11",actualCost:1200000,costBasis:"old",budget:1500000,state:"held" as const};
    const o={...blankOperation(actor),retrospective:"old results",nextAction:"old action",resources:[{title:"attendance",url:"https://example.com/old"}]};
    const next=copyPlan(c,o,"2027-07-08");expect(next.plan.end).toBe("2027-07-10");expect(next.plan.actualCost).toBeNull();expect(next.plan.state).toBe("planned");expect(next.operation.retrospective).toBe("");expect(next.operation.resources).toEqual([]);expect(next.plan.budget).toBe(1500000);
  });
  it("업무 완료에는 실제 결과가 필요하고 실행 가능한 URL은 거부한다",()=>{
    const task=instantiateTasks("flyer","2026-11-30",actor)[0];
    expect(taskDocumentSchema.safeParse({...task,status:"done"}).success).toBe(false);
    expect(taskDocumentSchema.safeParse({...task,status:"done",result:"배부 400부"}).success).toBe(true);
    expect(taskDocumentSchema.safeParse({...task,evidenceUrl:"javascript:alert(1)"}).success).toBe(false);
  });
  it("신규 상담 대상도 입학 전 참석할 수 있고 문의는 상담에만 연결한다",()=>{
    const base={id:event,campaignId:event,context:{type:"consultation",id:actor},document:{kind:"attended",date:"2026-07-09",channel:"seminar",basis:"staff_record",reference:"현장 확인",unknownReason:""}};
    expect(submitInputSchema.safeParse(base).success).toBe(true);
    expect(submitInputSchema.safeParse({...base,context:{type:"student",id:actor},document:{...base.document,kind:"inquiry"}}).success).toBe(false);
  });
  it("호출자가 학원·작성자를 선택할 수 없으며 그래프가 같은 행사 ID에 업무·책임자를 연결한다",()=>{
    const task={id:actor,campaign_id:event,version:1,document:instantiateTasks("flyer","2026-11-30",actor)[0]};
    const request={action:"task",requestId:event,id:actor,campaignId:event,expectedVersion:1,document:task.document};
    expect(operationRequestSchema.safeParse({...request,tenantId:actor}).success).toBe(false);
    const data:MarketingData={today:"2026-11-02",observedAt:"2026-11-02T00:00:00Z",year:2026,yearCoverage:[],campaigns:[{id:event,origin_key:"test",version:1,updated_at:"2026-11-02T00:00:00Z",document:blankCampaign("2026-11-30")}],people:[],intakes:[],bills:[],touches:[],operations:[{campaign_id:event,document:blankOperation(actor,"flyer"),version:1,template_version:1}],workItems:[task]};
    const graph=marketingGraph(data,[],"linear",90);
    expect(graph.edges).toContainEqual(expect.objectContaining({from:`campaign:${event}`,relation:"requires_work",to:`work:${actor}`}));
    expect(graph.edges).toContainEqual(expect.objectContaining({from:`actor:${actor}`,relation:"owns",to:`operation:${event}`}));
    const ids=new Set(graph.nodes.map(n=>n.id));expect(graph.edges.every(e=>ids.has(e.from)&&ids.has(e.to))).toBe(true);
  });
});
