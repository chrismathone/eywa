import {createHash} from "node:crypto";
import {ManagementInputError} from "./errors";
import ExcelJS from "exceljs";
import {validateZipSize} from "./ecount";
import {monthSchema} from "./model";
import {isMergedStudent} from "@/features/students/status/merged";
import {sourceEvidenceSchema,type SourceEvidence,type SourceIdentity} from "./reviews";

export const sha256=(v:string|Buffer)=>createHash("sha256").update(v).digest("hex");
export const makeeduStudentFields="id,name,school,grade,makeedu_id,is_test,notes,parent_phone";
export const makeeduInvoiceFields="id,student_id,status,amount_total,amount_discount,amount_paid,updated_at";
export type MakeeduStudent={id:string;name:string;school:string|null;grade:string|null;makeedu_id:string|null;is_test:boolean|null;notes:string|null;parent_phone:string|null};
export type MakeeduInvoice={id:string;student_id:string;status:string;amount_total:number|string;amount_discount:number|string|null;amount_paid:number|string;updated_at:string};
type Row={sourceRow:number;sourceId:string;name:string;school:string;grade:string;phone:string;count:number;total:number;discount:number;points:number;paid:number;unpaid:number;refund:number};
export type MakeeduExport={rows:Row[];sourceHash:string};
const fields={count:"수납건수",total:"청구액",discount:"할인액",points:"적립금사용",paid:"실제낸금액",unpaid:"미납금액",refund:"환불금액"} as const;
const grade=(v:string|null)=>String(v??"").replace(/\s|학년/g,"");
const phone=(v:string|null)=>String(v??"").replace(/\D/g,"");
export const makeeduRowHash=(r:Row)=>sha256(JSON.stringify(r));
function number(v:unknown){if(typeof v!=="number"||!Number.isSafeInteger(v)||Math.abs(v)>1e12)throw new ManagementInputError("수납 금액·건수는 수식이 아닌 정수여야 합니다");return v;}
function cellText(c:ExcelJS.Cell){if(c.value===null||c.value===undefined)return "";if(typeof c.value!=="string"&&typeof c.value!=="number")throw new ManagementInputError("이름·학년·고유번호 열에 수식 또는 지원하지 않는 값이 있습니다");return String(c.value).trim();}

export async function parseMakeeduExport(bytes:Buffer):Promise<MakeeduExport>{
  if(bytes.length>5*1024*1024)throw new ManagementInputError("5MB 이하 수납통합내역 엑셀을 선택해 주세요");validateZipSize(bytes);
  const book=new ExcelJS.Workbook();await book.xlsx.load(bytes as unknown as Parameters<typeof book.xlsx.load>[0]);
  if(book.worksheets.length!==1)throw new ManagementInputError("수납통합내역 원본 시트 한 개가 필요합니다");
  const sheet=book.worksheets[0]!;if(sheet.rowCount>20000||sheet.columnCount>60)throw new ManagementInputError("수납 파일의 행·열 범위를 확인해 주세요");
  const headers=new Map<string,number>();sheet.getRow(1).eachCell((c,i)=>{const key=cellText(c);if(headers.has(key))throw new ManagementInputError("중복 열 제목이 있습니다");headers.set(key,i);});
  for(const h of ["이름","학교","학년",...Object.values(fields)])if(!headers.has(h))throw new ManagementInputError(`수납통합내역의 ${h} 열이 필요합니다`);
  const idHeaders=["고유번호","학생번호","원생번호"].filter(h=>headers.has(h));if(idHeaders.length>1)throw new ManagementInputError("학생 고유번호 열을 하나로 확인해 주세요");
  const rows:Row[]=[];
  for(let i=2;i<=sheet.rowCount;i++){
    const row=sheet.getRow(i);if(!row.hasValues)continue;
    const text=(h:string)=>headers.has(h)?cellText(row.getCell(headers.get(h)!)):"";
    const name=text("이름");if(!name)throw new ManagementInputError(`${i}행 학생 이름이 비어 있습니다`);
    if(/^(합계|총계)$/.test(name))throw new ManagementInputError("합계 행이 섞여 있습니다. 원본 학생별 내역으로 내려받아 주세요");
    const amounts=Object.fromEntries(Object.entries(fields).map(([key,h])=>[key,number(row.getCell(headers.get(h)!).value)])) as Pick<Row,keyof typeof fields>;
    const sourceId=idHeaders.length?text(idHeaders[0]!):"";
    if(sourceId&&!/^\d{1,30}$/.test(sourceId))throw new ManagementInputError(`${i}행 고유번호 형식을 확인해 주세요`);
    if(amounts.count<0)throw new ManagementInputError("수납 건수는 음수일 수 없습니다");
    rows.push({sourceRow:i,sourceId,name,school:text("학교"),grade:text("학년"),phone:phone(text("보호자연락처")),...amounts});
  }
  if(!rows.length)throw new ManagementInputError("학생별 수납 내역이 없습니다");
  return {rows,sourceHash:sha256(bytes)};
}

