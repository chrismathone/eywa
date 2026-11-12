// 등록상담 녹음 분석 → 폼 자동입력 매핑 (순수 함수, ⚠️ server-only 금지 [[#61]] — Vitest 대상).
// ijw processRegistrationRecording의 "폼 필드 추출 → ConsultationRecord 자동 채우기"를 aywa 컬럼에 이식.
// 핵심 규칙: 비어있는 필드만 채운다(상담사 수기 입력을 절대 덮어쓰지 않음).
import { canonicalSchoolName, type SchoolSaveAlias } from "@/features/schools/school-name";
import {
  RELATION_OPTIONS,
  CONSULTATION_PATHS,
  GENDER_OPTIONS,
  SUBJECT_TABS,
} from "./form-config";

/** AI가 전사에서 추출하는 폼 필드(전부 선택적, 미언급은 빈 문자열/누락). */
export type ExtractedConsultationForm = {
  schoolName?: string;
  grade?: string;
  parentName?: string;
  parentPhone?: string;
  parentRelation?: string;
  gender?: string;
  birthDate?: string;
  address?: string;
  consultationPath?: string;
  careerGoal?: string;
  siblings?: string;
  safetyNotes?: string;
  shuttleBusRequest?: string | boolean;
  registrationStatus?: string;
  subject?: string;
  parentRequest?: string;
  prevAcademy?: string;
  lastScore?: string;
  weakSubjects?: string;
  followUpContent?: string;
  nonRegistrationReason?: string;
  subjectDetails?: Record<string, Record<string, string>>;
};

/** 현재 행 값 — 빈 값만 채우기 위한 비교 기준. null/빈문자 = 비어있음. */
export type CurrentConsultationValues = {
  prospectGrade?: string | null;
  prospectSchool?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  parentRelation?: string | null;
  gender?: string | null;
  birthDate?: string | null;
  address?: string | null;
  consultationPath?: string | null;
  careerGoal?: string | null;
  siblings?: string | null;
  safetyNotes?: string | null;
  shuttleBusRequest?: boolean | null;
  registrationStatus?: string | null;
  subject?: string | null;
  parentRequest?: string | null;
  learningHistory?: { prevAcademy?: string; lastScore?: string; weakSubjects?: string[] } | null;
  followUpContent?: string | null;
  nonRegistrationReason?: string | null;
  subjectDetails?: Record<string, Record<string, string>> | null;
};

function clean(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t && t !== "-" ? t : undefined;
}
const isEmpty = (v: string | null | undefined) => v == null || String(v).trim() === "";

function pickEnum(v: string | undefined, options: readonly string[]): string | undefined {
  if (!v) return undefined;
  return options.includes(v) ? v : undefined;
}
function normGender(v: string | undefined): string | undefined {
  if (!v) return undefined;
  if (/남|^male$/i.test(v)) return "male";
  if (/여|^female$/i.test(v)) return "female";
  return pickEnum(v, GENDER_OPTIONS.map((g) => g.value));
}
function isoDate(v: string | undefined): string | undefined {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}
function subjectKey(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const hit = SUBJECT_TABS.find((t) => t.key === v || t.label === v);
  return hit?.key;
}
function asBoolTrue(v: string | boolean | undefined): boolean {
  return v === true || v === "true" || v === "예" || v === "신청";
}

/**
 * 약점 단원 목록 — 쉼표·가운뎃점·빗금에서 나누되 **괄호 안은 나누지 않는다**(2026-10-26). Claude는 묶음을 괄호로 적는다
 * ('문법(분사, 동명사, 능동태·수동태)') — 예전처럼 다 나누면 '문법(분사'·'수동태)' 같은 깨진 칩이 저장됐다(시험 15건 중 4건).
 * 괄호가 없으면 예전과 똑같이 나뉜다(옛 저장본 20건 중 달라지는 것 0건).
 */
