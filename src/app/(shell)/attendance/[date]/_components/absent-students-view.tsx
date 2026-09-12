import Link from "next/link";
import { formatKoreanDateLong } from "@/lib/date-kst";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { ClipboardCheck } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import {
  ABSENT_STATUS_LABEL,
  type AbsentDay,
  type AbsentStudent,
} from "@/features/dashboard/absent-students";

/**
 * 출석부 `?status=absent` — 그날 **결석 학생**(한 교시도 안 온 학생) + 따로 보이는 **일부 교시 결석**.
 * 운영실 KPI '전일 결석' ↗의 목적지.
 * 🔑 명단은 카드·팝업과 **같은 함수**(`getScopedAbsentStudents`)에서 온다 — 여기서 출결 행을 다시 세지 않는다.
 * 사전 통보는 숫자에서 빼지 않고 표식으로 가른다(연락 필요를 앞에). 일부 교시 결석은 세지도, '연락 필요'로 부르지도 않는다.
 */
function Row({ student, subjectLabel, partial }: { student: AbsentStudent; subjectLabel: Record<string, string>; partial: boolean }) {
  const classText =
    student.classes.map((c) => c.name).filter(Boolean).join(" · ") ||
    (student.subject ? (subjectLabel[student.subject] ?? "기타 과목") : "");
  return (
    <li className="flex flex-wrap items-center gap-2 py-2.5">
      <WindowLink
        href={`/students/${student.studentId}?tab=attendance`}
        title={student.name}
        ariaLabel={`${student.name} 출결 상세`}
        className="text-foreground shrink-0 text-base font-bold whitespace-nowrap hover:underline"
      >
        {student.name}
      </WindowLink>
      <span className="text-text-dim min-w-0 flex-1 text-sm">{classText}</span>
      {student.statuses.includes("excused") ? <Pill color="neutral">{ABSENT_STATUS_LABEL.excused}</Pill> : null}
      {partial ? (
        <Pill color="neutral">일부 교시 결석</Pill>
      ) : student.preNotified ? (
        <Pill color="neutral">사전 통보</Pill>
      ) : (
        <Pill color="amber">연락 필요</Pill>
      )}
    </li>
  );
}

export function AbsentStudentsView({
  date,
  day,
  subjectLabel,
}: {
  date: string;
  day: AbsentDay;
  subjectLabel: Record<string, string>;
}) {
  const students = day.absent;
  const notified = students.filter((s) => s.preNotified).length;
  const sorted = [...students].sort(
    (a, b) => Number(a.preNotified) - Number(b.preNotified) || a.name.localeCompare(b.name, "ko"),
  );
  const partial = [...day.partial].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return (
    <div className="space-y-6">
      <PageHeader title="출석부" description={`${formatKoreanDateLong(date)} · 결석 학생`} />
      <section className="bg-card shadow-card space-y-4 rounded-2xl p-5">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-foreground text-base font-bold">
            결석 학생 <span className="num">{students.length}</span>명
          </h2>
          <p className="text-sm">
            연락 필요 <span className="num font-bold">{students.length - notified}</span>명 · 사전 통보{" "}
            <span className="num font-bold">{notified}</span>명
          </p>
        </header>
        {students.length === 0 ? (
          <EmptyState image="attendance" icon={ClipboardCheck} title="이 날짜에 한 교시도 안 온 학생은 없습니다" />
        ) : (
          <ul className="divide-line border-line divide-y border-y">
            {sorted.map((s) => (
              <Row key={s.studentId} student={s} subjectLabel={subjectLabel} partial={false} />
            ))}
          </ul>
        )}
        {partial.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-foreground text-sm font-bold">
              일부 교시 결석 <span className="num">{partial.length}</span>명
              <span className="text-text-dim ml-1.5 font-normal">· 다른 교시엔 와서 결석 학생 수에는 넣지 않습니다</span>
            </h3>
            <ul className="divide-line border-line divide-y border-y">
              {partial.map((s) => (
                <Row key={s.studentId} student={s} subjectLabel={subjectLabel} partial />
              ))}
            </ul>
          </div>
        ) : null}
        <Link
          href={`/attendance/${date}`}
          className="text-text-dim hover:text-foreground inline-flex items-center text-sm underline-offset-2 hover:underline"
        >
          전체 출결 보기
        </Link>
      </section>
    </div>
  );
}
