import { createHash } from "node:crypto";
import {ManagementInputError} from "./errors";
import ExcelJS from "exceljs";
import { accountingTotals, type AccountingDraft, type AccountingReport } from "./model";

const compact=(s:string)=>s.replace(/\s+/g,"");
function text(value:ExcelJS.CellValue):string {
  if(value===null||value===undefined)return "";
  if(typeof value==="object" && "richText" in value)return value.richText.map(v=>v.text).join("");
  if(typeof value==="object" && "result" in value)return text(value.result??null);
  return String(value);
}
function amount(cell:ExcelJS.Cell):number|null {
  const raw=text(cell.value).trim();
  if(!raw)return null;
  const normalized=raw.replace(/,/g,"").replace(/^\((.*)\)$/,"-$1");
  const n=Number(normalized);
  if(!Number.isSafeInteger(n)||Math.abs(n)>1e12)throw new ManagementInputError(`${cell.address}: 금액을 읽지 못했습니다. 수식은 계산 후 저장해 주세요.`);
  return n;
}
function category(label:string,section:"revenue"|"cost"|"nonoperating") {
  if(section!=="cost")return section;
  if(/급여|상여|보험료.*4대|4대보험|퇴직|복리후생|외부강사/.test(label))return "labor";
  if(/광고|홍보|설명회|마케팅/.test(label))return "marketing";
  if(/임차료|임대료/.test(label))return "rent";
  return "operating";
}
/** ECOUNT P&L: current detail=B / current subtotal=C. Comparison D/E never enter current totals. */
export async function parseEcountProfitLoss(buffer:Buffer,sourceName:string):Promise<AccountingDraft> {
  if(buffer.length>5*1024*1024)throw new ManagementInputError("엑셀은 5MB 이하로 올려 주세요");
  validateZipSize(buffer);
  const book=new ExcelJS.Workbook();
  await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]);
  const sheet=book.worksheets.find(s=>compact(s.name).includes("손익계산서"));
  if(!sheet || sheet.rowCount>3000)throw new ManagementInputError("ECOUNT 손익계산서 양식(.xlsx)을 확인해 주세요");
  const header=text(sheet.getCell("A1").value);
  const match=header.match(/회사명\s*:\s*(.+?)\s*\/\s*(\d{4})\/(\d{2})\/(\d{2})\s*~\s*(\d{4})\/(\d{2})\/(\d{2})/);
  if(!match)throw new ManagementInputError("회사명과 시작·종료일이 있는 ECOUNT 손익계산서가 필요합니다");
  const draft:AccountingDraft={company:match[1]!.trim(),start:`${match[2]}-${match[3]}-${match[4]}`,end:`${match[5]}-${match[6]}-${match[7]}`,
    sourceName:sourceName.slice(0,200),sourceHash:createHash("sha256").update(buffer).digest("hex"),lines:[],reportedRevenue:null,reportedOperatingCost:null,reportedOperatingProfit:null,scopeConfirmed:false,complete:false};
  let section:"revenue"|"cost"|"nonoperating"="nonoperating";
  let expenseTotals=0,expenseSections=0;
  sheet.eachRow((row,index)=>{
    if(index<3)return;
    const label=text(row.getCell(1).value).trim(),key=compact(label);
    if(!label)return;
    const total=amount(row.getCell(3));
    if(/^\d+\./.test(key)) {
      if(/매출$/.test(key)){draft.reportedRevenue=total;section="revenue";}
      else if(/매출원가|판매비.*관리비/.test(key)){if(total!==null){expenseTotals+=total;expenseSections++;}section="cost";}
      else if(/영업(이익|손익)/.test(key)){draft.reportedOperatingProfit=total;section="nonoperating";}
      else section="nonoperating";
      return;
    }
    const n=amount(row.getCell(2));
    if(n===null)return; // Missing current amount is not the prior-period amount.
    draft.lines.push({key:`${sheet.name}!B${index}`,account:label,category:category(key,section),amount:n,sourceCell:`${sheet.name}!B${index}`});
  });
  draft.reportedOperatingCost=expenseSections?expenseTotals:null;
  const totals=accountingTotals({...draft,scopeConfirmed:true} as AccountingReport);
  if([draft.reportedRevenue,draft.reportedOperatingCost,draft.reportedOperatingProfit].some(n=>n===null))throw new ManagementInputError("원본 매출·영업비용·영업손익 합계를 모두 확인할 수 있는 파일이 필요합니다");
  // Preserve mismatches for review; never add a fabricated balancing entry.
  draft.complete=totals.reconciled;
  return draft;
}

/** Check central-directory sizes before ExcelJS inflates an uploaded archive. ZIP64 is unnecessary for a small report. */
export function validateZipSize(buffer:Buffer) {
  let end=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--){if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}}
  if(end<0)throw new ManagementInputError("정상적인 .xlsx 파일이 아닙니다");
  const count=buffer.readUInt16LE(end+10),offset=buffer.readUInt32LE(end+16);
  if(count===65535||count>1000||offset>=end)throw new ManagementInputError("엑셀 압축 구조가 지원 범위를 넘습니다");
  let p=offset,total=0;
  for(let i=0;i<count;i++){
    if(p+46>end||buffer.readUInt32LE(p)!==0x02014b50)throw new ManagementInputError("엑셀 압축 구조를 확인해 주세요");
    const expanded=buffer.readUInt32LE(p+24);total+=expanded;
    if(expanded>10*1024*1024||total>30*1024*1024)throw new ManagementInputError("압축 해제 후 파일이 너무 큽니다");
    p+=46+buffer.readUInt16LE(p+28)+buffer.readUInt16LE(p+30)+buffer.readUInt16LE(p+32);
  }
}
