import {createHash} from "node:crypto";
import {ManagementInputError} from "./errors";
import {dateSchema,periodBounds,type AccountingDraft,type AccountingReport} from "./model";

type Category=AccountingReport["lines"][number]["category"];
type Transaction={record:number;date:string;debit:number;credit:number;balance:number};
type Section={code:string;name:string;header:number;headerSeen:boolean;openingSeen:boolean;opening:{debit:number;credit:number;balance:number};total:{debit:number;credit:number;balance:number}|null;transactions:Transaction[]};
// Explicit account codes from the authorized tenant's chart. Unknown codes remain visible.
const groups:Record<Category,readonly string[]>={
  revenue:["100030","100233","400010","400012","400020","400031","4019"],
  labor:["100090","100100","100110","100120","100125","100130","400040","8019","8039","8089","8109"],
  marketing:["400060","400070","400071"],rent:["8249"],
  operating:["100141","100160","100210","100211","100212","100213","100223","400080","400090","400100","400110","400120","400130","400140","8119","8128","8129","8139","8149","8159","8229","8259","8269","8279","8289","8309","8319","8320","8329","8369","8379","8489"],
  nonoperating:["9019","9189","9199","9289","9319","9369","9549","9719","9720"],
  exclude:["1019","1039","1082","1089","1209","1319","1359","1369","2054","2074","2084","2319","2485","2515","2539","2549","2559","2579","2599","2609","2659","2954","2959","3342","3779","3799","4001"],
};
const mapping=new Map(Object.entries(groups).flatMap(([category,codes])=>codes.map(code=>[code,category as Category] as const)));

/** CSV records, not physical lines: ECOUNT permits quoted newlines and trailing tabs. */
export function readLedgerCsv(input:string):string[][] {
  const rows:string[][]=[];let row:string[]=[],cell="",quoted=false,closed=false;
  const text=input.replace(/^\uFEFF/,"");
  const field=()=>{row.push(cell.trim());cell="";closed=false;};
  for(let i=0;i<text.length;i++){
    const c=text[i]!;
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){if(cell||closed)throw new ManagementInputError("CSV 따옴표 형식을 확인해 주세요");quoted=true;}
    else if(c===","){field();}
    else if(c==="\r"||c==="\n"){if(c==="\r"&&text[i+1]==="\n")i++;field();rows.push(row);row=[];}
    else{if(closed&&!/\s/.test(c))throw new ManagementInputError("CSV 필드 경계를 확인해 주세요");cell+=c;}
    if(rows.length>100000||cell.length>10000)throw new ManagementInputError("원장 파일의 행 수 또는 필드 길이가 너무 큽니다");
  }
  if(quoted)throw new ManagementInputError("CSV 따옴표가 닫히지 않았습니다");
  if(cell||row.length||closed){field();if(row.some(Boolean))rows.push(row);}
  return rows;
}
const money=(v:string|undefined)=>{if(!v)return 0;if(!/^-?\d+(?:,\d{3})*$/.test(v))throw new ManagementInputError("원장의 금액 형식을 확인해 주세요");const n=Number(v.replace(/,/g,""));if(!Number.isSafeInteger(n)||Math.abs(n)>1e12)throw new ManagementInputError("원장 금액 범위를 확인해 주세요");return n;};
const amounts=(row:string[])=>({debit:money(row[3]),credit:money(row[4]),balance:money(row[5])});

