import { addDays } from "@/lib/date-kst";
import { dayOf } from "./dates";
import { tenureOf } from "./tenure";
import { homeworkOf, gradesOf, levelsOf, attendanceOf } from "./learning";
import { paymentsOf } from "./payments";
import type { CareRaw, CareCard, CareSection, Source } from "./types";

const won = (n: number | null) => n == null ? "확인 필요" : `${n.toLocaleString("ko-KR")}원`;
const pct = (n: number | null) => n == null ? "기록 부족" : `${n}%`;
const testLabel = (kind: string) => ({ placement: "입학 진단", promotion: "승급 평가", diagnostic: "진단 평가" } as Record<string, string>)[kind] ?? "레벨 평가";

export function buildCareCard(raw: CareRaw): CareCard {
  const { today, studentId } = raw;
  const subjectLabel = (key: string) => raw.subjectLabels[key] ?? "과목 미확인";
  const sections: CareSection[] = [];
  const missing: string[] = [], reasons: string[] = [];
  const groups = new Set<string>();
  if (!Object.keys(raw.subjectLabels).length) missing.push("과목 설정 확인");
  const section = (key: string, title: string, tab: string, src: Source<unknown>, summary: string, details: string[]) => {
    sections.push({ key, title, href: `/students/${studentId}?tab=${tab}`, state: src.state,
      summary: src.state === "failed" ? "자료를 불러오지 못했습니다" : src.state === "restricted" ? "열람 권한이 필요합니다" : summary,
      details: src.state === "ready" ? details : [] });
  };
  const tenure = tenureOf(raw.enrollments.rows, today, raw.enrolledAt);
  section("tenure", "재원 이력", "classes", raw.enrollments,
    tenure.registeredDays == null ? "수강 기간 확인 필요" : `등록 구간 합계 ${tenure.registeredDays}일`,
    [`기록상 첫 입학·수강일: ${tenure.first ?? "확인 필요"}`,
      tenure.currentDays == null ? "현재 연속 구간: 확인 필요 또는 휴원·종료" : `현재 연속 등록 구간: ${tenure.currentDays}일`,
      "과목 간 겹친 날짜는 한 번만 셉니다. 과거 휴원일수는 미차감이며 실제 출석일수가 아닙니다.",
      ...(tenure.invalid ? [`날짜를 확인할 수 없는 수강 ${tenure.invalid}건은 기간 합계에서 제외했습니다.`] : [])]);
  const money = paymentsOf(raw.invoices.rows);
  section("payments", "누적 수강료", "billing", raw.invoices,
    money.tuitionPaid == null ? "수강료 납부기록 확인 필요" : `확인된 수강료 납부기록 ${won(money.tuitionPaid)}`,
    [`전체 항목 납부기록: ${won(money.recordedPaid)} · 수강료 환불기록: ${won(money.recordedRefunds)}`,
      `검증된 수강료 순납부액: ${won(money.netTuition)}`,
      `청구 기록 범위: ${money.from ?? "미확인"} ~ ${money.to ?? "미확인"} · ${money.count}건`,
      "이관 전 납부는 포함되지 않을 수 있습니다. 납부액은 지원 등급에 반영하지 않습니다.",
      ...(money.netTuition == null ? ["환불 반영 방식이나 항목별 자료가 불명확하면 순납부액을 계산하지 않습니다."] : []),
      ...(money.unknownLines ? [`수강료 분류·납부액 확인 필요 ${money.unknownLines}건은 수강료 합계에서 제외했습니다.`] : []),
      ...(money.conflict ? ["청구서 합계와 항목별 납부액 또는 중복 기록이 일치하지 않아 금액을 표시하지 않습니다."] : [])]);
  const homework = homeworkOf(raw.reports.rows, today);
  section("homework", "숙제 수행", "progress", raw.reports, "최근 4주와 직전 4주 비교",
    homework.length ? homework.map((r) => `${subjectLabel(r.subject)}: ${pct(r.previous)} → ${pct(r.recent)} · 평가 ${r.previousCount}/${r.recentCount}건 · 미기록 ${r.missing}건${r.delta == null ? " · 비교 자료 부족" : ` · ${r.delta > 0 ? "+" : ""}${r.delta}%p`}`)
      .concat("교사가 기록한 수행률의 평균입니다. 과목별 두 기간 모두 4건 이상일 때 변화 신호를 확인합니다.") : ["숙제 평가 기록이 없습니다. 미기록은 미제출 0%와 다릅니다."]);
  for (const r of homework.filter((r) => r.flag)) { groups.add("homework"); reasons.push(`${subjectLabel(r.subject)} 숙제 수행률 ${Math.abs(r.delta!)}%p 하락`); }
  if (raw.reports.state !== "ready" || !homework.length || homework.some((r) => !r.comparable)) missing.push("숙제 비교 자료");
  let attendance = { count: 0, absences: 0, late: 0 };
  let attendanceSource = raw.attendance;
  try { attendance = attendanceOf(raw.attendance.rows, today); }
  catch { attendanceSource = { state: "failed", rows: [] }; }
  section("attendance", "최근 4주 출결", "attendance", attendanceSource,
    attendance.count ? `결석 ${attendance.absences}회 · 지각 ${attendance.late}회` : "출결 기록 확인 필요",
    [`확인된 출결 ${attendance.count}회 · 정정 기록은 최신 행만 반영합니다.`, "예정 수업 전체가 확인되지 않아 출석률은 계산하지 않습니다. 결석 사유는 담당자가 확인합니다."]);
  if (attendance.absences >= 2) { groups.add("attendance"); reasons.push(`최근 4주 결석 기록 ${attendance.absences}회`); }
  if (attendanceSource.state !== "ready" || attendance.count < 4) missing.push("최근 출결 자료");
  const levels = levelsOf(raw.levels.rows, today);
  section("level", "학습 수준", "grades", raw.levels, levels.length ? "과목별 최근 평가" : "진단 레벨 기록 없음",
    levels.map((r) => `${subjectLabel(r.subject)} · ${testLabel(r.test_type)}: ${r.level} (${r.tested_on})`)
      .concat("서로 다른 검사 체계의 레벨을 한 등급으로 합치지 않습니다."));
  const grades = gradesOf(raw.grades.rows, today, raw.enrolledAt);
  section("growth", "입학 후 성적 기록", "grades", raw.grades, "첫 기록과 최근 기록",
    grades.length ? grades.map((r) => `${subjectLabel(r.subject)}: ${r.first.score}/${r.first.max_score} (${r.first.taken_on}, ${r.first.exam_name}) → ${r.last.score}/${r.last.max_score} (${r.last.taken_on}, ${r.last.exam_name})${r.delta == null ? " · 직접 비교 불가" : ` · 원점수 ${r.delta > 0 ? "+" : ""}${r.delta}점 (시험 난도 미보정)`}`)
      .concat("첫 기록이 입학 진단을 뜻하지는 않습니다. 과목·시험 이름·만점이 다른 기록은 점수 차이를 계산하지 않습니다.") : ["비교할 수 있는 성적 기록이 없습니다."]);
  const consults = raw.consultations.rows.filter((r) => { const day = dayOf(r.consulted_at); return day && day <= today; })
    .sort((a, b) => b.consulted_at.localeCompare(a.consulted_at));
  const parent = consults.find((r) => r.audience === "parent" || r.audience === "both");
  const followups = consults.filter((r) => !r.follow_up_done && dayOf(r.follow_up_date)).map((r) => ({
    id: r.id, date: r.follow_up_date!, action: r.follow_up_action?.trim() || "후속 상담 내용 확인",
    overdue: r.follow_up_date! < today,
  })).sort((a, b) => a.date.localeCompare(b.date));
  section("parent", "학부모 의견과 만족도", "consultations", raw.consultations, "직접 만족도 점수 미수집",
    parent ? [`최근 학부모 상담: ${dayOf(parent.consulted_at)}`, (parent.summary ?? "상담 요약 없음").slice(0, 400),
      "상담 문구로 만족도·퇴원 의사를 자동 확정하지 않습니다. 열람 가능한 상담만 표시합니다."] : ["열람 가능한 학부모 상담 기록이 없습니다. 무응답·기록 없음은 만족으로 판단하지 않습니다."]);
  const overdue = followups.filter((r) => r.overdue);
  if (overdue.length) { groups.add("followup"); reasons.push(`후속 상담 기한 경과 ${overdue.length}건`); }
  if (raw.consultations.state !== "ready" || !parent || dayOf(parent.consulted_at)! < addDays(today, -90)) missing.push("최근 학부모 상담 확인");
  const label = groups.size >= 2 ? "집중 관리" : groups.size ? "관찰" : missing.length ? "판단 보류" : "안정";
  return { studentId, today, canWriteConsultation: raw.canWriteConsultation, sections, followups, followupsState: raw.consultations.state,
    assessment: { label, reasons: reasons.length ? reasons : [missing.length ? "지원 필요도를 판단할 자료를 확인해 주세요." : "확인한 숙제·출결·상담 기록에서 뚜렷한 변화 신호가 없습니다."], missing } };
}
