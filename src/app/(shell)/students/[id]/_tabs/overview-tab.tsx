import { Sparkles } from "lucide-react";
import { formatCreatedAt } from "@/lib/utils";
import {
  getStudentAttendanceStats,
  type CareFocus,
  type StudentDetail,
} from "@/features/students/server/queries";

const PRIORITY_COLOR: Record<CareFocus["priority"], string> = {
  high: "text-chart-4 bg-chart-4/10 border-chart-4/20",
  medium: "text-chart-3 bg-chart-3/10 border-chart-3/20",
  low: "text-chart-1 bg-chart-1/10 border-chart-1/20",
};

const PRIORITY_LABEL: Record<CareFocus["priority"], string> = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};

export async function OverviewTab({ student }: { student: StudentDetail }) {
  const attendance = await getStudentAttendanceStats(student.id, 30);
  const hasCareAi = student.aiCareSummary !== null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="bg-card border-border space-y-4 rounded-md border p-5 lg:col-span-1">
          <h2 className="text-sm font-semibold tracking-tight">프로필</h2>
          <dl className="space-y-3 text-sm">
            {student.englishName ? <Field label="영문명" value={student.englishName} /> : null}
            {student.nickname ? <Field label="닉네임" value={student.nickname} /> : null}
            {student.attendanceCode ? (
              <Field label="출결번호" value={student.attendanceCode} mono />
            ) : null}
            {student.gender ? (
              <Field label="성별" value={student.gender === "male" ? "남" : "여"} />
            ) : null}
            {student.birthDate ? <Field label="생년월일" value={student.birthDate} mono /> : null}
            {student.graduationYear ? (
              <Field label="졸업연도" value={student.graduationYear} mono />
            ) : null}
            <Field label="담임" value={student.primaryTeacherName} />
            <Field label="부담임" value={student.secondaryTeacherName} />
            {student.studentPhone ? (
              <Field label="학생 연락처" value={student.studentPhone} mono />
            ) : null}
            {student.homePhone ? <Field label="집전화" value={student.homePhone} mono /> : null}
            {student.otherPhone ? (
              <Field label="기타 연락처" value={student.otherPhone} mono />
            ) : null}
            <Field
              label="학부모"
              value={
                student.parentName
                  ? student.parentRelation
                    ? `${student.parentName} (${student.parentRelation})`
                    : student.parentName
                  : null
              }
            />
            <Field label="연락처" value={student.parentPhone} mono />
            {student.email ? <Field label="이메일" value={student.email} mono /> : null}
            {student.address ? (
              <Field
                label="주소"
                value={
                  [student.zipCode ? `(${student.zipCode})` : null, student.address, student.addressDetail]
                    .filter(Boolean)
                    .join(" ")
                }
              />
            ) : null}
            <Field label="등록일" value={student.enrolledAt} mono />
            {student.withdrawnAt ? (
              <Field label="퇴원일" value={student.withdrawnAt} mono />
            ) : null}
          </dl>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <section className="bg-card border-border rounded-md border p-5">
            <header className="mb-4 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold tracking-tight">최근 30일 출결</h2>
              <p className="text-muted-foreground num text-xs">총 {attendance.total}건</p>
            </header>
            <div className="grid grid-cols-4 gap-4">
              <Stat
                label="출석률"
                value={attendance.total > 0 ? `${attendance.rate.toFixed(1)}%` : "—"}
                highlight="text-chart-2"
              />
              <Stat label="출석" value={String(attendance.present)} unit="건" />
              <Stat
                label="결석"
                value={String(attendance.absent)}
                unit="건"
                highlight="text-chart-4"
              />
              <Stat
                label="지각"
                value={String(attendance.late)}
                unit="건"
                highlight="text-chart-3"
              />
            </div>
          </section>
        </div>
      </div>

      {hasCareAi ? (
        <section className="bg-card border-border space-y-4 rounded-md border p-5">
          <header className="flex items-baseline justify-between">
            <div className="inline-flex items-center gap-2">
              <Sparkles className="text-chart-4 size-4" />
              <h2 className="text-foreground text-sm font-semibold">AI 케어 인사이트</h2>
            </div>
            {student.aiCareGeneratedAt ? (
              <span className="text-muted-foreground num text-[11px]">
                {formatCreatedAt(student.aiCareGeneratedAt)}
              </span>
            ) : null}
          </header>

          <div className="space-y-2">
            <p className="eyebrow">종합 요약</p>
            <p className="text-foreground text-sm leading-relaxed">{student.aiCareSummary}</p>
          </div>

          {student.aiCareFocus && student.aiCareFocus.length > 0 ? (
            <div className="space-y-2">
              <p className="eyebrow">주의 영역</p>
              <ul className="space-y-2">
                {student.aiCareFocus.map((f, i) => (
                  <li
                    key={i}
                    className="border-border bg-muted/30 flex items-start gap-3 rounded-md border px-3 py-2.5"
                  >
                    <span
                      className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_COLOR[f.priority]}`}
                    >
                      {PRIORITY_LABEL[f.priority]}
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-foreground text-sm font-medium">{f.area}</p>
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        {f.recommendation}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground shrink-0 text-xs">{label}</dt>
      <dd className={`text-foreground text-sm ${mono ? "num" : ""}`}>{value ?? "—"}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: string;
  unit?: string;
  highlight?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="eyebrow">{label}</p>
      <p className={`num text-foreground text-xl font-semibold ${highlight ?? ""}`}>
        {value}
        {unit ? (
          <span className="text-muted-foreground ml-0.5 text-xs font-normal">{unit}</span>
        ) : null}
      </p>
    </div>
  );
}
