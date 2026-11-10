import {describe,it,expect} from "vitest";
import {accountingSchema,accountingTotals,revenueBridge,hiringScenario,periodBounds,reclassifyLine,type AccountingReport} from "./model";
import {invoiceMetrics,type Invoice} from "./invoice-metrics";
const report:AccountingReport={company:"테스트 학원",start:"2026-10-01",end:"2026-10-31",sourceName:"test.xlsx",sourceHash:"a".repeat(64),scopeConfirmed:true,complete:true,reportedRevenue:1000,reportedOperatingCost:800,reportedOperatingProfit:200,lines:[{key:"1",account:"수강료",amount:1000,category:"revenue",sourceCell:"B4"},{key:"2",account:"급여",amount:600,category:"labor",sourceCell:"B5"},{key:"3",account:"임차료",amount:200,category:"rent",sourceCell:"B6"}]};
const inv=(id:string,student:string,amount:number,status="unpaid"):Invoice=>({id,student_id:student,period:"2026-10",amount_total:amount,amount_discount:0,amount_paid:0,status,category:null,updated_at:"2026-10-31"});
describe("management financial definitions",()=>{
  it("unknown/incomplete/mismatched reports never produce a profit ratio",()=>{expect(accountingTotals(report).margin).toBe(20);expect(accountingTotals({...report,reportedOperatingCost:null}).margin).toBeNull();expect(accountingTotals({...report,complete:false}).margin).toBeNull();expect(accountingTotals({...report,reportedOperatingCost:700}).margin).toBeNull();});
  it("validates period, provenance and unique source rows",()=>{expect(accountingSchema.safeParse({...report,end:"2026-09-30"}).success).toBe(false);expect(accountingSchema.safeParse({...report,lines:[...report.lines,report.lines[0]]}).success).toBe(false);expect(accountingSchema.safeParse({...report,scopeConfirmed:false}).success).toBe(false);});
  it("deduplicates invoices and excludes voids, without calling paid amount cash flow",()=>{const a=inv("1","s1",300);const totals=invoiceMetrics([a,a,inv("2","s1",200),inv("3","s2",900,"void")]);expect(totals.net).toBe(500);expect(totals.students).toBe(1);expect(totals.collected).toBe(0);});
  it("decomposes both changing students and fees exactly",()=>{const a=invoiceMetrics([inv("1","s1",300),inv("2","s2",300)]),b=invoiceMetrics([inv("3","s1",400),inv("4","s2",400),inv("5","s3",400)]);const bridge=revenueBridge(a,b)!;expect(bridge.studentsEffect+bridge.perStudentEffect).toBeCloseTo(600);expect(revenueBridge(invoiceMetrics([]),b)).toBeNull();});
  it("uses added contribution to calculate hiring break-even and target",()=>{const r=hiringScenario({revenue:1000,cost:800,labor:600,additionalMonthlyCost:300,additionalStudents:4,netFee:100,variableCostPerStudent:20,targetMargin:20});expect(r.breakEvenNewStudents).toBe(4);expect(r.studentsForTarget).toBe(5);expect(r.profit).toBe(220);expect(r.margin).toBeCloseTo(220/1400*100);});
  it("does not divide by nonpositive student contribution",()=>{expect(hiringScenario({revenue:1000,cost:800,labor:600,additionalMonthlyCost:300,additionalStudents:0,netFee:10,variableCostPerStudent:20,targetMargin:20}).breakEvenNewStudents).toBeNull();});
  it("handles calendar boundaries",()=>{expect(periodBounds("2026-01").previous).toBe("2025-12");expect(periodBounds("2024-02").end).toBe("2024-02-29");});
  it("분류를 바꾸면 차변·대변 원액에서 금액을 다시 계산한다(미분류 대변 100 → 매출 +100 · 비용이면 −100)",()=>{
    const line={key:"k",account:"999999 모름",category:"exclude" as const,amount:100,sourceCell:"c",debit:0,credit:100,normal:"credit" as const};
    expect(reclassifyLine(line,"revenue")).toMatchObject({category:"revenue",amount:100,normal:"credit"});
    expect(reclassifyLine(line,"operating")).toMatchObject({category:"operating",amount:-100,normal:"credit"});
    // 분류를 오가도 같은 분류면 같은 금액(원본 방향은 바뀌지 않는다)
    expect(reclassifyLine(reclassifyLine(line,"operating"),"nonoperating")).toEqual(reclassifyLine(line,"nonoperating"));
    expect(reclassifyLine(reclassifyLine(line,"labor"),"exclude")).toEqual(line);
    expect(reclassifyLine({...line,debit:300,credit:0,normal:"debit",amount:300},"revenue").amount).toBe(-300);
    const plain={key:"p",account:"급여",category:"labor" as const,amount:600,sourceCell:"B5"};
    expect(reclassifyLine(plain,"operating")).toEqual({...plain,category:"operating"});
  });
  it("원액과 맞지 않는 금액은 저장 검증에서 거절한다",()=>{
    const ledger={...report,complete:false,sourceKind:"ledger" as const,ledgerInfo:{sourceStart:"2026-10-01",sourceEnd:"2026-10-31",accountCount:1,transactionCount:1,totalTransactionCount:1,controlsMatched:true,unclassifiedCodes:[],warnings:[]}};
    const line={key:"k",account:"400010 수강료",category:"revenue" as const,sourceCell:"c",debit:0,credit:100,normal:"credit" as const};
    expect(accountingSchema.safeParse({...ledger,lines:[{...line,amount:100}]}).success).toBe(true);
    expect(accountingSchema.safeParse({...ledger,lines:[{...line,amount:-100}]}).success).toBe(false);
    expect(accountingSchema.safeParse({...ledger,lines:[{...line,amount:100,credit:undefined}]}).success).toBe(false);
  });
});
