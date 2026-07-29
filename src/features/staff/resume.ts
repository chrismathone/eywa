// 직원 이력서(웹 작성 폼) — 종이 서식("인재원 이력서.docx") 5개 섹션을 구조화한 폼 문서.
// 작성본은 academy_documents(kind='form', form_type='staff_resume', 분류 인사·직원, restricted=true)에
// 저장돼 데이터베이스 탐색기에도 나타난다. 클라/서버 공용 — server-only 금지 [[#61]].

export const RESUME_FORM_TYPE = "staff_resume";

// 종이 서식과 동일한 고정 행 수(학력 4·경력 3). 자격증·외국어는 동적 행(최소 1, 아래 MAX 캡).
export const EDU_ROWS = 4;
export const CAREER_ROWS = 3;
// 동적 섹션 상한 — 폼 변조·초안 폭주 방지용 안전 캡(정상 사용에선 닿지 않는다).
export const DYNAMIC_ROWS_MAX = 20;

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

// 근무부서 — 원장 지정 목록(2026-07-28 갱신: 소속부서·근무부서 두 칸을 이 한 칸으로 통합).
// users.department(0147a)·직원명부 시트 '소속부서' 열과 같은 축.
export const RESUME_DEPARTMENTS = ["영어과", "수학과", "EIE", "경영지원팀", "개발팀", "아르바이트"] as const;

// 옛 선택지 → 새 선택지 매핑(기존 저장 이력서가 화이트리스트 탈락으로 빈 값이 되지 않게).
// '기타과목'은 새 목록에 대응이 없어 빈 값(수동 재선택 대상).
const DEPT_LEGACY: Record<string, string> = { 경영지원: "경영지원팀" };

// 서류 확인 체크박스 4종(2026-07-28) — 했는지 여부만(boolean). 시트 기입은 'Y'/'' 텍스트.
export const RESUME_CHECKS = [
  { key: "sexCrime", label: "성범죄 조회" },
  { key: "childAbuse", label: "아동학대 조회" },
  { key: "eduOffice", label: "교육청 강사등록" },
  { key: "etcDocs", label: "기타 서류" },
] as const;
export type ResumeCheckKey = (typeof RESUME_CHECKS)[number]["key"];

// 증명사진 첨부 슬롯 수 — 직원 얼굴 구별용(원장 지시 2026-07-28). 열람은 이력서 재인증 게이트 뒤.
export const RESUME_PHOTO_SLOTS = 2;

