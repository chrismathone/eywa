import { describe,it,expect } from "vitest";
import { FACTORS,AXES,analyzeFactors,resolveObservations,factorGraph,factorScore,validateValue,validMonth,type Observation,type FactorRecord } from "./factors";
function full():Observation[]{return FACTORS.map(f=>({factorId:f.id,value:f.cap?(f.inverse?0:f.cap):"확인된 맥락",state:"measured",source:"manual",evidence:"확인 근거",refs:[],version:1}));}
describe("42팩터 정의와 산출",()=>{
 it("원본 ID 42개를 빠짐없이 보존하고 주거 유형은 참고로 분리한다",()=>{
   expect(FACTORS.map(f=>f.id)).toEqual(Array.from({length:42},(_,i)=>`F${String(i+1).padStart(2,"0")}`));
   expect(FACTORS.filter(f=>f.cap)).toHaveLength(24);expect(FACTORS.find(f=>f.id==="F18")?.cap).toBeUndefined();
   expect(AXES.filter(a=>!a.cost).reduce((s,a)=>s+a.weight,0)).toBe(100);
 });
 it("미측정을 0점으로 확정하지 않으며 전체 공란은 0~100 산출 대기다",()=>{
   expect(analyzeFactors([])).toMatchObject({score:null,lower:0,upper:100,known:0,total:24});
   const rows=full();rows.find(o=>o.factorId==="F01")!.state="partial";
   const result=analyzeFactors(rows);expect(result.score).toBeNull();expect(result.upper-result.lower).toBeCloseTo(4);
 });
 it("비용·리스크를 차감하며 음수 환불과 100점 상한을 처리한다",()=>{
   const rows=full();expect(analyzeFactors(rows).score).toBeCloseTo(75);
   for(const row of rows){const f=FACTORS.find(f=>f.id===row.factorId)!;if(["A5","A6"].includes(f.axis)&&f.cap)row.value=0;}
   expect(analyzeFactors(rows).score).toBe(100);
   expect(factorScore(FACTORS[0],-50000)).toBe(0);expect(factorScore(FACTORS[0],900000)).toBe(100);
   for(const row of rows){const f=FACTORS.find(f=>f.id===row.factorId)!;if(f.cap)row.value=f.inverse?f.cap:0;}
   expect(analyzeFactors(rows).score).toBe(0);
 });
 it("해당 없음은 분모에서 제외하되 축 전체를 제외하면 종합은 보류한다",()=>{
   const rows=full();rows[0].state="na";expect(analyzeFactors(rows).total).toBe(23);
   rows.filter(r=>FACTORS.find(f=>f.id===r.factorId)!.axis==="A1").forEach(r=>r.state="na");
   expect(analyzeFactors(rows).score).toBeNull();
 });
 it("범위·소수 허용·유효하지 않은 월을 검증한다",()=>{
   expect(validateValue(FACTORS[0],NaN)).toBe(false);expect(validateValue(FACTORS[1],1.5)).toBe(false);
   expect(validateValue(FACTORS[7],101)).toBe(false);expect(validateValue(FACTORS[7],0)).toBe(true);
   expect(validateValue(FACTORS[17],"저소득" )).toBe(false);expect(validMonth("2026-13")).toBe(false);
 });
});
describe("학생 중심 근거와 변경 이력",()=>{
 const auto:Observation={factorId:"F01",value:120000,state:"measured",source:"auto",evidence:"청구 1건",refs:[{table:"invoices",id:"invoice-a"}],version:0};
 const rec:FactorRecord={id:"record-a",factor_id:"F01",value:0,state:"measured",evidence:"전액 환불 대사 완료",version:1,recorded_at:"2026-11-03T00:00:00Z",actor_id:"actor"};
 it("담당자가 확인한 0도 자동값보다 우선하며 reset은 원기록으로 복원한다",()=>{
   expect(resolveObservations([auto],[rec])[0]).toMatchObject({value:0,source:"manual",version:1});
   expect(resolveObservations([auto],[{...rec,id:"reset",state:"reset",value:null,version:2},rec])[0]).toMatchObject({value:120000,source:"auto",version:2});
 });
 it("학생 ID부터 관측·팩터·축·원기록까지 단절 없이 연결한다",()=>{
   const g=factorGraph("student-a","2026-11",resolveObservations([auto],[rec]));
   expect(g.edges).toContainEqual({from:"student:student-a",to:"observation:student-a:2026-11:F01",relation:"hasObservation"});
   expect(g.edges).toContainEqual({from:"observation:student-a:2026-11:F01",to:"student_contribution_factor_records:record-a",relation:"evidencedBy"});
   expect(g.nodes.filter(n=>n.kind==="observation")).toHaveLength(1);
   expect(g.edges.every(e=>g.nodes.some(n=>n.id===e.from)&&g.nodes.some(n=>n.id===e.to))).toBe(true);
 });
});
