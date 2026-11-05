import { Pill } from "@/components/atoms/pill";
import { tipProps } from "@/components/hover-tip/tip";
import { reportDateNote, type LinkEnrollment } from "@/features/withdrawals/report-date-link";
import type { StudentReportRecords } from "@/features/withdrawal-reports/server/student-records";

/**
 * 퇴원일 옆 '퇴원보고서 마지막 수업일'(2026-11-03 '종료일'에서 이름만 바꿈 — 퇴원보고서 화면과 같은 이름) — 같은 퇴원 사건으로 보이는 보고서의 날짜가 퇴원일과 다를 때만(원장 2026-10-23).
 * 정보로 보인다(어긋남·오류라고 말하지 않는다). 퇴원일은 바꾸지 않는다 — 어느 날짜가 맞는지는 사람이 본다.
 * 판정은 [`report-date-link.ts`](../../../../features/withdrawals/report-date-link.ts) 한 곳(어긋남 목록 스크립트와 같다).
 */
export function ReportDateBadge({
  withdrawnAt,
  enrollments,
  records,
  labels,
}: {
  /** 지금 퇴원 상태일 때의 퇴원일만(퇴원 예약이면 null). */
  withdrawnAt: string | null;
  enrollments: LinkEnrollment[];
  records: StudentReportRecords;
  /** 과목 키 → 라벨(`subjectLabelRecord`) — 모르는 키는 '기타 과목'(보고서 상세와 같다). */
  labels: Record<string, string>;
}) {
  if (records.status !== "ok") return null;
  const subjectText = (keys: string[]) => keys.map((k) => labels[k] ?? "기타 과목").join("·") || "과목 미기재";
  const live = records.reports.filter((r) => r.status !== "canceled");
  // '전체 퇴원' 요청은 담임별 보고서로 나뉘어 각자 제 과목만 든다 — 판정엔 같은 요청 묶음의 과목을 합쳐 넘긴다.
  const groupSubjects = new Map<string, string[]>();
  for (const r of live) groupSubjects.set(r.groupId, [...new Set([...(groupSubjects.get(r.groupId) ?? []), ...r.subjects])]);
  const note = reportDateNote(withdrawnAt, enrollments, [
    ...live.map((r) => ({
      reportDate: r.effectiveDate,
      reportSubjects: r.exitKind === "withdrawal" ? (groupSubjects.get(r.groupId) ?? r.subjects) : r.subjects,
      subjectEnd: r.exitKind === "subject_end",
      label: `새 보고서 · ${subjectText(r.subjects)}`,
    })),
    ...records.archives.map((a) => ({
      reportDate: a.exitDate,
      reportSubjects: a.subject ? [a.subject] : [],
      subjectEnd: false,
      label: `기존 기록 · ${subjectText(a.subject ? [a.subject] : [])} · 담임 ${a.teacherName || "—"}`,
    })),
  ]);
  if (!note) return null;
  return (
    <span
      {...tipProps({
        title: "퇴원보고서 날짜",
        rows: note.rows.map((r) => [r.label, r.date] as const),
        lines: ["보고서에 적힌 마지막 수업일입니다. 퇴원일은 그대로이며, 어느 날짜가 맞는지는 확인이 필요합니다."],
      })}
    >
      <Pill color="neutral">{`퇴원보고서 마지막 수업일 ${note.date}`}</Pill>
    </span>
  );
}
