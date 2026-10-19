// 콜&상담 녹음 → 양식 칸 추출의 **저장 전** 후처리 — 모델이 바뀌어도 칸 값의 모양을 기존(Sonnet 시절)과 같게(원장 2026-10-19).
// 순수 함수(⚠️ server-only 금지 [[#61]] — Vitest 대상). 여기는 **모양**만 맞춘다(문자열 · 정해진 선택지 표기 · 전화·날짜 형식).
// 내용 검증(전사에 있는 말인가 · 학생 이름 복사 · 한 글자 잡음)은 그 뒤 `buildFormPatch`(form-fill.ts) 하네스가 그대로 맡는다.
import { CONSULTATION_PATHS, RELATION_OPTIONS, REGISTRATION_STATUSES, SUBJECT_TABS } from "./form-config";
import type { ExtractedConsultationForm } from "./form-fill";

const TEXT_KEYS = [
  "schoolName",
  "grade",
  "parentName",
  "parentPhone",
  "parentRelation",
  "gender",
  "birthDate",
  "address",
  "consultationPath",
  "careerGoal",
  "siblings",
  "safetyNotes",
  "registrationStatus",
  "subject",
  "parentRequest",
  "prevAcademy",
  "lastScore",
  "weakSubjects",
  "followUpContent",
  "nonRegistrationReason",
] as const;

/**
 * 문자열 자리 값 → 문자열('null'·'-'·'미상' 같은 빈 표시는 빈 문자열). 배열은 쉼표로(약점 단원 등 프롬프트 형식).
 * 객체는 키를 살린다 — `{형: "1명", 누나: "1명"}` → '형: 1명, 누나: 1명'(값만 이으면 '1명, 1명'이 저장된다 · 2026-10-19 리뷰).
 * 과목 키(`math`)는 한글 이름('수학: 85점')으로. 그 밖의 영문 키(`midterm`)는 무엇의 값인지 화면 말로 못 옮기니 **그 칸을 버린다**
 * (예전에도 문자열이 아닌 값은 뒤 하네스가 버렸다 — 원문 키를 화면에 내지 않는다).
 */
function str(v: unknown): string {
  if (v == null || typeof v === "boolean") return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(", ");
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => {
        const t = str(x);
        if (!t) return "";
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) return `${k}: ${t}`;
        const subject = SUBJECT_TABS.find((s) => s.key === k);
        return subject ? `${subject.label}: ${t}` : "";
      })
      .filter(Boolean)
      .join(", ");
  }
  const t = String(v).replace(/\r\n?/g, "\n").replace(/\\n/g, "\n").trim();
  // '없음'은 비우지 않는다 — '알레르기 없음'처럼 말한 사실일 수 있다(내용은 바꾸지 않는다).
  return /^(null|undefined|-|미상|해당 없음|언급 없음)$/i.test(t) ? "" : t;
}

/** '초등학교 5학년' · '초5' · '중학교 2학년' · '고등학교 1학년' → 초5·중2·고1(프롬프트 선택지). 못 읽으면 그대로. */
export function canonicalGrade(v: string): string {
  const t = v.replace(/\s/g, "");
  const m = t.match(/^(초등학교|초등|초|중학교|중학생|중등|중|고등학교|고등학생|고등|고)(\d)(?:학년)?$/);
  if (!m) return v;
  const head = m[1].startsWith("초") ? "초" : m[1].startsWith("중") ? "중" : "고";
  const n = Number(m[2]);
  const max = head === "초" ? 6 : 3;
  return n >= 1 && n <= max ? `${head}${n}` : v;
}

function canonicalGender(v: string): string {
  if (/^(남|남자|남학생|아들|male|m)$/i.test(v)) return "남";
  if (/^(여|여자|여학생|딸|female|f)$/i.test(v)) return "여";
  return v;
}

const RELATION_ALIASES: Record<string, (typeof RELATION_OPTIONS)[number]> = {
  어머니: "모", 엄마: "모", 모친: "모", 어머님: "모",
  아버지: "부", 아빠: "부", 부친: "부", 아버님: "부",
  할머니: "조모", 할머님: "조모", 할아버지: "조부", 할아버님: "조부",
};
function canonicalRelation(v: string): string {
  if ((RELATION_OPTIONS as readonly string[]).includes(v)) return v;
  return RELATION_ALIASES[v.replace(/\s/g, "")] ?? v;
}

/**
 * 상담 경로 — 선택지와 정확히 같으면 그대로, 아니면 **딱 하나**만 맞는 비슷한 말일 때만 그 선택지로.
 * 부정('소개받은 적 없음' · '검색은 안 함')이 들어 있으면 고르지 않는다 — 그대로 두면 뒤 하네스가 선택지 밖이라 버린다.
 */
