// 직원 이력서(웹 작성 폼) — 종이 서식("인재원 이력서.docx") 5개 섹션을 구조화한 폼 문서.
// 작성본은 academy_documents(kind='form', form_type='staff_resume', 분류 인사·직원, restricted=true)에
// 저장돼 데이터베이스 탐색기에도 나타난다. 클라/서버 공용 — server-only 금지 [[#61]].

export const RESUME_FORM_TYPE = "staff_resume";

// 종이 서식과 동일한 고정 행 수(학력 4·경력 3·자격증 3·외국어 3).
export const EDU_ROWS = 4;
export const CAREER_ROWS = 3;
export const CERT_ROWS = 3;
export const LANG_ROWS = 3;

export const WORKDAYS = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
  { key: "sun", label: "일" },
] as const;

export const EMPLOYMENT_TYPES = ["정규직", "아르바이트", "프리랜서"] as const;

// 회사 구분 — 신규 직원명부(구글시트) '회사명' 열과 같은 선택지(2026-07-16 원장 지정 목록).
export const RESUME_COMPANIES = [
  "(주)곰돌이(강의하는아이들인재원)",
  "고등수학관(지점)",
  "북대구지점",
  "EIE인재원",
  "파라엑스",
  "연구소",
] as const;

// 소속부서 — 고정 4개 선택지(원장 지정). 계약사항의 근무부서(자유입력)와는 별개 칸.
export const RESUME_DEPARTMENTS = ["영어과", "수학과", "경영지원", "기타과목"] as const;

/**
 * 로컬 초안(IndexedDB)에 **남기면 안 되는** 필드 — 주민번호·주소·계좌·급여.
 * 이력서 열람은 재인증(step-up)으로 잠그는데, 초안 자동저장이 같은 값을 브라우저 디스크에 평문으로
 * 남기면 그 잠금이 통째로 무의미해진다(로그인조차 없이 DevTools에서 읽힘). `useFormDraft`의 exclude로 넘긴다.
 * ⚠️ 새 민감 칸을 추가하면 여기에도 넣을 것 — 초안은 name 가진 폼 컨트롤을 **전부** 캡처한다.
 */
export const RESUME_DRAFT_EXCLUDE: string[] = [
  "p_residentId",
  "p_address",
  "c_bank",
  "c_account",
  "c_salaryMonthly",
  "c_salaryAnnual",
  ...Array.from({ length: CAREER_ROWS }, (_, i) => `car_${i}_salary`),
];

export type ResumeEducation = { period: string; school: string; major: string; gpa: string; location: string };
export type ResumeCareer = { company: string; period: string; duties: string; salary: string; leaveReason: string };
export type ResumeCert = { name: string; date: string; issuer: string };
export type ResumeLanguage = { name: string; testDate: string; score: string };

export type StaffResumeData = {
  personal: { name: string; nameEn: string; residentId: string; address: string; phone: string; email: string };
  education: ResumeEducation[];
  career: ResumeCareer[];
  certificates: ResumeCert[];
  languages: ResumeLanguage[];
  contract: {
    company: string; // 회사 구분 — RESUME_COMPANIES 중 하나 또는 ""
    division: string; // 소속부서 — RESUME_DEPARTMENTS 중 하나 또는 ""
    manager: string; // 담당자(회사 측 채용 담당) — 자유입력
    department: string;
    workDays: string[]; // WORKDAYS key 배열
    salaryMonthly: string;
    salaryAnnual: string;
    employmentType: string; // EMPLOYMENT_TYPES 중 하나 또는 ""
    bank: string;
    account: string;
    startDate: string; // YYYY-MM-DD
  };
};

const rows = <T,>(n: number, make: () => T): T[] => Array.from({ length: n }, make);

export function emptyResume(): StaffResumeData {
  return {
    personal: { name: "", nameEn: "", residentId: "", address: "", phone: "", email: "" },
    education: rows(EDU_ROWS, () => ({ period: "", school: "", major: "", gpa: "", location: "" })),
    career: rows(CAREER_ROWS, () => ({ company: "", period: "", duties: "", salary: "", leaveReason: "" })),
    certificates: rows(CERT_ROWS, () => ({ name: "", date: "", issuer: "" })),
    languages: rows(LANG_ROWS, () => ({ name: "", testDate: "", score: "" })),
    contract: {
      company: "",
      division: "",
      manager: "",
      department: "",
      workDays: [],
      salaryMonthly: "",
      salaryAnnual: "",
      employmentType: "",
      bank: "",
      account: "",
      startDate: "",
    },
  };
}

/** 선택지 화이트리스트 — 목록 밖 값(변조·옛 데이터)은 빈 값으로 떨어뜨린다. */
const pick = (v: string, allow: readonly string[]) => (allow.includes(v) ? v : "");

