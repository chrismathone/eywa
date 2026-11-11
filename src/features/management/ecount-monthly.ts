import {createHash} from "node:crypto";
import {ManagementInputError} from "./errors";
import ExcelJS from "exceljs";
import {validateZipSize} from "./ecount";
import {accountingTotals,dateSchema,periodBounds,type StoredReport} from "./model";
import {sourceEvidenceSchema,type SourceEvidence} from "./reviews";

export type MonthlyProfit={company:string;month:string;revenue:number;cost:number;profit:number;visibleRevenue:number;visibleCost:number;reference:string;nonOperatingIncome:number|null;nonOperatingCost:number|null;profitBeforeTax:number|null};
const compact=(v:string)=>v.replace(/\s/g,"");
function money(c:ExcelJS.Cell){const v=c.value;if(v===null||v===undefined||v==="")return 0;if(typeof v!=="number"||!Number.isSafeInteger(v)||Math.abs(v)>1e12)throw new ManagementInputError(`${c.address}: 숫자로 저장된 월별 금액이 필요합니다`);return v;}
function requiredMoney(c:ExcelJS.Cell){if(c.value===null||c.value===undefined||c.value==="")throw new ManagementInputError(`${c.address}: 표시 합계가 비어 있습니다`);return money(c);}
export async function parseEcountMonthly(buffer:Buffer){
  if(buffer.length>5*1024*1024)throw new ManagementInputError("5MB 이하 파일을 선택해 주세요");validateZipSize(buffer);
  const book=new ExcelJS.Workbook();await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]);
  const sheet=book.worksheets.find(s=>compact(s.name)==="월별손익분석");
  if(!sheet||sheet.rowCount>1000||sheet.columnCount>62)throw new ManagementInputError("ECOUNT 월별손익분석 엑셀을 선택해 주세요");
  const h=sheet.getCell("A1").text.match(/^회사명\s*:\s*(.+?)\s*\/\s*(\d{4}\/\d{2}\/\d{2})\s*~\s*(\d{4}\/\d{2}\/\d{2})\s*$/);
  if(!h)throw new ManagementInputError("회사명·조회기간을 확인할 수 없습니다");
  const start=dateSchema.parse(h[2]!.replaceAll("/","-")),end=dateSchema.parse(h[3]!.replaceAll("/","-"));
  if(start>end||!start.endsWith("-01")||periodBounds(end.slice(0,7)).end!==end)throw new ManagementInputError("월 전체가 포함된 기간으로 출력해 주세요");
  const docs:MonthlyProfit[]=[];
  for(let col=2;col<=sheet.columnCount;col++){
    const label=sheet.getCell(2,col).text.trim();if(label==="집계"||label==="")continue;
    const m=label.match(/^(20\d{2})년\s*(\d{1,2})월$/);if(!m)throw new ManagementInputError("월별 열 제목을 확인해 주세요");
    const month=`${m[1]}-${m[2]!.padStart(2,"0")}`;periodBounds(month);
    if(month<start.slice(0,7)||month>end.slice(0,7)||docs.some(d=>d.month===month))throw new ManagementInputError("중복 또는 조회기간 밖 월이 있습니다");
    let revenue:number|null=null,cost=0,costSections=0,profit:number|null=null,visibleRevenue=0,visibleCost=0,section="other";
    let nonOperatingIncome:number|null=null,nonOperatingCost:number|null=null,profitBeforeTax:number|null=null;
    for(let row=3;row<=sheet.rowCount;row++){
      const name=compact(sheet.getCell(row,1).text);if(!name)continue;
      if(/^\d+\./.test(name)){
        if(/^\d+\.매출$/.test(name)){if(revenue!==null)throw new ManagementInputError("매출 합계가 중복되었습니다");revenue=requiredMoney(sheet.getCell(row,col));section="revenue";}
        else if(/매출원가|판매비.*관리비/.test(name)){cost+=requiredMoney(sheet.getCell(row,col));costSections++;section="cost";}
        else if(/영업(손익|이익)/.test(name)){if(profit!==null)throw new ManagementInputError("영업손익이 중복되었습니다");profit=requiredMoney(sheet.getCell(row,col));section="other";}
        else if(/영업외수익/.test(name)){if(nonOperatingIncome!==null)throw new ManagementInputError("영업외수익 중복");nonOperatingIncome=money(sheet.getCell(row,col));section="other";}
        else if(/영업외비용/.test(name)){if(nonOperatingCost!==null)throw new ManagementInputError("영업외비용 중복");nonOperatingCost=money(sheet.getCell(row,col));section="other";}
        else if(/법인세.*차감전/.test(name)){if(profitBeforeTax!==null)throw new ManagementInputError("세전손익 중복");profitBeforeTax=requiredMoney(sheet.getCell(row,col));section="other";}
        else section="other";
      }else if(section==="revenue")visibleRevenue+=money(sheet.getCell(row,col));
      else if(section==="cost")visibleCost+=money(sheet.getCell(row,col));
    }
    if(revenue===null||profit===null||!costSections)throw new ManagementInputError("매출·영업비용·영업손익 합계가 모두 필요합니다");
    docs.push({company:h[1]!.trim(),month,revenue,cost,profit,visibleRevenue,visibleCost,nonOperatingIncome,nonOperatingCost,profitBeforeTax,reference:`${sheet.name}!${sheet.getColumn(col).letter}3:${sheet.getColumn(col).letter}${sheet.rowCount}`});
  }
  const expected=(Number(end.slice(0,4))-Number(start.slice(0,4)))*12+Number(end.slice(5,7))-Number(start.slice(5,7))+1;
  if(docs.length!==expected)throw new ManagementInputError("조회기간에 빠진 월이 있습니다");
  return {documents:docs,sourceHash:createHash("sha256").update(buffer).digest("hex")};
}
export function compareEcountMonthly(p:MonthlyProfit,report:StoredReport,sourceName:string,sourceHash:string):SourceEvidence{
  const d=report.document,bounds=periodBounds(p.month);
  if(d.sourceKind!=="ledger"||d.start!==bounds.start||d.end!==bounds.end||compact(d.company)!==compact(p.company))throw new ManagementInputError(`${p.month}: 같은 회사·월의 원장을 먼저 저장해 주세요`);
  const totals=accountingTotals(d),issues:SourceEvidence["issues"]=[];
  const add=(key:string,title:string,detail:string,nextAction:string)=>issues.push({key,title,detail,nextAction,href:"/dashboard/management#accounting"});
  if(p.revenue!==totals.revenue)add("revenue_difference","매출 분류 대사",`월별 보고서 ${p.revenue.toLocaleString()}원, 원장 분류 합계 ${totals.revenue.toLocaleString()}원. 차이 ${ (p.revenue-totals.revenue).toLocaleString()}원.`,"보고서 계정 설정과 원장 매출 계정의 포함 범위를 확인해 주세요.");
  if(p.cost!==totals.cost){const vehicle=d.lines.find(l=>l.account.startsWith("100200 "))?.amount;
    add("cost_difference","영업비용 분류 대사",`월별 보고서 ${p.cost.toLocaleString()}원, 원장 분류 합계 ${totals.cost.toLocaleString()}원. 차이 ${(p.cost-totals.cost).toLocaleString()}원.${vehicle===p.cost-totals.cost?" 차이 금액이 미분류 법인차량할부금 계정과 같습니다. 동일 금액만으로 회계 처리를 확정하지 않습니다.":""}`,"미분류 계정, 비용 상계, 보고서 표시 계정을 확인해 주세요. 할부금은 원금·이자 구분을 확인한 후 분류합니다.");}
  if(p.visibleCost!==p.cost||p.visibleRevenue!==p.revenue)add("report_detail","보고서 상세 표시 범위 확인",`표시 합계−보이는 상세: 매출 ${(p.revenue-p.visibleRevenue).toLocaleString()}원, 비용 ${(p.cost-p.visibleCost).toLocaleString()}원.`,"ECOUNT 보고서 양식에서 숨겨진 계정과 집계 범위를 확인해 주세요. 파일 손상으로 단정하지 않습니다.");
  if(p.revenue-p.cost!==p.profit)add("arithmetic","보고서 영업손익 산식 확인","보고서 매출−영업비용과 표시 영업손익이 다릅니다.","같은 조건으로 보고서를 다시 출력하고 합계를 확인해 주세요.");
  for(const w of d.ledgerInfo?.warnings.filter(x=>x.includes("급여 거래가 없는"))??[])add("payroll_period","급여 귀속월 확인",w,"급여 누락인지 지급일·귀속월 차이인지 확인하고 마감 자료를 준비해 주세요.");
  add("business_scope","학원과 다른 사업 구분","회사 전체 보고서에 임대·관리비 등 다른 사업이 포함될 수 있습니다.","학원 직접 수익·비용과 공통비 배부 기준을 정하고 회계 담당자의 확인을 남겨 주세요.");
  add("monthly_close","월 마감 확인","수치가 일치해도 원장과 보고서의 마감 여부는 별도 확인이 필요합니다.","월 마감 확인 자료와 근거를 기록한 뒤 확정 손익 자료로 다시 검산해 주세요.");
  return sourceEvidenceSchema.parse({source:"ecount",month:p.month,sourceName,sourceHash,comparedHash:createHash("sha256").update(JSON.stringify(d)).digest("hex"),observedAt:new Date().toISOString(),summary:"ECOUNT 월별손익분석과 저장된 원장의 비교입니다. 확정 손익을 대체하지 않습니다.",facts:[{label:"매출 합계",sourceValue:p.revenue,aywaValue:totals.revenue,unit:"원",reference:p.reference},{label:"영업비용 합계",sourceValue:p.cost,aywaValue:totals.cost,unit:"원",reference:p.reference},{label:"보고서 표시 영업손익",sourceValue:p.profit,aywaValue:null,unit:"원",reference:p.reference}],issues});
}