// 원샷 직원 등록 초기 비밀번호(원장 지정) — 본인이 로그인 후 변경하는 전제. Supabase 최소 6자 충족.
export const INITIAL_STAFF_PASSWORD = "eywa123";

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
  /** 증명사진 스토리지 경로(최대 RESUME_PHOTO_SLOTS장) — 열람은 재인증 게이트 뒤 signed URL. */
  photos: string[];
  education: ResumeEducation[];
  career: ResumeCareer[];
  certificates: ResumeCert[];
  languages: ResumeLanguage[];
  /** 서류 확인 체크(RESUME_CHECKS) — 했는지 여부만. */
  checks: Record<ResumeCheckKey, boolean>;
  contract: {
    company: string; // 회사 구분 — RESUME_COMPANIES 중 하나 또는 ""
    division: string; // 근무부서(통합 단일 칸) — RESUME_DEPARTMENTS 중 하나 또는 ""
    jobTitle: string; // 직급 — 자유입력(2026-07-28 추가, 직원 등록 시 users.job_title로)
    manager: string; // 담당자(회사 측 채용 담당) — 자유입력
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

export const emptyCert = (): ResumeCert => ({ name: "", date: "", issuer: "" });
export const emptyLanguage = (): ResumeLanguage => ({ name: "", testDate: "", score: "" });

const emptyChecks = (): Record<ResumeCheckKey, boolean> =>
  Object.fromEntries(RESUME_CHECKS.map((c) => [c.key, false])) as Record<ResumeCheckKey, boolean>;

export function emptyResume(): StaffResumeData {
  return {
    personal: { name: "", nameEn: "", residentId: "", address: "", phone: "", email: "" },
    photos: [],
    education: rows(EDU_ROWS, () => ({ period: "", school: "", major: "", gpa: "", location: "" })),
    career: rows(CAREER_ROWS, () => ({ company: "", period: "", duties: "", salary: "", leaveReason: "" })),
    certificates: [emptyCert()],
    languages: [emptyLanguage()],
    checks: emptyChecks(),
    contract: {
      company: "",
      division: "",
      jobTitle: "",
      manager: "",
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
 * 부서 정규화 — 옛 선택지는 새 선택지로 매핑하고, **그 밖의 값은 그대로 보존**한다.
 * 화이트리스트로 잘라내면 시트 이관분의 실사용 부서(국어과·경영팀·차량팀 등 RESUME_DEPARTMENTS 밖)가
 * 이력서를 한 번 저장하는 것만으로 조용히 빈 값이 된다(원장 결정 2026-07-29: 드롭다운은 지정 6종 유지 +
 * 기존 값은 보존). 새 값은 드롭다운(6종)이 제한하므로 여기서 다시 자르지 않아도 임의 입력은 안 들어온다.
 */
const pickDept = (v: string) => (DEPT_LEGACY[v] ?? v).trim();

/**
 * FormData → 구조화 데이터. 필드 name 규약: p_*, edu_N_*, car_N_*, cert_N_*, lang_N_*, c_*, chk_*, photo_N.
 * 근무요일·서류 체크박스는 초안 자동저장 round-trip을 위해 항목별 고유 name(`c_workday_mon`·`chk_sexCrime`, 값 "1").
 * 자격증·외국어는 동적 행 — 폼에 존재하는 인덱스만큼 파싱(캡 DYNAMIC_ROWS_MAX), 최소 1행 보장.
 */
export function parseResumeForm(fd: FormData): StaffResumeData {
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const dynamic = <T,>(prefix: string, probe: string, make: (i: number) => T): T[] => {
    const out: T[] = [];
    for (let i = 0; i < DYNAMIC_ROWS_MAX; i++) {
      if (!fd.has(`${prefix}_${i}_${probe}`)) break;
      out.push(make(i));
    }
    return out;
  };
  const certificates = dynamic("cert", "name", (i) => ({
    name: s(`cert_${i}_name`),
    date: s(`cert_${i}_date`),
    issuer: s(`cert_${i}_issuer`),
  }));
  const languages = dynamic("lang", "name", (i) => ({
    name: s(`lang_${i}_name`),
    testDate: s(`lang_${i}_testDate`),
    score: s(`lang_${i}_score`),
  }));
  const photos: string[] = [];
  for (let i = 0; i < RESUME_PHOTO_SLOTS; i++) {
    const p = s(`photo_${i}`);
    if (p) photos.push(p);
  }
  return {
    personal: {
      name: s("p_name"),
      nameEn: s("p_nameEn"),
      residentId: s("p_residentId"),
      address: s("p_address"),
      phone: s("p_phone"),
      email: s("p_email"),
    },
    photos,
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
    certificates: certificates.length ? certificates : [emptyCert()],
    languages: languages.length ? languages : [emptyLanguage()],
    checks: Object.fromEntries(RESUME_CHECKS.map((c) => [c.key, Boolean(fd.get(`chk_${c.key}`))])) as Record<
      ResumeCheckKey,
      boolean
    >,
    contract: {
      company: pick(s("c_company"), RESUME_COMPANIES),
      division: pickDept(s("c_division")),
      jobTitle: s("c_jobTitle"),
      manager: s("c_manager"),
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
  // 동적 섹션: 저장된 행 수 그대로(최소 1·캡 DYNAMIC_ROWS_MAX) — 고정 패딩은 옛 3행 문서와 호환.
  const dynRows = <T extends Record<string, string>>(arr: unknown, keys: (keyof T & string)[], make: () => T): T[] => {
    const n = Array.isArray(arr) ? Math.min(Math.max(arr.length, 1), DYNAMIC_ROWS_MAX) : 1;
    const padded = padRows<T>(arr, n, keys);
    return padded.length ? padded : [make()];
  };
  const p = sect("personal");
  const c = sect("contract");
  const checks = sect("checks");
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
    photos: Array.isArray(o.photos)
      ? o.photos.map(String).filter(Boolean).slice(0, RESUME_PHOTO_SLOTS)
      : [],
    education: padRows<ResumeEducation>(o.education, EDU_ROWS, ["period", "school", "major", "gpa", "location"]),
    career: padRows<ResumeCareer>(o.career, CAREER_ROWS, ["company", "period", "duties", "salary", "leaveReason"]),
    certificates: dynRows<ResumeCert>(o.certificates, ["name", "date", "issuer"], emptyCert),
    languages: dynRows<ResumeLanguage>(o.languages, ["name", "testDate", "score"], emptyLanguage),
    checks: Object.fromEntries(RESUME_CHECKS.map((k) => [k.key, checks[k.key] === true])) as Record<
      ResumeCheckKey,
      boolean
    >,
    contract: {
      company: pick(str(c.company), RESUME_COMPANIES),
      division: pickDept(str(c.division)),
      jobTitle: str(c.jobTitle),
      manager: str(c.manager),
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
