import { stripAutoSuffix } from "@/features/admin/duplicate-candidates";
import { samePersonGroups, type PersonRow } from "@/features/enrollment/same-person";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { addCalendarMonths, isDay } from "./dates";

export type ReferrerCandidate = { id: string; name: string; school: string | null; grade: string | null; parentPhone: string | null;
  makeeduNo: string | null; excluded: boolean; billMonths: readonly string[];
  enrollments: readonly { startDate: string; endDate: string | null; onHold: boolean; isTransferred?: boolean }[] };
export type BackfillConsultation = PersonRow & { day: string; referrerName: string | null; path: string | null; body: string | null;
  referrerStudentId: string | null; referrerStaffId: string | null;
  /** 소개자에게 명시된 속성만. 상담 대상 학생의 학교·학년은 전달하지 않는다. */
  mentionedSchool?: string | null; mentionedGrade?: string | null };
export type BackfillResult = { consultationId: string; state: "automatic" | "review" | "unavailable" | "linked";
  candidateId: string | null; candidates: string[]; reasons: string[]; guards: string[]; evidence: string | null };
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compact = (s: string | null | undefined) => (s ?? "").replace(/\s/g, "");
const schoolKey = (s: string | null | undefined) => compact(s).replace(/초등학교/g, "초").replace(/중학교/g, "중").replace(/고등학교/g, "고");
const containsName = (text: string, name: string) => new RegExp(`(?<![가-힣A-Za-z])${escape(name)}(?=$|[^가-힣A-Za-z]|(?:의|이|가|와|과|은|는|을|를)(?:\\s|$)|소개|추천|친구|엄마)`).test(text);

/** D3: 지난 소개 백필 전용. 이 함수는 연결 후보만 반환하며 DB를 쓰지 않는다. */
export function judgeBackfill(row: BackfillConsultation, all: readonly ReferrerCandidate[], staffNames: readonly string[]): BackfillResult {
  const out: BackfillResult = { consultationId: row.id, state: "review", candidateId: null, candidates: [], reasons: [], guards: [], evidence: null };
  if (row.referrerStudentId || row.referrerStaffId) return { ...out, state: "linked", reasons: ["이미 연결됨"] };
  if (!isDay(row.day)) return { ...out, reasons: ["상담일 확인 필요"] };
  const students = all.filter((s) => !s.excluded);
  const text = [row.referrerName, row.body].filter(Boolean).join("\n");
  const mentioned = students.filter((s) => containsName(text, s.name) || containsName(text, stripAutoSuffix(s.name)));
  out.candidates = mentioned.map((s) => s.id);
  if (!mentioned.length) return { ...out, state: row.referrerName?.trim() ? "review" : "unavailable", reasons: ["소개자 이름 확인 필요"] };
  const families = new Set(mentioned.map((s) => stripAutoSuffix(s.name)));
  if (families.size !== 1) return { ...out, reasons: ["서로 다른 소개 후보"] };
  const family = students.filter((s) => stripAutoSuffix(s.name) === [...families][0]);
  const numbers = new Set(family.map((s) => s.makeeduNo).filter(Boolean));
  if (numbers.size > 1) return { ...out, reasons: ["동명이인 원생번호 충돌"] };
  const exact = family.filter((s) => containsName(text, s.name));
  const candidate = family.length === 1 ? family[0] : exact.length === 1 && exact[0]!.name !== stripAutoSuffix(exact[0]!.name) ? exact[0] : null;
  if (!candidate) return { ...out, reasons: ["동명이인 확인 필요"] };
  out.candidateId = candidate.id;
  out.guards.push("unique_name");
  const month = row.day.slice(0, 7);
  const previous = addCalendarMonths(`${month}-01`, -1).slice(0, 7);
  if (!candidate.billMonths.some((m) => m === month || m === previous)
    && !candidate.enrollments.some((e) => isEnrollmentActiveOn(e, row.day))) out.reasons.push("상담일 재원 근거 없음");
  else out.guards.push("enrolled_on_date");
  const names = [...new Set([candidate.name, stripAutoSuffix(candidate.name)])];
  const direct = names.some((name) => containsName(row.referrerName ?? "", name));
  const pattern = new RegExp(`(?<![가-힣A-Za-z])(?:${names.map(escape).join("|")})\\s*(?:의\\s*)?(?:소개|추천|친구|엄마)`);
  const context = /(소개|추천)/.test(row.path ?? "") && pattern.test(row.body ?? "");
  if (!direct && !context) out.reasons.push("소개 문맥 확인 필요");
  else { out.guards.push("referral_context"); out.evidence = direct ? row.referrerName : pattern.exec(row.body ?? "")?.[0] ?? null; }
  const self: PersonRow = { id: `candidate:${candidate.id}`, student_id: candidate.id, prospect_name: candidate.name,
    prospect_school: candidate.school, prospect_grade: candidate.grade, parent_phone: candidate.parentPhone };
  const groups = samePersonGroups([row, self]);
  if (groups.get(row.id) === groups.get(self.id)) out.reasons.push("본인 소개");
  if (staffNames.some((name) => stripAutoSuffix(name) === stripAutoSuffix(candidate.name))) out.reasons.push("직원 이름과 겹침");
  if (!out.reasons.includes("본인 소개") && !out.reasons.includes("직원 이름과 겹침")) out.guards.push("no_conflict");
  // 소개자 이름이 나온 문장만 본다. 상담 대상 원생의 학교·학년 칸은 소개자 속성이 아니다.
  const attributeText = [row.referrerName, ...(row.body ?? "").split(/[\n.!?]/).filter((line) => names.some((name) => containsName(line, name)))].join(" ");
  const schools = [...attributeText.matchAll(/(?:^|[\s(（])([가-힣]{2,}(?:초등학교|중학교|고등학교|초|중|고))(?=\s|[1-6)）]|$)/g)].map((m) => m[1]!);
  const grades = [...attributeText.matchAll(/(?:초|중|고)(?:등학교|학교)?\s*([1-6])(?:학년)?|([1-6])\s*학년/g)].map((m) => m[1] ?? m[2]);
  const gradeNumber = candidate.grade?.match(/[1-6]/)?.[0];
  if ((row.mentionedSchool && schoolKey(row.mentionedSchool) !== schoolKey(candidate.school))
    || (row.mentionedGrade && compact(row.mentionedGrade) !== compact(candidate.grade))
    || schools.some((school) => schoolKey(school) !== schoolKey(candidate.school))
    || grades.some((grade) => grade !== gradeNumber)) out.reasons.push("소개자 학교·학년 불일치");
  else out.guards.push("matching_attributes");
  out.state = out.reasons.length ? "review" : "automatic";
  return out;
}