const PATH_NEGATION = /없|않|안\s*(함|했|하)|아니|말고|모르/;
const PATH_HINTS: [RegExp, (typeof CONSULTATION_PATHS)[number]][] = [
  [/지인|소개|아는\s?분/, "지인 소개"],
  [/검색|인터넷|네이버|구글/, "인터넷 검색"],
  [/블로그|카페|맘카페/, "블로그/카페"],
  [/간판|현수막/, "간판/현수막"],
  [/전단/, "전단지"],
  [/설명회/, "설명회"],
  [/재원생|다니는\s?(친구|학생)/, "재원생 추천"],
];
function canonicalPath(v: string): string {
  if ((CONSULTATION_PATHS as readonly string[]).includes(v)) return v;
  if (PATH_NEGATION.test(v)) return v;
  const hits = [...new Set(PATH_HINTS.filter(([re]) => re.test(v)).map(([, p]) => p))];
  return hits.length === 1 ? hits[0] : v;
}

function canonicalStatus(v: string): string {
  if ((REGISTRATION_STATUSES as readonly string[]).includes(v)) return v;
  const t = v.replace(/\s/g, "");
  const hit = REGISTRATION_STATUSES.find((s) => s.replace(/\s/g, "") === t);
  return hit ?? v;
}

/** 과목 — 프롬프트 선택지(수학/영어/국어/과학/기타). 내부 키(math 등)로 오면 한글로. */
function canonicalSubject(v: string): string {
  const hit = SUBJECT_TABS.find((t) => t.key === v.toLowerCase() || t.label === v);
  return hit ? hit.label : v;
}

/** 010-0000-0000(10자리는 010-000-0000). 숫자가 그 길이가 아니면 그대로(뒤 하네스가 거른다). */
export function canonicalPhone(v: string): string {
  const d = v.replace(/\D/g, "");
  if (/^01\d{9}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (/^01\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return v;
}

/**
 * 'YYYY.MM.DD' · 'YYYY/M/D' · 'YYYY년 M월 D일' · 'YYYY-MM-DD' → YYYY-MM-DD. 날짜 꼴이 아니면 그대로(뒤 하네스가 거른다).
 * 🔴 날짜 꼴인데 **달력에 없는 날**(2월 31일·13월)은 빈 칸 — 그대로 두면 하네스의 꼴 검사를 지나 DB가 거절하고,
 *    같은 묶음의 다른 칸·'완료' 상태까지 함께 안 써진다(2026-10-19 리뷰).
 */
export function canonicalDate(v: string): string {
  const m = v.match(/^(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?\.?$/);
  if (!m) return v;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return "";
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * 셔틀 — 참거짓 값만 "true"/"false" 글자로 바꾼다(flash가 참거짓 값으로 낸 적 있다). 글자는 그대로 둔다 —
 * 무엇을 '신청'으로 볼지는 뒤 하네스(`buildFormPatch` asBoolTrue)가 정한다(셔틀은 한 번 켜면 자동으로 끄지 않는 칸).
 */
function canonicalShuttle(v: unknown): string {
  if (v === true) return "true";
  if (v === false) return "false";
  return str(v);
}

/** 과목 상세의 과목 키 — 내부 키(math)든 한글 이름(수학)이든 내부 키로(뒤 하네스 `subjectKey`도 둘 다 받는다). */
function subjectDetailKey(v: string): string | null {
  return SUBJECT_TABS.find((t) => t.key === v || t.label === v)?.key ?? null;
}

/**
 * AI 응답(JSON 파싱 직후) → 기존과 같은 모양의 양식 추출값.
 * 모든 칸은 문자열(셔틀은 참거짓 값만 "true"/"false"로) · 모르는 칸은 버린다 · 과목 상세는 아는 과목(내부 키·한글 이름)·칸만 문자열로.
 */
export function normalizeExtractedForm(raw: unknown): ExtractedConsultationForm {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: ExtractedConsultationForm = {};
  for (const k of TEXT_KEYS) out[k] = str(r[k]);
  out.grade = out.grade ? canonicalGrade(out.grade) : "";
  out.gender = out.gender ? canonicalGender(out.gender) : "";
  out.parentRelation = out.parentRelation ? canonicalRelation(out.parentRelation) : "";
  out.consultationPath = out.consultationPath ? canonicalPath(out.consultationPath) : "";
  out.registrationStatus = out.registrationStatus ? canonicalStatus(out.registrationStatus) : "";
  out.subject = out.subject ? canonicalSubject(out.subject) : "";
  out.parentPhone = out.parentPhone ? canonicalPhone(out.parentPhone) : "";
  out.birthDate = out.birthDate ? canonicalDate(out.birthDate) : "";
  out.shuttleBusRequest = canonicalShuttle(r.shuttleBusRequest);
  const sd = r.subjectDetails && typeof r.subjectDetails === "object" && !Array.isArray(r.subjectDetails) ? r.subjectDetails : {};
  const details: Record<string, Record<string, string>> = {};
  for (const [subj, fields] of Object.entries(sd as Record<string, unknown>)) {
    const key = subjectDetailKey(subj);
    if (!key || !fields || typeof fields !== "object" || Array.isArray(fields)) continue;
    const row: Record<string, string> = details[key] ?? {};
    for (const [f, v] of Object.entries(fields as Record<string, unknown>)) if (!row[f]) row[f] = str(v);
    details[key] = row;
  }
  out.subjectDetails = details;
  return out;
}
