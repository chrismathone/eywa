import { EMPLOYMENT_TYPES } from "../resume/resume";

/**
 * 계약서 PDF에서 뽑은 값의 **후보정 가드**(원장 지시 2026-07-31 — PDF만 지원).
 *
 * 계약 기간·금액은 틀리면 그대로 돈 문제가 되므로, AI가 돌려준 값을 그대로 믿지 않는다.
 * 등록상담 폼 자동입력(`buildFormPatch`)과 같은 원칙: **원문에 실제로 있는 값만 통과**시킨다.
 * 통과 못 한 칸은 빈 값으로 두고 사람이 채운다(틀린 값을 채워 넣는 것보다 비는 게 낫다).
 *
 * 순수 함수 — PDF 텍스트와 추출 결과만 받는다(IO·AI 호출 없음).
 */

export type ContractExtract = {
  startDate: string;
  endDate: string;
  employmentType: string;
  terms: string;
};

export const EMPTY_EXTRACT: ContractExtract = {
  startDate: "",
  endDate: "",
  employmentType: "",
  terms: "",
};

/** "2026년 6월 29일"·"2026.06.29"·"2026-6-29" 등 → "2026-06-29". 못 읽으면 "". */
export function normalizeContractDate(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const m = /(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/.exec(s);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  // 실재하지 않는 날(2월 30일 등)은 버린다 — 보정하면 원문에 없는 날짜를 만들어내는 셈이다.
  if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return "";
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * 그 날짜가 원문에 **실제로 적혀 있는가**. 구분자(./-/년월일/공백)는 자유롭게 허용하되
 * 연·월·일 숫자가 그 순서로 붙어 있어야 한다. 앞자리 0은 있어도 없어도 인정.
 */
export function dateAppearsIn(text: string, ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return false;
  const sep = "[\\s.\\-/년월]*";
  const mo = String(Number(m[2]));
  const d = String(Number(m[3]));
  const re = new RegExp(`${m[1]}${sep}0?${mo}${sep}0?${d}`);
  return re.test(text);
}

/** 문자열에 든 숫자 토큰(3자리 이상 — 금액·비율 후보). 쉼표는 제거해 "2,800,000"도 한 덩어리로 본다. */
function numberTokens(s: string): string[] {
  return (s.replace(/,/g, "").match(/\d{3,}/g) ?? []).filter((v, i, a) => a.indexOf(v) === i);
}

/**
 * 원문 검증을 통과한 값만 남긴 결과.
 * - 기간: 형식이 맞고 **원문에 등장**해야 하며, 종료일은 시작일보다 뒤여야 한다(아니면 둘 다 버린다).
 * - 근무형태: 선택지(EMPLOYMENT_TYPES) 안에 있고 그 단어가 **원문에 있어야** 한다.
 * - 계약조건: 안에 든 **금액·숫자가 전부 원문에 있어야** 한다(지어낸 금액 차단). 200자로 자른다.
 */
export function groundContractExtract(raw: Partial<ContractExtract>, text: string): ContractExtract {
  const body = String(text ?? "").replace(/\s+/g, " ");
  const out = { ...EMPTY_EXTRACT };

  const start = normalizeContractDate(raw.startDate);
  const end = normalizeContractDate(raw.endDate);
  if (start && end && end > start && dateAppearsIn(body, start) && dateAppearsIn(body, end)) {
    out.startDate = start;
    out.endDate = end;
  }

  const emp = String(raw.employmentType ?? "").trim();
  if ((EMPLOYMENT_TYPES as readonly string[]).includes(emp) && body.includes(emp)) {
    out.employmentType = emp;
  }

  const terms = String(raw.terms ?? "").trim().replace(/\s+/g, " ");
  if (terms) {
    const nums = numberTokens(terms);
    const bodyNums = new Set(numberTokens(body));
    if (nums.every((n) => bodyNums.has(n))) out.terms = terms.slice(0, 200);
  }

  return out;
}

/** 뽑아낸 게 하나도 없으면 화면에서 "못 읽었다"고 알려야 한다(조용히 빈 폼을 주지 않게). */
export function isEmptyExtract(e: ContractExtract): boolean {
  return !e.startDate && !e.endDate && !e.employmentType && !e.terms;
}

/**
 * 주민등록번호 마스킹 — 외부 AI로 나가는 계약서 본문에서 13자리 숫자 꼴을 지운다
 * (외부 AI 전송 금지 필드 원칙 — 스캔 OCR 승인(2026-08-03) 시에도 텍스트 단계에선 항상 가린다).
 * 생년월일 6자리는 남긴다(계약 당사자 확인용으로 무해) — 뒤 7자리만 별표.
 */
export function maskResidentRegNo(text: string): string {
  const digit = "[0-9０-９]";
  const gap = "[\\s\\u00A0\\u200B-\\u200D]*";
  // ① 대시로 이은 꼴은 앞뒤에 숫자가 붙어 있어도 **늘** 가린다(종전 규칙 — OCR이 표 테두리·옆 숫자를 붙여 읽은 글자도 덜 가리면 사고).
  const dashed = new RegExp(`(${digit}{6})${gap}[-–—‐‑−－]${gap}${digit}{7}`, "g");
  // ② 붙여 쓴 13자리·물결·점으로 이은 꼴은 다른 긴 숫자(계좌·금액 범위·소수)를 자르지 않게 앞뒤가 숫자가 아닐 때만.
  const loose = new RegExp(`(?<!${digit})(${digit}{6})${gap}(?:[~.]${gap})?${digit}{7}(?!${digit})`, "g");
  return String(text ?? "").replace(dashed, "$1-*******").replace(loose, "$1-*******");
}

// ── 구조화 조건(원장 지시 2026-08-03: "정규직·알바·프리랜서별로 다르게, 우다다 인용 금지") ──────
// 모델은 급여 구조를 **필드로** 뽑고, 조건 문자열은 여기서 결정적으로 조립한다.
// 시트 관례를 따른 형태: 비율제 "강의용역 : 초등(43%), 중등(44%)" · 시급 "(시용)근로 : 시용 3개월 / 시급 15,000원" ·
// 월급 "근로 : 월급 2,200,000원 (포괄임금)". 각 숫자·라벨은 원문 등장 검증 통과분만 쓴다.

export type RawPayRate = { label?: string | null; percent?: string | number | null };
export type RawContractExtract = Partial<ContractExtract> & {
  /** 계약서 서두 사용자(갑)의 회사/기관명 — 본문 표현 그대로 짧게("주식회사 곰돌이", "EIE인재원" 등). */
  company?: string | null;
  /** 계약 종류 — 본문 표현 그대로 짧게("근로", "(시용)근로", "강의용역" 등). */
  contractKind?: string | null;
  /** 급여 방식: "월급" | "시급" | "비율" | "". */
  payType?: string | null;
  monthlyPay?: string | number | null;
  hourlyPay?: string | number | null;
  /** 시용/수습 개월 수. */
  probationMonths?: string | number | null;
  /** 비율제 구간들 — label·percent 모두 본문 그대로. */
  rates?: RawPayRate[] | null;
};

/** 숫자 문자열 정규화(쉼표 제거·숫자만). 금액 비교·표시용. */
function digitsOf(v: string | number | null | undefined): string {
  return String(v ?? "").replace(/[^0-9]/g, "");
}

/** 그 금액이 원문에 실제로 있는가(쉼표 유무 무시, 3자리 이상만 의미). */
function amountAppears(body: string, v: string | number | null | undefined): boolean {
  const d = digitsOf(v);
  if (d.length < 3) return false;
  return body.replace(/,/g, "").includes(d);
}

/** "43%"처럼 그 퍼센트가 원문에 있는가(1~3자리). */
function percentAppears(body: string, v: string | number | null | undefined): boolean {
  const d = digitsOf(v);
  if (!d || d.length > 3) return false;
  return new RegExp(`${d}\\s*%`).test(body);
}

function fmtAmount(v: string | number): string {
  const d = digitsOf(v);
  return d ? Number(d).toLocaleString("en-US") : "";
}

/**
 * 검증 통과한 구조 필드로 조건 문자열을 조립한다. 조립할 게 없으면 "" — 호출부가 통짜 인용 폴백.
 * 순수 함수(Vitest). body는 공백 1칸 정규화본.
 */
export function composeContractTerms(raw: RawContractExtract, body: string): string {
  const compact = body.replace(/\s+/g, "");
  const kindRaw = String(raw.contractKind ?? "").trim().replace(/\s+/g, "");
  // 계약 종류는 본문에 실제 등장할 때만 접두로 쓴다(모델이 지어낸 분류 차단).
  const kind = kindRaw && kindRaw.length <= 20 && compact.includes(kindRaw) ? kindRaw : "";
  // 회사명(사용자 갑)도 본문 등장 검증 후 접두 — 시트 관례 "(주)곰돌이_강의용역 : …"(원장 지시 2026-08-03).
  // "주식회사 X"는 시트 표기처럼 "(주)X"로 줄인다(사실은 검증된 원문, 축약은 우리 표기 규칙).
  const companyRaw = String(raw.company ?? "").trim().replace(/\s+/g, "");
  const companyOk = companyRaw && companyRaw.length <= 20 && compact.includes(companyRaw);
  const company = companyOk ? companyRaw.replace(/^주식회사/, "(주)") : "";
  const head = [company, kind].filter(Boolean).join("_");
  const prefix = head ? `${head} : ` : "";
  const payType = String(raw.payType ?? "").trim();

  if (payType === "비율") {
    const parts: string[] = [];
    for (const r of raw.rates ?? []) {
      const label = String(r?.label ?? "").trim();
      if (!label || label.length > 10 || !compact.includes(label.replace(/\s+/g, ""))) continue;
      if (!percentAppears(body, r?.percent)) continue;
      parts.push(`${label}(${digitsOf(r?.percent)}%)`);
    }
    if (parts.length > 0) return `${prefix}${parts.join(", ")}`;
  }

  if (payType === "시급" && amountAppears(body, raw.hourlyPay)) {
    const prob = digitsOf(raw.probationMonths);
    // 시용 개월 수는 본문에 그 숫자+개월이 있어야 붙인다.
    const probOk = prob && new RegExp(`${prob}\\s*개\\s*월`).test(body);
    const head = probOk ? `시용 ${prob}개월 / ` : "";
    return `${prefix}${head}시급 ${fmtAmount(raw.hourlyPay!)}원`;
  }

  if (payType === "월급" && amountAppears(body, raw.monthlyPay)) {
    // 포괄임금 여부는 모델이 아니라 원문 단어로 판정한다.
    const inclusive = compact.includes("포괄임금") ? " (포괄임금)" : "";
    return `${prefix}월급 ${fmtAmount(raw.monthlyPay!)}원${inclusive}`;
  }

  return "";
}
