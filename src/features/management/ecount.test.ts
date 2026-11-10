import {describe,it,expect} from "vitest";
import ExcelJS from "exceljs";
import {parseEcountProfitLoss} from "./ecount";
async function workbook(mismatch=false){const book=new ExcelJS.Workbook(),s=book.addWorksheet("손익계산서");s.getCell("A1").value="회사명 : 테스트 / 2026/01/01 ~ 2026/07/31";s.addRow([]);s.addRow(["1. 매 출",null,1000,null,9000]);s.addRow(["수강료",1000,null,9000]);s.addRow(["비어있는 이번 기수",null,null,8000]);s.addRow(["4. 판매비 및 관리비",null,700]);s.addRow(["급여",300]);s.addRow(["급여",400]);s.addRow(["5. 영 업 손 익",null,mismatch?250:300]);s.addRow(["6. 영업외수익",null,999]);s.addRow(["이자",999]);return Buffer.from(await book.xlsx.writeBuffer());}
describe("ECOUNT original current-period columns",()=>{
  it("ignores prior comparison columns and preserves duplicate account names as separate source rows",async()=>{const r=await parseEcountProfitLoss(await workbook(),"test.xlsx");expect(r.end).toBe("2026-07-31");expect(r.reportedRevenue).toBe(1000);expect(r.reportedOperatingProfit).toBe(300);expect(r.lines.filter(l=>l.category==="labor")).toHaveLength(2);expect(r.lines.some(l=>l.amount===8000||l.amount===9000)).toBe(false);expect(r.scopeConfirmed).toBe(false);});
  it("preserves unreconciled reports as incomplete without a balancing entry",async()=>{const r=await parseEcountProfitLoss(await workbook(true),"test.xlsx");expect(r.complete).toBe(false);expect(r.reportedOperatingProfit).toBe(250);expect(r.lines.filter(l=>l.category==="revenue")).toHaveLength(1);});
});
