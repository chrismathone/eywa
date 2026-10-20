
import { SheetText } from "@/features/teacher-view/interface-label";
import { Sparkles } from "@/components/icons/aywa-icon-compat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { formatCreatedAt } from "@/lib/utils";
import { kstToday } from "@/lib/date-kst";
import { isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";
import {
  getStudentAttendanceStats,
  getStudentEnrollments,
  getStudentInvoices,
  getStudentConsultationHistory,
  getStudentMemos,
  type CareFocus,
  type StudentDetail,
} from "@/features/students/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getStudentUnifiedRows } from "@/features/grades/unified/server/student-records";
import { KIND_LABEL, scoreUnit } from "@/features/grades/unified/model";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { invoiceOutstanding } from "@/features/billing/calc";
import { TabLink } from "../_components/tab-link";
import { memoCategoryLabel } from "@/features/students/detail/memo-category";
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { getTeacherEnglishNames } from "@/features/teacher-view/server/teacher-names";
import { teacherNameFor } from "@/features/teacher-view/teacher-name";
import { classNameFor } from "@/features/teacher-view/class-name";
import { getStudentSiblings } from "@/features/students/server/siblings";
import { ProfileSiblings } from "../_components/profile-siblings";

const won = (n: number) => n.toLocaleString();

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

export async function OverviewTab({ student, canSeeBilling }: { student: StudentDetail; canSeeBilling: boolean }) {
  const sid = student.id;
  const [attendance, enrollments, grades, invoices, consultations, memos, settings, lang, teacherNames, siblings] = await Promise.all([
    getStudentAttendanceStats(sid, 30),
    getStudentEnrollments(sid),
    // 성적 탭·통합 성적관리와 같은 기록(수업보고서 일일·확인테스트 포함 — 원장 2026-09-24).
    getStudentUnifiedRows(sid),
    canSeeBilling ? getStudentInvoices(sid) : Promise.resolve([]),
    getStudentConsultationHistory(sid),
    getStudentMemos(sid),
    getTenantSettings(),
    getTeacherViewLang(),
    getTeacherEnglishNames(),
    getStudentSiblings(student),
  ]);
  const subjects = buildSubjectMaps(settings.operations.subjects, lang);
  const hasCareAi = student.aiCareSummary !== null;

  // 🔴 `!endDate`로 자르면 안 된다(2026-08-29) — 반이동을 예약하면 옛 수강에 **미래 종료일**이
  //    붙는데, 그 학생은 그날까지 그 반에 다닌다. 잘라 버리면 지금 다니는 반이 개요에서 증발하고,
  //    아직 시작도 안 한 새 반만 보였다(실측 김준서A: MS2B가 사라지고 MS2A만 뜸).
  //    판정은 enrollmentPhaseOn 단일 소스 — 오늘 명단(active∪leaving)만 '수강 중'이다.
  const today = kstToday();
  const activeClasses = enrollments.filter((e) =>
    isEnrollmentOnRosterOn({ startDate: e.startDate, endDate: e.endDate, isTransferred: e.isTransferred }, today),
  );
  // 미납 = unpaid/partial만(refunded/void 제외) + 행 레벨 clamp — calc.ts 단일 공식(수납관리 KPI와 일치).
  const unpaid = invoices.filter((i) => i.status === "unpaid" || i.status === "partial");
  const unpaidTotal = unpaid.reduce((s, i) => s + invoiceOutstanding(i), 0);
  const pinnedMemos = [...memos].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const base = `/students/${sid}`;

  return (
    <div className="space-y-4">
      {/* 최근 30일 출결 — 전체 폭 KPI */}
      <section className="bg-card border-border rounded-2xl border p-5">
        <header className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-bold tracking-tight"><SheetText value={"최근 30일 출결"} /></h2>
          <p className="text-muted-foreground num text-xs"><SheetText value={"총 "} />{attendance.total}<SheetText value={"건"} /></p>
        </header>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="출석률"
            value={attendance.total > 0 ? `${attendance.rate.toFixed(1)}%` : "—"}
            highlight="text-chart-2"
          />
          <Stat label="출석" value={String(attendance.present)} unit="건" />
          <Stat label="결석" value={String(attendance.absent)} unit="건" highlight="text-chart-4" />
          <Stat label="지각" value={String(attendance.late)} unit="건" highlight="text-chart-3" />
        </div>
      </section>

      {/* 프로필 + 다이제스트 — CSS columns 마조너리(창 폭 따라 1/2/3열 자동 패킹, 빈칸 최소화) */}
      <div className="gap-4 sm:columns-2 xl:columns-3 [&>section]:mb-4 [&>section]:break-inside-avoid">
        <section className="bg-card border-border space-y-3 rounded-2xl border p-5">
          <h2 className="text-sm font-bold tracking-tight"><SheetText value={"프로필"} /></h2>
          <dl className="space-y-3 text-sm">
            {student.englishName ? <Field label="영문명" value={student.englishName} /> : null}
            {student.nickname ? <Field label="닉네임" value={student.nickname} /> : null}
            {student.attendanceCode ? (
              <Field label="출결번호" value={student.attendanceCode} mono />
            ) : null}
            {student.gender ? (
              <Field label="성별" value={lang === "en" ? student.gender === "male" ? "Male" : "Female" : student.gender === "male" ? "남" : "여"} />
            ) : null}
            {student.birthDate ? <Field label="생년월일" value={student.birthDate} mono /> : null}
            {student.graduationYear ? (
              <Field label="졸업연도" value={student.graduationYear} mono />
            ) : null}
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
            <ProfileSiblings siblings={siblings.siblings} lang={lang} />
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
        </section>

        <DigestCard title="수강 중인 반" more={<TabLink href={`${base}?tab=classes`}><SheetText value={"수업"} /></TabLink>}>
          {activeClasses.length === 0 ? (
            <Empty><SheetText value={"수강 중인 반 없음"} /></Empty>
          ) : (
            activeClasses.slice(0, 4).map((e) => (
              <DigestRow
                key={e.id}
                left={classNameFor(e.className, lang)}
                right={[subjects.labelOf(e.subject), teacherNameFor(e.teacherName, teacherNames, lang)].filter(Boolean).join(" · ")}
              />
            ))
          )}
        </DigestCard>

        <DigestCard title="최근 성적" more={<TabLink href={`${base}?tab=grades`}><SheetText value={"성적"} /></TabLink>}>
          {grades.length === 0 ? (
            <Empty><SheetText value={"성적 기록 없음"} /></Empty>
          ) : (
            grades.slice(0, 4).map((g) => (
              <DigestRow
                key={g.key}
                left={`${subjects.labelOf(g.subject)} ${KIND_LABEL[g.kind]}`}
                right={g.score == null || g.maxScore == null ? g.rawScore || "—" : `${g.score} / ${g.maxScore}${scoreUnit(g)}`}
                mono
              />
            ))
          )}
        </DigestCard>

        {canSeeBilling ? <DigestCard title="수납 현황" more={<TabLink href={`${base}?tab=billing`}><SheetText value={"수납"} /></TabLink>}>
          {invoices.length === 0 ? (
            <Empty><SheetText value={"청구 내역 없음"} /></Empty>
          ) : (
            <>
              <DigestRow left="총 청구" right={`${invoices.length}건`} />
              <DigestRow
                left="미납"
                right={unpaid.length === 0 ? "없음" : `${unpaid.length}건 · ${won(unpaidTotal)}원`}
                highlight={unpaid.length > 0 ? "text-amber" : "text-chart-2"}
              />
              {invoices[0] ? <DigestRow left="최근" right={invoices[0].period} mono /> : null}
            </>
          )}
        </DigestCard> : null}

        <DigestCard title="최근 상담" more={<TabLink href={`${base}?tab=consultations`}><SheetText value={"상담"} /></TabLink>}>
          {consultations.length === 0 ? (
            <Empty><SheetText value={"상담 기록 없음"} /></Empty>
          ) : (
            consultations.slice(0, 3).map((c) => (
              <DigestRow key={c.id} left={String(c.consultedAt).slice(0, 10)} right={c.summary} truncate mono />
            ))
          )}
        </DigestCard>

        <DigestCard title="최근 메모" more={<TabLink href={`${base}?tab=memos`}><SheetText value={"메모"} /></TabLink>}>
          {pinnedMemos.length === 0 ? (
            <Empty><SheetText value={"메모 없음"} /></Empty>
          ) : (
            pinnedMemos.slice(0, 3).map((m) => (
              <DigestRow
                key={m.id}
                // 🔴 저장값(`general`)을 그대로 적지 않는다 — 분류 라벨은 단일 소스에서
                //    (원장 제보 2026-09-08 *"실제 출력이 영문으로 출력됨"*).
                left={m.pinned ? <EyIcon name="pin" size={13} aria-label="고정 메모" /> : memoCategoryLabel(m.category)}
                right={m.content}
                truncate
              />
            ))
          )}
        </DigestCard>
      </div>

      {hasCareAi ? (
        <section className="bg-card border-border space-y-4 rounded-2xl border p-5">
          <header className="flex items-baseline justify-between">
            <div className="inline-flex items-center gap-2">
              <Sparkles className="text-chart-4 size-4" />
              <h2 className="text-foreground text-sm font-bold"><SheetText value={"AI 케어 인사이트"} /></h2>
            </div>
            {student.aiCareGeneratedAt ? (
              <span className="text-muted-foreground num text-xs">
                {formatCreatedAt(student.aiCareGeneratedAt)}
              </span>
            ) : null}
          </header>

          <div className="space-y-2">
            <p className="eyebrow"><SheetText value={"종합 요약"} /></p>
            <p className="text-foreground text-sm leading-relaxed">{student.aiCareSummary}</p>
          </div>

          {student.aiCareFocus && student.aiCareFocus.length > 0 ? (
            <div className="space-y-2">
              <p className="eyebrow"><SheetText value={"주의 영역"} /></p>
              <ul className="space-y-2">
                {student.aiCareFocus.map((f, i) => (
                  <li
                    key={i}
                    className="border-border bg-muted/30 flex items-start gap-3 rounded-md border px-3 py-2.5"
                  >
                    <span
                      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-xs font-medium ${PRIORITY_COLOR[f.priority]}`}
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
      <dt className="text-muted-foreground shrink-0 text-xs"><SheetText value={label} /></dt>
      <dd className={`text-foreground text-sm ${mono ? "num" : ""}`}>{value ?? "—"}</dd>
    </div>
  );
}

function DigestCard({
  title,
  more,
  children,
}: {
  title: string;
  more?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card border-border flex flex-col rounded-2xl border p-4">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-foreground text-sm font-bold"><SheetText value={title} /></h3>
        {more}
      </header>
      <div className="divide-border/60 flex-1 divide-y">{children}</div>
    </section>
  );
}

function DigestRow({
  left,
  right,
  mono,
  truncate,
  highlight,
}: {
  left: React.ReactNode;
  right: string;
  mono?: boolean;
  truncate?: boolean;
  highlight?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
      <span className="text-text-dim shrink-0">{left}</span>
      <span
        className={`text-foreground ${truncate ? "min-w-0 truncate text-right" : "shrink-0"} ${mono ? "num" : ""} ${highlight ?? ""}`}
      >
        {right}
      </span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-text-faint py-3 text-center text-xs">{children}</p>;
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
      <p className="eyebrow"><SheetText value={label} /></p>
      <p className={`num text-foreground text-xl font-bold ${highlight ?? ""}`}>
        {value}
        {unit ? (
          <span className="text-muted-foreground ml-0.5 text-xs font-normal"><SheetText value={unit} /></span>
        ) : null}
      </p>
    </div>
  );
}
