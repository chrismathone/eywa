/** 24_기여도팩터 F01–F42. Workbook values are examples, never student data. */
import { familyFactorScore } from "./family-loyalty";
export const FACTOR_MODEL = "loyalty-factors-v2-family40";
export const AXES = [
  { id: "A7", name: "가족 동시 재원", weight: 40, cost: false, color: "#d28b25" },
  { id: "A1", name: "수익 기여", weight: 20, cost: false, color: "#6357ce" },
  { id: "A2", name: "유지 기여", weight: 20, cost: false, color: "#269c8b" },
  { id: "A3", name: "확산 기여", weight: 10, cost: false, color: "#438ac7" },
  { id: "A4", name: "성장 가능성", weight: 10, cost: false, color: "#aa6bbf" },
  { id: "A5", name: "지원 부담", weight: 15, cost: true, color: "#c58a37" },
  { id: "A6", name: "유지 위험", weight: 10, cost: true, color: "#c36565" },
] as const;
export type AxisId = typeof AXES[number]["id"];
export type Factor = { id: string; axis: AxisId; name: string; unit: string; definition: string; window: string;
  cap?: number; inverse?: boolean; min?: number; max?: number; integer?: boolean; options?: string[] };
// cap = 100점 기준. 축 안에서는 항목별 동일 가중치; 관측되지 않은 값을 추정하지 않는다.
export const FACTORS: Factor[] = [
  { id:"F01",axis:"A1",name:"월 수강료 순수납",unit:"원",window:"선택 월 청구분",cap:450000,min:-100000000,max:100000000,definition:"선택 월 청구의 수업료 수납 − 유효 환불. 교재·차량비 제외. 현금 입금월 매출과 다릅니다." },
  { id:"F02",axis:"A1",name:"동시 수강 과목 수",unit:"과목",window:"기준일",cap:3,max:50,integer:true,definition:"기준일에 실제 수강 중인 서로 다른 과목 수. 휴원·보강 전용 반 제외." },
  { id:"F03",axis:"A1",name:"할인 의존도",unit:"%",window:"선택 월",cap:30,inverse:true,max:100,definition:"수업료 할인액 ÷ 할인 전 수업료 × 100. 낮을수록 기여 점수가 높습니다." },
  { id:"F04",axis:"A1",name:"추가 구매 순액",unit:"원",window:"최근 12개월",cap:400000,min:-100000000,max:100000000,definition:"교재·특강·모의고사·클리닉 등의 수납 − 환불. F01 정규 수강료와 중복 제외." },
  { id:"F05",axis:"A1",name:"연간 계약 여부",unit:"여부",window:"기준일",cap:1,max:1,integer:true,definition:"기준일에 유효한 연간 또는 장기 선납 계약이 있으면 1, 확인된 미계약은 0." },
  { id:"F06",axis:"A2",name:"재원 경과 기간",unit:"개월",window:"등록일~기준일",cap:36,max:600,definition:"등록일부터 기준일(퇴원 시 퇴원일)까지 경과 기간. 휴원 기간을 차감한 실제 수강 개월과 구분합니다." },
  { id:"F07",axis:"A2",name:"학년 잔여 여력",unit:"메모",window:"기준일",definition:"학년별 남은 수강 가능 기간과 확인 근거. 자동 재원 확률로 해석하지 않습니다." },
  { id:"F08",axis:"A2",name:"출석률",unit:"%",window:"최근 6개월",cap:100,max:100,definition:"출석·지각 수업 ÷ 전체 예정 수업 × 100. 자동값은 입력된 출결만의 비율이므로 시간표 대사 전에는 참고값입니다." },
  { id:"F09",axis:"A2",name:"과제 수행률",unit:"%",window:"최근 6개월",cap:100,max:100,definition:"제출 완료 과제 ÷ 부여 과제 × 100. 자동값은 출결표의 과제 체크 범위이므로 전체 과제 확인이 필요합니다." },
  { id:"F10",axis:"A2",name:"상담 연결 횟수",unit:"회",window:"선택 월",cap:2,max:1000,integer:true,definition:"학부모와 실제 연결된 상담 횟수. 통화 시도·내부 메모 제외. 원본의 상담응답률 항목을 정의에 맞게 표시." },
  { id:"F11",axis:"A2",name:"행사 참여율",unit:"%",window:"최근 12개월",cap:100,max:100,definition:"초대받고 참여한 행사 수 ÷ 초대 행사 수 × 100. 초대 0건이면 해당 없음으로 기록." },
  { id:"F12",axis:"A3",name:"추천 등록 인원",unit:"명",window:"최근 12개월",cap:3,max:1000,integer:true,definition:"해당 학생·보호자의 추천으로 실제 수업을 시작한 학생 수. 중복 추천은 확인 후 1회만 인정." },
  { id:"F13",axis:"A7",name:"함께 재원 중인 형제자매",unit:"명",window:"기준일",cap:3,max:20,integer:true,definition:"본인 제외, 동일 보호자 휴대폰 또는 직접 연결된 형제자매 중 현재 재원·정규 수강이 모두 확인된 인원. 수동 제외 우선, 보호자 이름만 같은 후보는 미반영. 본인이 휴원·퇴원하면 동시 재원 가산은 0. 1명 20점·2명 35점·3명 이상 40점으로 종합 지수에 반영합니다." },
  { id:"F14",axis:"A3",name:"자발적 후기",unit:"여부",window:"최근 12개월",cap:1,max:1,integer:true,definition:"확인 가능한 자발적 후기가 있으면 1, 조사 후 없으면 0. 후기 링크·작성일을 근거에 기록." },
  { id:"F15",axis:"A3",name:"추천 의향",unit:"점 / 10",window:"선택 월 조사",cap:10,max:10,integer:true,definition:"보호자가 답한 추천 의향 0~10점. 개인 응답이며 집단 지표 NPS 자체가 아닙니다." },
  { id:"F16",axis:"A3",name:"행사 지인 동반",unit:"명",window:"최근 12개월",max:1000,integer:true,definition:"행사에 동반한 지인 수. 행사명·관계·참석 기록을 근거로 남깁니다." },
  { id:"F17",axis:"A4",name:"미등록 형제 수",unit:"명",window:"기준일",cap:2,max:20,integer:true,definition:"확인된 형제 중 현재 미등록 인원. 향후 등록은 보장되지 않습니다." },
  { id:"F18",axis:"A4",name:"거주 유형",unit:"메모",window:"기준일",options:["아파트","오피스텔","빌라","단독주택","기타"],definition:"생활권·통학 지원 참고 정보. 주거 유형만으로 기여도를 높이거나 낮추지 않아 점수에서 제외합니다." },
  { id:"F19",axis:"A4",name:"거주 권역 점유",unit:"메모",window:"선택 월",definition:"권역 재원생 수·전체 가구 수·기준일을 함께 기록. 분모가 없으면 점유율로 단정하지 않습니다." },
  { id:"F20",axis:"A4",name:"통학 소요 시간",unit:"분",window:"기준일",cap:60,inverse:true,max:300,definition:"확인된 편도 통학 시간. 60분 이상 0점, 0분 100점의 운영 가정입니다." },
  { id:"F21",axis:"A4",name:"보호자 응답 시간",unit:"시간",window:"선택 월",cap:48,inverse:true,max:1000,definition:"응답 요청 시각부터 최초 응답까지 평균 시간. 야간·휴일 제외 등 적용 기준과 표본 수를 근거에 기록." },
  { id:"F22",axis:"A4",name:"학년 상승 여력",unit:"메모",window:"기준일",definition:"다음 학년 수강 가능 과정·기간. 학년만으로 유지 확률을 생성하지 않습니다." },
  { id:"F23",axis:"A5",name:"불편 접수 건수",unit:"건",window:"최근 12개월",cap:5,max:1000,integer:true,definition:"중복·동일 사건을 합친 정식 불편 접수 건수. 의견 제시 자체를 문제 행동으로 해석하지 않습니다." },
  { id:"F24",axis:"A5",name:"불편 사항 심각도",unit:"단계",window:"최근 12개월",cap:3,max:3,integer:true,definition:"최대 확인 단계: 0 없음, 1 경미, 2 서비스 개선 필요, 3 환불 요구 수준. 사유와 해결 결과 기록." },
  { id:"F25",axis:"A5",name:"결제 지연 일수",unit:"일",window:"최근 12개월",cap:10,max:730,definition:"납기일 대비 납부 지연 일수의 평균. 미납은 기준일까지 계산하며 대상 청구 수와 계산 기준을 기록." },
  { id:"F26",axis:"A5",name:"반 변경·추가 조정",unit:"건",window:"최근 12개월",cap:4,max:1000,integer:true,definition:"보호자 요청 반 변경·별도 관리자 조정 건수. 정기 승급·학원 사정 변경 제외, 동일 사건 중복 제외." },
  { id:"F27",axis:"A5",name:"보충·재시험 요청",unit:"건",window:"최근 12개월",max:1000,integer:true,definition:"추가 보충·재시험 요청 건수와 실제 지원 시간. 학습 지원 필요를 확인하는 참고 정보." },
  { id:"F28",axis:"A5",name:"셔틀 이용·노선 지원",unit:"메모",window:"최근 12개월",definition:"셔틀 이용 여부·노선 추가 여부·실제 비용. 기존 탑승 기록과 담당자 확인을 연결." },
  { id:"F29",axis:"A6",name:"이탈 위험 지수",unit:"점 / 100",window:"선택 월",cap:100,max:100,definition:"검토된 위험 지수 0~100과 산출 모델·근거. 검증되지 않은 지수를 이탈 확률로 표시하지 않습니다." },
  { id:"F30",axis:"A6",name:"환불 요구 이력",unit:"여부",window:"최근 12개월",cap:1,max:1,integer:true,definition:"실제 환불 요구가 확인되면 1, 조사 후 없으면 0. 단순 정산·과납 반환 제외." },
  { id:"F31",axis:"A6",name:"미해결 대외 불만",unit:"여부",window:"기준일",cap:1,max:1,integer:true,definition:"확인된 공개 불만이 미해결이면 1. 원문·대응 결과가 필요하며 민원 횟수로 추정하지 않습니다." },
  { id:"F32",axis:"A6",name:"반 분위기·관계",unit:"메모",window:"선택 월",definition:"확인된 관계 갈등, 지원 조치, 해결 결과. 추정이나 낙인 대신 구체적인 사건을 기록." },
  { id:"F33",axis:"A4",name:"보호자 관여 방식",unit:"메모",window:"기준일",definition:"선호하는 소통·학습 지원 방식과 합의 사항. 유형만으로 좋고 나쁨을 채점하지 않습니다." },
  { id:"F34",axis:"A4",name:"진학 목표",unit:"메모",window:"기준일",definition:"학생·보호자가 확인한 진학 목표와 상담 일자." },
  { id:"F35",axis:"A2",name:"학교 시험 추이",unit:"메모",window:"최근 12개월",definition:"동일 과목·동일 만점 시험을 비교. 시험 난도·학년 차이를 고려하여 원점수 변화만으로 강사 효과를 단정하지 않습니다." },
  { id:"F36",axis:"A3",name:"동반 등원 친구",unit:"명",window:"기준일",max:1000,integer:true,definition:"확인된 동반 등원 친구 수와 관계. 유지 확률을 임의로 가산하지 않습니다." },
  { id:"F37",axis:"A5",name:"교재 재발급",unit:"건",window:"최근 12개월",max:1000,integer:true,definition:"교재 재발급 건수 및 실제 발생 비용." },
  { id:"F38",axis:"A6",name:"강사 지원 부담",unit:"메모",window:"선택 월",definition:"강사가 기록한 추가 지원 시간·상황·필요 지원. 학생의 고정적 성향으로 해석하지 않습니다." },
  { id:"F39",axis:"A1",name:"결제 수단",unit:"메모",window:"선택 월",definition:"확인된 결제 수단·자동 결제 여부. 수단만으로 미납 위험을 추정하지 않습니다." },
  { id:"F40",axis:"A2",name:"휴원 이력",unit:"메모",window:"최근 12개월",definition:"휴원 시작·종료·사유·복귀 약속. 현재 휴원 상태와 과거 이력을 구분." },
  { id:"F41",axis:"A3",name:"온라인 언급",unit:"메모",window:"최근 12개월",definition:"출처·날짜·확인된 긍정/부정 내용·대응 결과. 작성자 신원은 확인된 경우만 연결." },
  { id:"F42",axis:"A4",name:"생활권·학교 정보",unit:"메모",window:"기준일",definition:"학교·생활권과 맞춤 행사·수업 수요. 지역을 학생 가치의 대리 점수로 사용하지 않습니다." },
];
export type FactorValue = number | string;
export type Observation = { factorId:string; value:FactorValue|null; state:"measured"|"partial"|"missing"|"na"; source:"auto"|"manual"|"none";
  evidence:string; refs:{table:string;id:string}[]; href?:string; version:number; recordedAt?:string; actor?:string };
