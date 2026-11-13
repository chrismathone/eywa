import { z } from "zod";
import { canonicalSchoolName, type SchoolSaveAlias } from "@/features/schools/school-name";
import { phoneLabel } from "@/lib/format/phone";
const opt = z.string().optional().nullable();
export const createSchema = z.object({
  prospectName: z.string().min(1, "학생 이름을 입력해주세요"),
  prospectGrade: opt,
  prospectSchool: opt,
  parentName: opt,
  parentPhone: opt,
  parentRequest: opt, // 상담 내용
  prevAcademy: opt,
  lastScore: opt,
  // 등록 상담 폼 전체(0046a)
  englishName: opt,
  gender: opt,
  bloodType: opt,
  birthDate: opt,
  studentPhone: opt,
  homePhone: opt,
  parentRelation: opt,
  address: opt,
  zipCode: opt,
  addressDetail: opt,
  consultationPath: opt,
  subject: opt,
  careerGoal: opt,
  siblings: opt,
  safetyNotes: opt,
  followUpDate: opt,
  followUpContent: opt,
  nonRegistrationReason: opt,
  shuttleBusRequest: opt,
  privacyAgreement: opt,
  installmentAgreement: opt,
  subjectDetails: opt, // 과목 탭 JSON 문자열
  // 완전 이식(0064a) — ijw ConsultationForm 잔여 필드.
  counselor: opt,
  receivedDate: opt,
  studentType: opt,
  siblingsDetails: opt,
  consultationDate: opt, // 상담일 → consultation_date(전용 date 컬럼)
});

export type FullForm = z.infer<typeof createSchema>;

const asBool = (v?: string | null) => v === "true" || v === "on";

export function buildConsultationRow(d: FullForm, aliases: readonly SchoolSaveAlias[]) {
  let subjectDetails: unknown = null;
  if (d.subjectDetails) {
    try {
      subjectDetails = JSON.parse(d.subjectDetails);
    } catch {
      subjectDetails = null;
    }
  }
  return {
    prospect_name: d.prospectName,
    prospect_grade: d.prospectGrade || null,
    // 🔴 학교 표기는 **저장 시 강제 정규화**(원장 2026-09-01) — "옥산초등학교"·"일 중"이 그대로
    // 들어오면 같은 학교가 두 표기로 갈린다. 정본 = features/schools/school-name.ts.
    prospect_school: canonicalSchoolName(d.prospectSchool, aliases),
    english_name: d.englishName || null,
    gender: d.gender || null,
    blood_type: d.bloodType || null,
    birth_date: d.birthDate || null,
    student_phone: phoneLabel(d.studentPhone),
    home_phone: phoneLabel(d.homePhone),
    parent_name: d.parentName || null,
    parent_phone: phoneLabel(d.parentPhone),
    parent_relation: d.parentRelation || null,
    address: d.address || null,
    zip_code: d.zipCode || null,
    address_detail: d.addressDetail || null,
    consultation_path: d.consultationPath || null,
    subject: d.subject || null,
    career_goal: d.careerGoal || null,
    siblings: d.siblings || null,
    safety_notes: d.safetyNotes || null,
    // 옛 등록 상태·결제는 이관 기록이다. 폼 저장에서 제외해 기존 값도 보존한다.
    follow_up_date: d.followUpDate || null,
    follow_up_content: d.followUpContent || null,
    non_registration_reason: d.nonRegistrationReason || null,
    parent_request: d.parentRequest || null,
    shuttle_bus_request: asBool(d.shuttleBusRequest),
    privacy_agreement: asBool(d.privacyAgreement),
    installment_agreement: asBool(d.installmentAgreement),
    subject_details: subjectDetails,
    counselor: d.counselor || null,
    received_date: d.receivedDate || null,
    student_type: d.studentType || null,
    siblings_details: d.siblingsDetails || null,
    // 상담일 = 전용 date 컬럼. consulted_at(timestamptz, 정렬용)은 폼에서 절대 건드리지 않는다
    // — timestamptz에 date 문자열을 쓰면 KST↔UTC 하루밀림·시각 소실이 생김(적대리뷰 확정).
    consultation_date: d.consultationDate || null,
  };
}

