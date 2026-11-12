import {describe,it,expect} from "vitest";
import {parseEcountLedger,readLedgerCsv} from "./ecount-ledger";
import {accountingSchema,accountingTotals,reclassifyLine} from "./model";
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
 it("계정의 방향은 달마다가 아니라 계정 단위로 정한다 — 분류표에 없는 대변 계정의 취소 달도 같은 방향(음수)",()=>{
  const account=(code:string,name:string,credit:boolean,opening:number)=>{
    // 1월 +100, 2월 취소 −100(반대쪽 거래) — 잔액은 정상 방향으로 늘었다 줄어든다.
    const jan=credit?['0','100']:['100','0'],feb=credit?['100','0']:['0','100'];
    return [
      `"회사명 : 테스트 회사 / 2026/01/01 ~ 2026/02/28 / 계정별원장 / ${code}(${name})"`,
      '"일자-No.","적요","거래처명","차변금액","대변금액","잔액"',
      `"","이월잔액","","${credit?0:opening}","${credit?opening:0}","${opening}"`,
      `"2026/01/10 -1","발생","","${jan[0]}","${jan[1]}","${opening+100}"`,
      `"2026/02/10 -1","취소","","${feb[0]}","${feb[1]}","${opening}"`,
      `"","","","${credit?100:opening+100}","${credit?opening+100:100}","${opening}","합계"`,
      '"2026/03/01 오후 9:13:02"','',
    ].join('\n');
  };
  const p=parseEcountLedger(Buffer.from(account("999999","모르는 수익",true,1000)+account("1039","보통예금",false,500)),"ledger.csv");
  expect(p.summary.controlsMatched).toBe(true);expect(p.documents.map(d=>d.start)).toEqual(["2026-01-01","2026-02-01"]);
  const line=(i:number,code:string)=>p.documents[i]!.lines.find(l=>l.account.startsWith(code))!;
  expect(line(0,"999999")).toMatchObject({category:"exclude",debit:0,credit:100,normal:"credit",amount:100});
  expect(line(1,"999999")).toMatchObject({category:"exclude",debit:100,credit:0,normal:"credit",amount:-100});
  expect(reclassifyLine(line(1,"999999"),"revenue").amount).toBe(-100);expect(reclassifyLine(line(0,"999999"),"revenue").amount).toBe(100);
  // 분류표에 있는 차변 계정(자산)은 잔액 검산으로 차변 — 취소 달은 음수.
  expect(line(0,"1039")).toMatchObject({normal:"debit",amount:100});expect(line(1,"1039")).toMatchObject({normal:"debit",amount:-100});
  for(const d of p.documents)expect(accountingSchema.safeParse({...d,scopeConfirmed:true}).success).toBe(true);
 });
 it("분류표의 비용 계정이 대변 잔액이어도 금액은 저장 검증과 같은 식(차변 순액) — 저장이 거절되지 않는다",()=>{
  // 8249(임차료)인데 대변으로 100이 실리고 잔액도 대변으로 는다(환입·대체) — 비용 −100으로 읽고 스키마를 통과해야 한다.
  const text=section("8249","임차료",0,100,true)+section("1039","보통예금",500,100,false);
  const p=parseEcountLedger(Buffer.from(text),"ledger.csv"),rent=p.documents[0]!.lines.find(l=>l.account.startsWith("8249"))!;
  expect(rent).toMatchObject({category:"rent",debit:0,credit:100,normal:"credit",amount:-100});
  expect(accountingSchema.safeParse({...p.documents[0],scopeConfirmed:true}).success).toBe(true);
  expect(reclassifyLine(rent,"nonoperating").amount).toBe(100);expect(reclassifyLine(reclassifyLine(rent,"nonoperating"),"rent")).toEqual(rent);
 });
 it("분류표에 없고 잔액 검산도 안 맞는 계정은 차·대 합계가 같아도 방향 경고에 올린다",()=>{
  const broken=[
   '"회사명 : 테스트 회사 / 2026/01/01 ~ 2026/02/28 / 계정별원장 / 999999(모르는 계정)"',
   '"일자-No.","적요","거래처명","차변금액","대변금액","잔액"',
   '"","이월잔액","","0","0","0"',
   '"2026/01/10 -1","발생","","0","100","7"',
   '"2026/02/10 -1","취소","","100","0","9"',
   '"","","","100","100","9","합계"','',
  ].join('\n');
  const p=parseEcountLedger(Buffer.from(broken),"ledger.csv");
  expect(p.summary.controlsMatched).toBe(false);
  expect(p.summary.warnings.some(w=>w.includes("방향을 잔액으로 확인하지 못한 계정: 999999"))).toBe(true);
 });
});
