import {describe,it,expect} from "vitest";
import {parseEcountLedger,readLedgerCsv} from "./ecount-ledger";
import {accountingSchema,accountingTotals} from "./model";
const section=(code:string,name:string,opening:number,amount:number,credit:boolean)=>[
 `"회사명 : 테스트 회사 / 2026/01/01 ~ 2026/02/28 / 계정별원장 / ${code}(${name})"`,
 '"일자-No.","적요","거래처명","차변금액","대변금액","잔액"',
 `"","이월잔액","","${credit?0:opening}","${credit?opening:0}","${opening}"`,
 `"2026/01/10 -1","쉼표, 줄\n바꿈","","${credit?0:amount}","${credit?amount:0}","${opening+amount}"`,
 `"","","","${credit?0:opening+amount}","${credit?opening+amount:0}","${opening+amount}","합계"`,
 '"2026/03/01 오후 9:13:02"','',
].join('\n');
const fixture=()=>section("400010","수강료 매출",1000,100,true)+section("1039","보통예금",500,100,false);
describe("ECOUNT ledger boundaries",()=>{
 it("keeps quoted newlines and empty CSV records for reliable source positions",()=>{expect(readLedgerCsv('"a\nb",c\n\n"d""e",f')).toEqual([["a\nb","c"],[""],['d"e',"f"]]);});
 it("excludes opening and totals, balances both sides, and never certifies monthly profit",()=>{
  const p=parseEcountLedger(Buffer.from(fixture()),"ledger.csv");expect(p.summary).toMatchObject({transactionCount:2,debit:100,credit:100,controlsMatched:true});
  expect(p.documents).toHaveLength(1);const d=accountingSchema.parse({...p.documents[0],scopeConfirmed:true});expect(accountingTotals(d)).toMatchObject({revenue:100,ready:false,margin:null});
  expect(d.lines[0]!.sourceCell).toContain("records 4..4");expect(()=>accountingSchema.parse({...d,complete:true,reportedRevenue:100,reportedOperatingCost:0,reportedOperatingProfit:100})).toThrow();
 });
 it("retains reversal sign",()=>{const p=parseEcountLedger(Buffer.from(section("400010","수강료 매출",1000,-100,true)+section("1039","보통예금",500,-100,false)),"ledger.csv");expect(p.documents[0]!.lines[0]!.amount).toBe(-100);expect(p.summary.controlsMatched).toBe(true);});
 it("quarantines mismatched control totals",()=>{const p=parseEcountLedger(Buffer.from(fixture().replace('"1100","1100","합계"','"1101","1100","합계"')),"ledger.csv");expect(p.summary.controlsMatched).toBe(false);expect(p.documents[0]!.complete).toBe(false);});
 it("does not silently classify unknown account codes as expenses",()=>{const p=parseEcountLedger(Buffer.from(fixture().replace("400010(수강료 매출)","999999(알 수 없는 계정)")),"ledger.csv");expect(p.documents[0]!.ledgerInfo!.unclassifiedCodes).toEqual(["999999"]);expect(p.documents[0]!.lines[0]!.category).toBe("exclude");});
 it("rejects duplicate sections, changed company, out-of-range and malformed records",()=>{
  for(const text of [fixture()+section("400010","수강료 매출",0,0,true),fixture().replace("테스트 회사","다른 회사"),fixture().replace("2026/01/10 -1","2025/12/31 -1"),fixture()+'"알 수 없는 행"'])expect(()=>parseEcountLedger(Buffer.from(text),"ledger.csv")).toThrow();
 });
});