/** Comparison only: never changes invoices, students or source systems. */
export function compareMakeeduExport(parsed:MakeeduExport,month:string,sourceName:string,students:MakeeduStudent[],invoices:MakeeduInvoice[],verified:SourceIdentity[]=[]):SourceEvidence{
  monthSchema.parse(month);
  const valid=students.filter(s=>!s.is_test&&!isMergedStudent(s.notes));
  const ids=new Set(valid.map(s=>s.id)),used=new Set<string>(),issues:SourceEvidence["issues"]=[],unmatched:number[]=[],different:number[]=[],applied:SourceIdentity[]=[];
  const totals={total:0,discount:0,paid:0,points:0,unpaid:0,refund:0};
  const current=invoices.filter(i=>i.status!=="void"&&ids.has(i.student_id));
  const sums=(rows:MakeeduInvoice[])=>rows.reduce((a,i)=>({total:a.total+number(Number(i.amount_total)),discount:a.discount+number(Number(i.amount_discount??0)),paid:a.paid+number(Number(i.amount_paid))}),{total:0,discount:0,paid:0});
  for(const row of parsed.rows){
    for(const key of Object.keys(totals) as (keyof typeof totals)[])totals[key]+=row[key];
    let candidates:MakeeduStudent[];
    if(row.sourceId)candidates=valid.filter(s=>s.makeedu_id===row.sourceId);
    else {
      const resolutions=verified.filter(r=>r.sourceRow===row.sourceRow&&r.rowHash===makeeduRowHash(row));
      if(resolutions.length){
        const targets=new Set(resolutions.map(r=>`${r.studentId}:${r.makeeduId}`));
        candidates=targets.size===1?valid.filter(s=>s.id===resolutions[0]!.studentId&&s.makeedu_id===resolutions[0]!.makeeduId):[];
        if(candidates.length===1)applied.push(resolutions[0]!);
      }else{
        candidates=row.grade?valid.filter(s=>s.name.trim()===row.name&&grade(s.grade)===grade(row.grade)&&String(s.school??"").trim()===row.school):[];
        if(!candidates.length&&row.grade&&row.phone.length>=9)candidates=valid.filter(s=>s.name.trim()===row.name&&grade(s.grade)===grade(row.grade)&&phone(s.parent_phone)===row.phone);
        if(candidates.length>1&&row.phone)candidates=candidates.filter(s=>phone(s.parent_phone)===row.phone);
      }
    }
    if(candidates.length!==1||used.has(candidates[0]!.id)){unmatched.push(row.sourceRow);continue;}
    const id=candidates[0]!.id;used.add(id);const amounts=sums(current.filter(i=>i.student_id===id));
    if(amounts.total!==row.total||amounts.discount!==row.discount||amounts.paid!==row.paid)different.push(row.sourceRow);
  }
  const extra=current.filter(i=>!used.has(i.student_id)),all=sums(current);
  const add=(key:string,title:string,detail:string,nextAction:string)=>issues.push({key,title,detail,nextAction,href:`/billing?period=${month}`});
  if(unmatched.length)add("student_identity","학생 식별 확인",`${unmatched.length}개 원본 행의 고유번호·이름·학년·학교를 확인해야 합니다. 행 ${unmatched.slice(0,20).join(", ")}. 이름만으로 다른 학생에게 연결하지 않았습니다.`,"MakeEdu 학생 상세의 고유번호와 에이와 학생을 확인한 후 같은 파일을 다시 대사해 주세요.");
  if(different.length)add("student_amounts","학생별 금액 차이 확인",`${different.length}명에서 청구·할인·수납 중 차이가 있습니다. 원본 행 ${different.slice(0,20).join(", ")}.`,"해당 월 학생별 청구와 납부 내역을 원본과 비교하고 수정 근거를 기록해 주세요.");
  if(extra.length)add("unpaired_invoices",unmatched.length?"미연결 청구 확인":"원본 밖 청구 확인",`${extra.length}건의 에이와 청구가 매칭되지 않았습니다.${unmatched.length?" 학생 식별 미확인 행이 있어 원본에서 누락된 청구로 단정하지 않습니다.":" 원본 조회 범위와 청구월을 확인해야 합니다."}`,"고유번호와 월을 먼저 확인합니다. 이 결과만으로 청구를 삭제하거나 환불 처리하지 않습니다.");
  if(totals.points!==0)add("points_mapping","적립금 사용액 분류 확인",`원본 적립금 사용액 ${totals.points.toLocaleString()}원. 현재 청구·할인 비교와 별도입니다.`,"에이와 할인·수납에 적립금이 반영되는 방식을 확인해 주세요.");
  // 비교 지문 = 대조에 실제로 쓰는 칸만(메모 본문·수정 시각은 뺀다 — 무관한 수정으로 날마다 새 대조 기록이 생기지 않게).
  const normalized={students:valid.map(s=>[s.id,s.name.trim(),String(s.school??"").trim(),grade(s.grade),s.makeedu_id,phone(s.parent_phone)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),invoices:current.map(i=>[i.id,i.student_id,Number(i.amount_total),Number(i.amount_discount??0),Number(i.amount_paid)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),verified:applied.sort((a,b)=>a.sourceRow-b.sourceRow),policy:"makeedu-export-v1;all-students;all-payments;no-prior-arrears",month};
  return sourceEvidenceSchema.parse({source:"makeedu",month,sourceName:sourceName.slice(0,200),sourceHash:parsed.sourceHash,comparedHash:sha256(JSON.stringify(normalized)),observedAt:new Date().toISOString(),verifiedIdentities:applied,
    summary:`업로드 확인 범위: 전체원생·전체수납, 이전달 미납 제외, 청구월 ${month}. 원본 ${parsed.rows.length}명 중 ${used.size}명 식별, 학생별 금액 차이 ${different.length}명. 청구·할인·수납 비교이며 개별 환불 거래 검증과 실시간 동기화는 포함하지 않습니다. 원본 파일에는 청구월이 없어 사용자가 지정한 월로 비교했습니다.`,
    facts:[{label:"청구액",sourceValue:totals.total,aywaValue:all.total,unit:"원",reference:"청구월 기준 원본 청구액 합계"},{label:"할인액",sourceValue:totals.discount,aywaValue:all.discount,unit:"원",reference:"원본 할인액 합계"},{label:"실청구액(적립금 사용 전)",sourceValue:totals.total-totals.discount,aywaValue:all.total-all.discount,unit:"원",reference:"청구액−할인액"},{label:"해당 청구분 누적 수납",sourceValue:totals.paid,aywaValue:all.paid,unit:"원",reference:"실제낸금액; 해당 월 입금 합계와 구분"},{label:"학생 식별",sourceValue:parsed.rows.length,aywaValue:used.size,unit:"명",reference:"고유번호 우선; 없으면 검증 이력 또는 이름·학년과 학교/보호자 연락처의 유일 일치"},{label:"원본 환불금액(별도 검증 필요)",sourceValue:totals.refund,aywaValue:null,unit:"원",reference:"환불금액 열; 청구 합계에 재차 차감하지 않음"}],issues});
}