/**
 * FormData → 구조화 데이터. 필드 name 규약: p_*, edu_N_*, car_N_*, cert_N_*, lang_N_*, c_*.
 * 근무요일 체크박스는 초안 자동저장 round-trip을 위해 요일별 고유 name(`c_workday_mon` 등, 값 "1").
 */
export function parseResumeForm(fd: FormData): StaffResumeData {
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  return {
    personal: {
      name: s("p_name"),
      nameEn: s("p_nameEn"),
      residentId: s("p_residentId"),
      address: s("p_address"),
      phone: s("p_phone"),
      email: s("p_email"),
    },
    education: rows(EDU_ROWS, () => 0).map((_, i) => ({
      period: s(`edu_${i}_period`),
      school: s(`edu_${i}_school`),
      major: s(`edu_${i}_major`),
      gpa: s(`edu_${i}_gpa`),
      location: s(`edu_${i}_location`),
    })),
    career: rows(CAREER_ROWS, () => 0).map((_, i) => ({
      company: s(`car_${i}_company`),
      period: s(`car_${i}_period`),
      duties: s(`car_${i}_duties`),
      salary: s(`car_${i}_salary`),
      leaveReason: s(`car_${i}_leaveReason`),
    })),
    certificates: rows(CERT_ROWS, () => 0).map((_, i) => ({
      name: s(`cert_${i}_name`),
      date: s(`cert_${i}_date`),
      issuer: s(`cert_${i}_issuer`),
    })),
    languages: rows(LANG_ROWS, () => 0).map((_, i) => ({
      name: s(`lang_${i}_name`),
      testDate: s(`lang_${i}_testDate`),
      score: s(`lang_${i}_score`),
    })),
    contract: {
      company: pick(s("c_company"), RESUME_COMPANIES),
      division: pick(s("c_division"), RESUME_DEPARTMENTS),
      manager: s("c_manager"),
      department: s("c_department"),
      workDays: WORKDAYS.filter((d) => fd.get(`c_workday_${d.key}`)).map((d) => d.key),
      salaryMonthly: s("c_salaryMonthly"),
      salaryAnnual: s("c_salaryAnnual"),
      employmentType: pick(s("c_employmentType"), EMPLOYMENT_TYPES),
      bank: s("c_bank"),
      account: s("c_account"),
      startDate: s("c_startDate"),
    },
  };
}

/** jsonb → 안전 정규화(누락 필드 보정 + 행 수 패딩) — 옛/변조 데이터에도 뷰·폼이 안 깨진다. */
export function normalizeResume(v: unknown): StaffResumeData {
  const base = emptyResume();
  if (!v || typeof v !== "object") return base;
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  const sect = (k: string) => (o[k] && typeof o[k] === "object" ? (o[k] as Record<string, unknown>) : {});
  const padRows = <T extends Record<string, string>>(arr: unknown, n: number, keys: (keyof T & string)[]): T[] => {
    const src = Array.isArray(arr) ? arr : [];
    return Array.from({ length: n }, (_, i) => {
      const row = (src[i] && typeof src[i] === "object" ? src[i] : {}) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const k of keys) out[k] = str(row[k]);
      return out as T;
    });
  };
  const p = sect("personal");
  const c = sect("contract");
  const validDays = new Set<string>(WORKDAYS.map((d) => d.key));
  return {
    personal: {
      name: str(p.name),
      nameEn: str(p.nameEn),
      residentId: str(p.residentId),
      address: str(p.address),
      phone: str(p.phone),
      email: str(p.email),
    },
    education: padRows<ResumeEducation>(o.education, EDU_ROWS, ["period", "school", "major", "gpa", "location"]),
    career: padRows<ResumeCareer>(o.career, CAREER_ROWS, ["company", "period", "duties", "salary", "leaveReason"]),
    certificates: padRows<ResumeCert>(o.certificates, CERT_ROWS, ["name", "date", "issuer"]),
    languages: padRows<ResumeLanguage>(o.languages, LANG_ROWS, ["name", "testDate", "score"]),
    contract: {
      company: pick(str(c.company), RESUME_COMPANIES),
      division: pick(str(c.division), RESUME_DEPARTMENTS),
      manager: str(c.manager),
      department: str(c.department),
      workDays: Array.isArray(c.workDays) ? c.workDays.map(String).filter((d) => validDays.has(d)) : [],
      salaryMonthly: str(c.salaryMonthly),
      salaryAnnual: str(c.salaryAnnual),
      employmentType: pick(str(c.employmentType), EMPLOYMENT_TYPES),
      bank: str(c.bank),
      account: str(c.account),
      startDate: str(c.startDate),
    },
  };
}

/** 저장 제목 — 데이터베이스 목록·직원 이력서 탭에 그대로 노출. */
export const resumeTitle = (d: StaffResumeData) => `직원 이력서 — ${d.personal.name || "(이름 미입력)"}`;
