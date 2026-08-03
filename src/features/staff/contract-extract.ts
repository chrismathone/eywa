import { EMPLOYMENT_TYPES } from "./resume";

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
 * 주민등록번호 마스킹 — 외부 AI로 나가는 계약서 본문에서 `######-#######` 패턴을 지운다
 * (외부 AI 전송 금지 필드 원칙 — 스캔 OCR 승인(2026-08-03) 시에도 텍스트 단계에선 항상 가린다).
 * 생년월일 6자리는 남긴다(계약 당사자 확인용으로 무해) — 뒤 7자리만 별표.
 */
export function maskResidentRegNo(text: string): string {
  return String(text ?? "").replace(/(\d{6})\s*[-–]\s*\d{7}/g, "$1-*******");
}