export type FactorRecord = { id:string; factor_id:string; value:FactorValue|null; state:"measured"|"na"|"reset"; evidence:string; version:number; recorded_at:string; actor_id:string };
export function validMonth(value:unknown):value is string { return typeof value === "string" && /^(20\d{2})-(0[1-9]|1[0-2])$/.test(value); }
export function validateValue(f:Factor,value:unknown):value is FactorValue {
  if (f.unit === "메모") return typeof value === "string" && value.trim().length > 0 && value.length <= 2000 && (!f.options || f.options.includes(value));
  return typeof value === "number" && Number.isFinite(value) && value >= (f.min ?? 0) && value <= (f.max ?? 100000000) && (!f.integer || Number.isInteger(value));
}
export function factorScore(f:Factor,value:FactorValue):number|null {
  if (!f.cap || typeof value !== "number" || !validateValue(f,value)) return null;
  if (f.id === "F13") return familyFactorScore(value);
  const ratio = Math.max(0, Math.min(1, value / f.cap));
  return 100 * (f.inverse ? 1-ratio : ratio);
}
export function resolveObservations(auto:Observation[],records:FactorRecord[]):Observation[] {
  return FACTORS.map(f=>{
    const base = auto.find(x=>x.factorId===f.id) ?? {factorId:f.id,value:null,state:"missing" as const,source:"none" as const,evidence:"아직 측정하지 않았습니다.",refs:[],version:0};
    const r = records.filter(x=>x.factor_id===f.id).sort((a,b)=>b.version-a.version)[0];
    if (!r || r.state === "reset") return {...base,version:r?.version??0};
    return {factorId:f.id,value:r.value,state:r.state,source:"manual",evidence:r.evidence,refs:[{table:"student_contribution_factor_records",id:r.id}],version:r.version,recordedAt:r.recorded_at,actor:r.actor_id};
  });
}
export function analyzeFactors(observations:Observation[]) {
  const axes = AXES.map(axis=>{
    const required = FACTORS.filter(f=>f.axis===axis.id&&f.cap);
    const applicable = required.filter(f=>observations.find(o=>o.factorId===f.id)?.state!=="na");
    const scores = applicable.map(f=>{const o=observations.find(x=>x.factorId===f.id);return o?.state==="measured"&&o.value!==null?factorScore(f,o.value):null;});
    const known = scores.filter((x):x is number=>x!==null);
    const denominator = applicable.length || 1;
    const lower = known.reduce((a,b)=>a+b,0)/denominator;
    const upper = applicable.length ? (known.reduce((a,b)=>a+b,0)+(scores.length-known.length)*100)/denominator : 100;
    return {...axis,known:known.length,total:applicable.length,excluded:required.length-applicable.length,lower,upper,
      score:applicable.length&&known.length===applicable.length?lower:null};
  });
  const lower=Math.max(0,axes.reduce((s,a)=>s+(a.cost?-a.upper:a.lower)*a.weight/100,0));
  const upper=Math.max(0,axes.reduce((s,a)=>s+(a.cost?-a.lower:a.upper)*a.weight/100,0));
  return { axes,lower,upper,score:axes.every(a=>a.score!==null)?lower:null,
    known:axes.reduce((s,a)=>s+a.known,0),total:axes.reduce((s,a)=>s+a.total,0) };
}
export function factorGraph(studentId:string,month:string,observations:Observation[]) {
  const sid=`student:${studentId}`;
  const nodes: {id:string;kind:string;label:string;value?:FactorValue|null;state?:string}[]=[{id:sid,kind:"student",label:"학생"},...AXES.map(a=>({id:a.id,kind:"axis",label:a.name})),...FACTORS.map(f=>({id:f.id,kind:"factor",label:f.name}))];
  const edges:{from:string;to:string;relation:string}[]=FACTORS.map(f=>({from:f.id,to:f.axis,relation:"belongsTo"}));
  for (const o of observations.filter(x=>x.state!=="missing")) {
    const id=`observation:${studentId}:${month}:${o.factorId}`;
    nodes.push({id,kind:"observation",label:`${month} ${o.factorId}`,value:o.value,state:o.state});
    edges.push({from:sid,to:id,relation:"hasObservation"},{from:id,to:o.factorId,relation:"measures"});
    for (const ref of o.refs) { const rid=`${ref.table}:${ref.id}`;if(!nodes.some(n=>n.id===rid))nodes.push({id:rid,kind:"record",label:ref.table});edges.push({from:id,to:rid,relation:"evidencedBy"}); }
  }
  return {model:FACTOR_MODEL,studentId,month,nodes,edges,assessment:analyzeFactors(observations)};
}
