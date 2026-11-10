import {expect,it} from "vitest";
import {reviewEvidenceGraph} from "./review-graph";
import type {ReviewBatch,ReviewEvent} from "./reviews";
const batch=(id:string,created_at:string,source="makeedu",month="2026-10"):ReviewBatch=>({id,created_at,source,month,evidence:{source:source as "makeedu",month,sourceName:"원본.xlsx",sourceHash:"a".repeat(64),comparedHash:"b".repeat(64),observedAt:created_at,summary:"당시 원본 대사",facts:[],issues:[{key:"identity",title:"귀속 확인",detail:"원본 고유번호 확인 필요",nextAction:"상세 확인"}]},events:[]});
it("keeps a repaired comparison current and old issues historical even when input is unsorted",()=>{
  const old=batch("old","2026-11-01T01:00:00Z"),latest=batch("new","2026-11-01T02:00:00Z");latest.evidence.issues=[];
  const g=reviewEvidenceGraph("tenant",[old,latest]);
  expect(g.edges.some(e=>e.relation==="requires_review")).toBe(false);
  expect(g.edges).toContainEqual(expect.objectContaining({from:"source-check:new",relation:"supersedes",to:"source-check:old"}));
  expect(g.nodes.find(n=>n.id==="source-check:old")?.state).toBe("superseded");
  expect(g.nodes.find(n=>n.id==="source-check:new")?.state).toBe("current");
});
it("does not supersede different sources or reporting months",()=>{
  const g=reviewEvidenceGraph("tenant",[batch("oct","2026-11-01T01:00:00Z"),batch("sep","2026-11-01T02:00:00Z","makeedu","2026-09"),batch("ecount","2026-11-01T03:00:00Z","ecount")]);
  expect(g.edges.filter(e=>e.relation==="has_current_source_comparison")).toHaveLength(3);
  expect(g.edges.some(e=>e.relation==="supersedes")).toBe(false);
});
it("preserves review evidence and version order, without converting a note into approval",()=>{
  const b=batch("a","2026-11-01T01:00:00Z");
  const event=(version:number,note:string):ReviewEvent=>({batch_id:"a",issue_key:"identity",version,status:"recheck",owner:"",due_date:null,note,created_at:`2026-11-01T0${version}:00:00Z`});
  b.events=[event(2,"9월까지 마감 확인; 분류 대사는 별도"),event(1,"원본 확인 중"),{...event(3,"다른 항목"),issue_key:"unrelated"},{...event(4,"다른 배치"),batch_id:"other"}];
  const g=reviewEvidenceGraph("tenant",[b]);
  expect(g.nodes.filter(n=>n.type==="ReviewAction")).toHaveLength(2);
  expect(g.nodes.find(n=>n.id==="review-action:a:identity:2")).toMatchObject({detail:b.events[0]!.note,state:"recheck"});
  expect(g.edges.find(e=>e.relation==="latest_review_action")?.to).toBe("review-action:a:identity:2");
  expect(g.edges.some(e=>e.relation==="requires_review")).toBe(true);
  const ids=new Set(["tenant:tenant",...g.nodes.map(n=>n.id)]);expect(ids.size).toBe(g.nodes.length+1);
  expect(g.edges.every(e=>ids.has(e.from)&&ids.has(e.to))).toBe(true);
});