export function parseEcountLedger(buffer:Buffer,sourceName:string):{documents:AccountingDraft[];summary:{accountCount:number;transactionCount:number;start:string;end:string;debit:number;credit:number;controlsMatched:boolean;warnings:string[]}} {
  if(buffer.length>5*1024*1024)throw new ManagementInputError("원장 CSV는 5MB 이하로 올려 주세요");
  let text:string;try{text=new TextDecoder("utf-8",{fatal:true}).decode(buffer);}catch{throw new ManagementInputError("UTF-8 CSV로 저장한 계정별원장을 올려 주세요");}
  const rows=readLedgerCsv(text),sections:Section[]=[];let current:Section|undefined,company="",start="",end="";
  for(const [index,row] of rows.entries()){
    const record=index+1;
    if(!row.some(Boolean))continue;
    if(row[0]?.startsWith("회사명")){
      const match=row[0].match(/^회사명\s*:\s*(.*?)\s*\/\s*(\d{4}\/\d{2}\/\d{2})\s*~\s*(\d{4}\/\d{2}\/\d{2})\s*\/\s*계정별원장\s*\/\s*(\d+)\(([\s\S]*)\)$/);
      if(!match)throw new ManagementInputError("계정별원장의 회사명·기간·계정코드를 확인해 주세요");
      const a=dateSchema.parse(match[2]!.replaceAll("/","-")),b=dateSchema.parse(match[3]!.replaceAll("/","-"));
      if(a>b||company&&(company!==match[1]!.trim()||start!==a||end!==b))throw new ManagementInputError("서로 다른 회사 또는 조회기간이 섞여 있습니다");
      if(sections.some(s=>s.code===match[4]))throw new ManagementInputError("중복 계정 구간이 있습니다. 파일을 합치지 않고 원본으로 올려 주세요");
      company=match[1]!.trim();start=a;end=b;
      current={code:match[4]!,name:match[5]!.trim(),header:record,headerSeen:false,openingSeen:false,opening:{debit:0,credit:0,balance:0},total:null,transactions:[]};sections.push(current);continue;
    }
    if(!current)throw new ManagementInputError("ECOUNT 계정별원장 CSV 양식이 아닙니다");
    if(row[0]==="일자-No."){
      if(current.headerSeen||row.slice(0,6).join("|")!=="일자-No.|적요|거래처명|차변금액|대변금액|잔액")throw new ManagementInputError("원장의 열 구성이 지원 양식과 다릅니다");
      current.headerSeen=true;continue;
    }
    if(row[1]==="이월잔액"){
      if(!current.headerSeen||current.openingSeen||current.transactions.length)throw new ManagementInputError("이월잔액 위치를 확인해 주세요");
      current.opening=amounts(row);current.openingSeen=true;continue;
    }
    if(row.includes("합계")){if(current.total)throw new ManagementInputError("계정 합계가 중복되었습니다");current.total=amounts(row);continue;}
    const dateMatch=row[0]?.match(/^(\d{4}\/\d{2}\/\d{2})\s*-\s*\d+$/);
    if(dateMatch){
      if(!current.headerSeen||current.total)throw new ManagementInputError("거래 행의 순서를 확인해 주세요");
      const date=dateSchema.parse(dateMatch[1]!.replaceAll("/","-"));
      if(date<start||date>end)throw new ManagementInputError("조회기간 밖 거래가 있습니다");
      current.transactions.push({record,date,...amounts(row)});continue;
    }
    if(/^\d{4}\/\d{2}\/\d{2}\s+(오전|오후|AM|PM)?\s*\d{1,2}:\d{2}:\d{2}$/.test(row[0]??"")&&row.slice(1).every(v=>!v))continue;
    throw new ManagementInputError(`CSV 기록 ${record}의 유형을 확인하지 못했습니다`);
  }
  if(!sections.length||sections.length>500)throw new ManagementInputError("계정 구간 수를 확인해 주세요");
  let controlsMatched=true,totalDebit=0,totalCredit=0,transactionCount=0;
  for(const section of sections){
    if(!section.headerSeen)throw new ManagementInputError("계정별 열 제목이 없습니다");
    const debit=section.transactions.reduce((n,t)=>n+t.debit,0),credit=section.transactions.reduce((n,t)=>n+t.credit,0);
    totalDebit+=debit;totalCredit+=credit;transactionCount+=section.transactions.length;
    if(section.transactions.length&&!section.total)controlsMatched=false;
    if(section.total&&(section.total.debit!==debit+section.opening.debit||section.total.credit!==credit+section.opening.credit))controlsMatched=false;
    // Verify the running balance with either debit-normal or credit-normal convention.
    const validBalance=(sign:number)=>{let balance=section.opening.balance;for(const t of section.transactions){balance+=sign*(t.debit-t.credit);if(balance!==t.balance)return false;}return !section.total||section.total.balance===balance;};
    if(!validBalance(1)&&!validBalance(-1))controlsMatched=false;
  }
  if(totalDebit!==totalCredit)controlsMatched=false;
  if(!transactionCount)throw new ManagementInputError("거래가 없는 원장입니다");
  const unclassifiedCodes=sections.filter(s=>!mapping.has(s.code)&&s.transactions.length).map(s=>s.code);
  const warnings=["이월잔액·합계·잔액은 월 거래금액에서 제외했습니다. 거래일은 비용 귀속월과 다를 수 있습니다.","원장 내부 합계 일치는 회계 마감 완료 또는 손익계산서 일치를 의미하지 않습니다.","회사 전체 계정입니다. 학원·임대사업 구분과 공통비 배부를 확인해야 합니다."];
  if(!controlsMatched)warnings.push("원장 계정 합계·잔액 또는 차변/대변 검산이 맞지 않습니다.");
  if(unclassifiedCodes.length)warnings.push(`분류 확인 계정: ${unclassifiedCodes.join(", ")}. 현재 손익 집계에서 제외했습니다.`);
  const first=new Date(start+"T00:00:00Z"),last=end.slice(0,7),months:string[]=[];
  first.setUTCDate(1);for(;first.toISOString().slice(0,7)<=last;first.setUTCMonth(first.getUTCMonth()+1)){if(months.length>=60)throw new ManagementInputError("조회기간은 60개월 이하로 나눠 주세요");months.push(first.toISOString().slice(0,7));}
  const sourceHash=createHash("sha256").update(buffer).digest("hex");
  const documents=months.map(month=>{
    const bounds=periodBounds(month),monthly=sections.map(section=>({section,tx:section.transactions.filter(t=>t.date.startsWith(month))})).filter(s=>s.tx.length);
    const monthWarnings=[...warnings];
    const missingSalary=["100090","100100","100110","100120"].filter(code=>sections.some(s=>s.code===code)&&!monthly.some(s=>s.section.code===code));
    if(missingSalary.length)monthWarnings.push(`이 월에 급여 거래가 없는 계정: ${missingSalary.join(", ")}. 누락·지급월 차이를 확인하세요.`);
    const draft:AccountingDraft={company,start:bounds.start<start?start:bounds.start,end:bounds.end>end?end:bounds.end,sourceName,sourceHash,sourceKind:"ledger",reportedRevenue:null,reportedOperatingCost:null,reportedOperatingProfit:null,scopeConfirmed:false,complete:false,
      ledgerInfo:{sourceStart:start,sourceEnd:end,accountCount:sections.length,transactionCount:monthly.reduce((n,s)=>n+s.tx.length,0),totalTransactionCount:transactionCount,controlsMatched,unclassifiedCodes,warnings:monthWarnings},
      lines:monthly.map(({section,tx})=>{const category=mapping.get(section.code)??"exclude";const creditNormal=category==="revenue"||["9019","9189","9199","9289"].includes(section.code);return {key:`ledger:${month}:${section.code}`,account:`${section.code} ${section.name}${mapping.has(section.code)?"":" (분류 확인)"}`,category,amount:tx.reduce((n,t)=>n+(creditNormal?t.credit-t.debit:t.debit-t.credit),0),sourceCell:`CSV records ${tx[0]!.record}..${tx.at(-1)!.record}; ${tx.length} entries; ${section.code}`};})};
    return draft;
  }).filter(d=>d.lines.length);
  return {documents,summary:{accountCount:sections.length,transactionCount,start,end,debit:totalDebit,credit:totalCredit,controlsMatched,warnings}};
}
