import { describe, it, expect } from "vitest";
import { buildFamilyLoyalty, familyBonus, loyaltyTotal, unknownFamily, type FamilyStudent } from "./family-loyalty";
import { DEFAULT_CONFIG, contributionConfigSchema, emptyRaws } from "./config";
import { FACTORS, AXES, factorScore, analyzeFactors } from "./factors";
import { relativeRows } from "./relative-score";
const day = "2026-11-09";
const person = (id: string, extra: Partial<FamilyStudent> = {}): FamilyStudent => ({ id, name: `Student ${id}`, status: "enrolled", parent_name: null, parent_phone: "010-1234-5678", enrolled_at: "2025-01-01", withdrawn_at: null, ...extra });
const three = [person("a"),person("b"),person("c")];
const calculate = (students = three, active = new Set(students.map(s=>s.id))) => buildFamilyLoyalty("a",students,[],active,day);
describe("current family loyalty",()=>{
  it("three siblings each receive one family bonus; duplicate courses cannot multiply it",()=>{
    const f=calculate();expect(f).toMatchObject({activeCount:3,activeSiblings:2,selfActive:true});
    // 가족 가점 = 형제 수 기본(셋 250) + 함께 다닌 형제 재원기간 합(2025-01~2026-11-09 = 23개월 × 2명) × 개월당 2점(원장 2026-11-09).
    expect(f.siblingMonths).toBe(46);expect(familyBonus(f,DEFAULT_CONFIG)).toBe(250+46*2);expect(loyaltyTotal(172.41,f,DEFAULT_CONFIG)).toBe(514.41);
    expect(calculate([...three,three[1]])).toEqual(f);
    expect(loyaltyTotal(172.41,f,DEFAULT_CONFIG)).toBe(loyaltyTotal(172.41,calculate(),DEFAULT_CONFIG));
  });
  it("recounts when a sibling withdraws, holds or starts in the future, and removes bonus for a nonactive subject",()=>{
    expect(familyBonus(calculate([three[0],three[1],person("c",{status:"withdrawn"})]),DEFAULT_CONFIG)).toBe(100+23*2);
    expect(familyBonus(calculate(three,new Set(["a","b"])),DEFAULT_CONFIG)).toBe(100+23*2);
    expect(familyBonus(calculate([three[0],three[1],person("c",{enrolled_at:"2026-12-01"})]),DEFAULT_CONFIG)).toBe(100+23*2);
    expect(familyBonus(calculate(three,new Set(["b","c"])),DEFAULT_CONFIG)).toBe(0);
  });
  it("manual exclusions override phone matches; names alone and duplicate identities never earn points",()=>{
    const f=buildFamilyLoyalty("a",three,[{student_a:"a",student_b:"c",linked:false}],new Set(["a","b","c"]),day);
    expect(f.activeCount).toBe(2);
    const names=[person("a",{parent_name:"보호자",parent_phone:null}),person("b",{parent_name:"보호자",parent_phone:null})];
    expect(calculate(names)).toMatchObject({activeCount:1,needsReview:1});
    expect(calculate([person("a",{name:"김학생"}),person("b",{name:"김학생A"})]).activeCount).toBe(1);
    expect(buildFamilyLoyalty("a",names,[{student_a:"a",student_b:"b",linked:true}],new Set(["a","b"]),day).activeCount).toBe(2);
  });
  it("unavailable or unauthorized family facts withhold totals, not silently zero; missing activity also withholds",()=>{
    expect(loyaltyTotal(20,unknownFamily(day),DEFAULT_CONFIG)).toBeNull();
    expect(loyaltyTotal(20,unknownFamily(day,"restricted"),DEFAULT_CONFIG)).toBeNull();
    expect(loyaltyTotal(null,calculate(),DEFAULT_CONFIG)).toBeNull();
  });
  it("family settings round-trip and reject descending or nonfinite weights",()=>{
    const c=contributionConfigSchema.parse({...DEFAULT_CONFIG,family:{enabled:true,two:80,three:240,fourPlus:500}});
    expect(familyBonus(calculate(),c)).toBe(240+46*2);
    expect(()=>contributionConfigSchema.parse({...c,family:{...c.family,three:10}})).toThrow();
    expect(()=>contributionConfigSchema.parse({...c,family:{...c.family,two:NaN}})).toThrow();
    const old={...DEFAULT_CONFIG};delete old.family;expect(familyBonus(calculate(),contributionConfigSchema.parse(old))).toBe(250+46*2);
  });
  it("current family bonus changes overall ranking score but never recent activity",()=>{
    const raw={...emptyRaws(),tenureYears:2};
    const rows=relativeRows([{id:"a",status:"enrolled",grade:null,enrolledMonths:24,family:calculate(),total:{raws:raw,recent:raw,unavailable:[]}}],DEFAULT_CONFIG);
    expect(rows[0]).toMatchObject({total:10+250+46*2,recent:10});
  });
  it("F13 is the largest individual precision weight; three children earn 35/100 and all positives still sum to 100",()=>{
    const f=FACTORS.find(f=>f.id==="F13")!,axis=AXES.find(a=>a.id===f.axis)!;
    expect(axis.weight).toBe(40);expect(factorScore(f,2)!*axis.weight/100).toBe(35);
    for(const a of AXES.filter(a=>!a.cost&&a.id!==axis.id))expect(a.weight).toBeLessThan(axis.weight);
    expect(analyzeFactors([])).toMatchObject({score:null,lower:0,upper:100});
    expect([0,1,2,3,9].map(n=>factorScore(f,n))).toEqual([0,50,87.5,100,100]);
  });
});
