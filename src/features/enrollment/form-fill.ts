// 등록상담 녹음 분석 → 폼 자동입력 매핑 (순수 함수, ⚠️ server-only 금지 [[#61]] — Vitest 대상).
// ijw processRegistrationRecording의 "폼 필드 추출 → ConsultationRecord 자동 채우기"를 eywa 컬럼에 이식.
// 핵심 규칙: 비어있는 필드만 채운다(상담사 수기 입력을 절대 덮어쓰지 않음).
import {
  RELATION_OPTIONS,
  CONSULTATION_PATHS,
  REGISTRATION_STATUSES,
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
 * 추출 JSON → enrollment_consultations DB 패치(snake_case 컬럼). 빈 필드만 포함.
 * jsonb(learning_history·subject_details)는 하위 키 단위로 빈 곳만 병합.
 */
export function buildFormPatch(
  ex: ExtractedConsultationForm,
  cur: CurrentConsultationValues,
): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const fill = (col: string, curVal: string | null | undefined, val: string | undefined) => {
    if (isEmpty(curVal) && val) p[col] = val;
  };

  fill("prospect_grade", cur.prospectGrade, clean(ex.grade));
  fill("prospect_school", cur.prospectSchool, clean(ex.schoolName));
  fill("parent_name", cur.parentName, clean(ex.parentName));
  fill("parent_phone", cur.parentPhone, clean(ex.parentPhone));
  fill("parent_relation", cur.parentRelation, pickEnum(clean(ex.parentRelation), RELATION_OPTIONS));
  fill("gender", cur.gender, normGender(clean(ex.gender)));
  fill("birth_date", cur.birthDate, isoDate(clean(ex.birthDate)));
  fill("address", cur.address, clean(ex.address));
  fill("consultation_path", cur.consultationPath, pickEnum(clean(ex.consultationPath), CONSULTATION_PATHS));
  fill("career_goal", cur.careerGoal, clean(ex.careerGoal));
  fill("siblings", cur.siblings, clean(ex.siblings));
  fill("safety_notes", cur.safetyNotes, clean(ex.safetyNotes));
  fill("registration_status", cur.registrationStatus, pickEnum(clean(ex.registrationStatus), REGISTRATION_STATUSES));
  fill("subject", cur.subject, subjectKey(clean(ex.subject)));
  fill("parent_request", cur.parentRequest, clean(ex.parentRequest));
  fill("follow_up_content", cur.followUpContent, clean(ex.followUpContent));
  fill("non_registration_reason", cur.nonRegistrationReason, clean(ex.nonRegistrationReason));

  // 셔틀 — 기본 false라 "비어있음"이 모호. 추출이 명확히 true일 때만 켜고, 절대 끄지 않음.
  if (asBoolTrue(ex.shuttleBusRequest) && cur.shuttleBusRequest !== true) {
    p.shuttle_bus_request = true;
  }

  // learning_history jsonb — 하위 키 단위로 빈 곳만 채움.
  const lh = cur.learningHistory ?? {};
  const mergedLh: { prevAcademy?: string; lastScore?: string; weakSubjects?: string[] } = { ...lh };
  let lhChanged = false;
  if (isEmpty(lh.prevAcademy) && clean(ex.prevAcademy)) {
    mergedLh.prevAcademy = clean(ex.prevAcademy);
    lhChanged = true;
  }
  if (isEmpty(lh.lastScore) && clean(ex.lastScore)) {
    mergedLh.lastScore = clean(ex.lastScore);
    lhChanged = true;
  }
  if ((!lh.weakSubjects || lh.weakSubjects.length === 0) && clean(ex.weakSubjects)) {
    const list = clean(ex.weakSubjects)!
      .split(/[,、·/]/)
      .map((s) => s.trim())
      .filter(Boolean);
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