export function splitOutsideParens(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
    if (depth === 0 && /[,、·/]/.test(ch)) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * 추출 JSON → enrollment_consultations DB 패치(snake_case 컬럼). 빈 필드만 포함.
 * jsonb(learning_history·subject_details)는 하위 키 단위로 빈 곳만 병합.
 */
export function buildFormPatch(
  ex: ExtractedConsultationForm,
  cur: CurrentConsultationValues,
  opts?: {
    studentName?: string | null;
    transcript?: string | null;
    /** 학교명 저장 별칭(학원설정 `operations.schoolSaveAliases`) — 호출부가 그 학원 값을 넘긴다. */
    schoolAliases?: readonly SchoolSaveAlias[];
    /** 셔틀 모듈이 꺼진 지점은 추출값을 저장하지 않는다. 미지정은 옛 호출부 호환을 위해 켜짐. */
    shuttleOn?: boolean;
  },
): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const fill = (col: string, curVal: string | null | undefined, val: string | undefined) => {
    if (isEmpty(curVal) && val) p[col] = val;
  };

  // ── 후보정 하네스: 약한 모델(Solar)의 실측 오류 패턴 차단 (2026-06-24) ──
  // 스키마힌트 누출/무효 enum은 기존 pickEnum이 이미 차단. 여기선 그 외 4종을 막는다:
  // (1) 환각 고유명사  (2) 학생이름 echo  (3) 일반호칭=이름 오인  (4) 한글자 잡음.
  // transcript 미제공 시 grounding 비활성(후방호환 — 기존 테스트/호출부 무영향).
  const tnorm = (opts?.transcript ?? "").replace(/\s/g, "");
  const studentN = (opts?.studentName ?? "").replace(/\s/g, "");
  const inTranscript = (token: string) =>
    !tnorm || tnorm.includes(token) || (token.length >= 3 && tnorm.includes(token.slice(0, 3)));
  // 고유명사(학교·학원·주소·이름)는 전사에 실제 등장해야 통과 → 환각("수중학교" 등) 차단.
  const grounded = (v: string | undefined) => {
    if (!v) return undefined;
    const token = v.split(/[(),/·\s]/)[0].replace(/\s/g, "");
    return token.length >= 2 && inTranscript(token) ? v : undefined;
  };
  // 학생 본인 이름을 엉뚱한 필드에 복사한 경우(schoolName=학생명 등) 거부.
  const notEcho = (v: string | undefined) =>
    v && studentN && v.replace(/\s/g, "") === studentN ? undefined : v;
  // 일반 호칭은 이름이 아니다(parentName="어머니" 등).
  const realName = (v: string | undefined) =>
    v && /^(어머니|아버지|엄마|아빠|모친|부친|보호자|학부모|부모|아들|딸|학생|모|부)$/.test(v.trim())
      ? undefined
      : v;
  // 한 글자/잡음 거부(lastScore="6" 등).
  const meaningful = (v: string | undefined) => (v && v.trim().length >= 2 ? v : undefined);
  // 전화번호 형태(9~11자리)만.
  const phoneOk = (v: string | undefined) => {
    if (!v) return undefined;
    const d = v.replace(/\D/g, "");
    return d.length >= 9 && d.length <= 11 ? v : undefined;
  };
  // 학년은 미취학(6·7세)·초1~고3 형식만(예: "중학교" 같은 비형식·오학년 거부).
  // ⚠️ 여기 허용 집합은 **학원설정 학년 목록(defaults.ts)과 같은 범위**로 유지할 것 — 설정에 없는 값을
  //    써 넣으면 상담 수정 폼의 <select>에 그 옵션이 없어, 다른 칸만 고쳐 저장해도 학년이 지워진다.
  const gradeOk = (v: string | undefined) =>
    v && /^([67]세|초[1-6]|중[1-3]|고[1-3])$/.test(v.trim()) ? v : undefined;
  // 모델이 불확실/빈값을 값처럼 적은 경우 거부.
  const notUncertain = (v: string | undefined) => {
    if (!v) return undefined;
    if (/(미확인|확인\s*필요|미상|불명|추정|미정|\?|X{2,})/i.test(v)) return undefined; // 불확실 마커(부분일치)
    // 빈값 마커가 값 전체인 경우(미언급/없음/모름 등) — "특이사항 없음" 같은 부분 포함은 보존.
    if (/^\s*(미언급|언급\s*없음|없음|해당\s*없음|해당\s*사항\s*없음|정보\s*없음|N\/?A|모름)\s*$/i.test(v))
      return undefined;
    return v;
  };
  // 학교명 꼴(초·중·고·교·원 끝 또는 '학교' 포함)만 — ASR 잡음 "호표학" 같은 비학교명 거부.
  const schoolShape = (v: string | undefined) =>
    v && (/(초|중|고|교|원)$/.test(v.trim()) || /(학교|초등|중등|고등)/.test(v)) ? v : undefined;

  fill("prospect_grade", cur.prospectGrade, gradeOk(clean(ex.grade)));
  // 🔴 AI 자동입력도 **저장 표기로 강제 정규화**한다(원장 2026-09-01) — 이 경로는 buildConsultationRow를
  // 안 거치고 웹훅이 DB에 바로 쓰므로, 여기를 빼면 전사에서 뽑은 "칠성초등학교"가 그대로 남는다.
  // ⚠️ 정규화는 **grounding 뒤**에 한다(전사에 실제로 나온 값인지 먼저 확인하고, 표기만 다듬는다).
  const schoolValue = grounded(schoolShape(notUncertain(notEcho(clean(ex.schoolName)))));
  fill("prospect_school", cur.prospectSchool, canonicalSchoolName(schoolValue, opts?.schoolAliases) ?? undefined);
  fill("parent_name", cur.parentName, grounded(realName(notUncertain(notEcho(clean(ex.parentName))))));
  fill("parent_phone", cur.parentPhone, phoneOk(clean(ex.parentPhone)));
  fill("parent_relation", cur.parentRelation, pickEnum(clean(ex.parentRelation), RELATION_OPTIONS));
  fill("gender", cur.gender, normGender(clean(ex.gender)));
  fill("birth_date", cur.birthDate, isoDate(clean(ex.birthDate)));
  fill("address", cur.address, grounded(notUncertain(clean(ex.address))));
  fill("consultation_path", cur.consultationPath, pickEnum(clean(ex.consultationPath), CONSULTATION_PATHS));
  fill("career_goal", cur.careerGoal, notUncertain(meaningful(clean(ex.careerGoal))));
  fill("siblings", cur.siblings, notUncertain(notEcho(meaningful(clean(ex.siblings)))));
  fill("safety_notes", cur.safetyNotes, clean(ex.safetyNotes));
  // 상태는 후속 조치·칸반에서 정한다. 옛 AI 응답의 registrationStatus도 저장하지 않는다.
  fill("subject", cur.subject, subjectKey(clean(ex.subject)));
  fill("parent_request", cur.parentRequest, clean(ex.parentRequest));
  fill("follow_up_content", cur.followUpContent, clean(ex.followUpContent));
  fill("non_registration_reason", cur.nonRegistrationReason, clean(ex.nonRegistrationReason));

  // 셔틀 — 기본 false라 "비어있음"이 모호. 추출이 명확히 true일 때만 켜고, 절대 끄지 않음.
  if (opts?.shuttleOn !== false && asBoolTrue(ex.shuttleBusRequest) && cur.shuttleBusRequest !== true) {
    p.shuttle_bus_request = true;
  }

  // learning_history jsonb — 하위 키 단위로 빈 곳만 채움.
  const lh = cur.learningHistory ?? {};
  const mergedLh: { prevAcademy?: string; lastScore?: string; weakSubjects?: string[] } = { ...lh };
  let lhChanged = false;
  const exPrevAcademy = grounded(notUncertain(notEcho(meaningful(clean(ex.prevAcademy))))); // 환각·불확실 학원명 차단
  if (isEmpty(lh.prevAcademy) && exPrevAcademy) {
    mergedLh.prevAcademy = exPrevAcademy;
    lhChanged = true;
  }
  const exLastScore = notUncertain(meaningful(clean(ex.lastScore))); // "6" 잡음·불확실 차단
  if (isEmpty(lh.lastScore) && exLastScore) {
    mergedLh.lastScore = exLastScore;
    lhChanged = true;
  }
  if ((!lh.weakSubjects || lh.weakSubjects.length === 0) && clean(ex.weakSubjects)) {
    const list = splitOutsideParens(clean(ex.weakSubjects)!);
    if (list.length > 0) {
      mergedLh.weakSubjects = list;
      lhChanged = true;
    }
  }
  if (lhChanged) p.learning_history = mergedLh;

  // subject_details jsonb — 과목별·필드별 빈 곳만 병합(유효 과목 키만).
  if (ex.subjectDetails && typeof ex.subjectDetails === "object") {
    const curSd = cur.subjectDetails ?? {};
    const mergedSd: Record<string, Record<string, string>> = {};
    let sdChanged = false;
    for (const [subj, fields] of Object.entries(ex.subjectDetails)) {
      if (!subjectKey(subj) || !fields || typeof fields !== "object") continue;
      const key = subjectKey(subj)!;
      const curFields = curSd[key] ?? {};
      const merged = { ...curFields };
      for (const [fk, fv] of Object.entries(fields)) {
        const val = clean(fv);
        if (val && isEmpty(curFields[fk])) {
          merged[fk] = val;
          sdChanged = true;
        }
      }
      mergedSd[key] = merged;
    }
    if (sdChanged) p.subject_details = { ...curSd, ...mergedSd };
  }

  return p;
}
