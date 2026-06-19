import Link from "next/link";
import { UserCheck, UserMinus, UserPlus, Users, type LucideIcon } from "lucide-react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getStudentsPage,
  getStudentStatusCounts,
  getTeacherOptions,
  type StudentSort,
  type SearchField,
} from "@/features/students/server/queries";
import { NewStudentTrigger } from "./_components/new-student-trigger";
import { StudentQuickPanel } from "./_components/student-quick-panel";
import { StudentAdvancedFilters } from "./_components/advanced-filters";

export const metadata = { title: "학생목록 — eywa" };

const STATUS_META: Record<string, { label: string; color: PillColor }> = {
  prospect: { label: "예비", color: "amber" },
  consulted: { label: "상담완료", color: "blue" },
  enrolled: { label: "재원", color: "primary" },
  on_hold: { label: "휴원", color: "amber" },
  withdrawn: { label: "퇴원", color: "neutral" },
};

// ⚠️ Pill은 .micro CSS(text-transform: uppercase)를 써서, 매핑에 없는 코드를 그대로 흘리면
// "highmath" → "HIGHMATH"처럼 원시 영문 코드가 노출된다(F3). 모든 코드를 한글 라벨로 매핑하고,
// 미지의 코드는 fallback("기타")으로 받아 영문 코드가 절대 보이지 않게 한다.
const SUBJECT_META: Record<string, { label: string; color: PillColor }> = {
  math: { label: "수학", color: "primary" },
  highmath: { label: "수학(심화)", color: "primary" },
  english: { label: "영어", color: "blue" },
  korean: { label: "국어", color: "rose" },
  science: { label: "과학", color: "purple" },
  arts: { label: "예술", color: "amber" },
  other: { label: "기타", color: "neutral" },
};
const SUBJECT_FALLBACK = { label: "기타", color: "neutral" as PillColor };

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "enrolled", label: "재원" },
  { key: "consulted", label: "예비·상담" },
  { key: "on_hold", label: "휴원" },
  { key: "withdrawn", label: "퇴원" },
];

const SUBJECT_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "math", label: "수학" },
  { key: "highmath", label: "수학(심화)" },
  { key: "english", label: "영어" },
  { key: "korean", label: "국어" },
  { key: "science", label: "과학" },
  { key: "arts", label: "예술" },
];

function buildHref(
  current: { status?: string; subject?: string; q?: string },
  patch: Partial<{ status: string; subject: string; q: string }>,
): string {
  const params = new URLSearchParams();
  const status = patch.status ?? current.status;
  const subject = patch.subject ?? current.subject;
  const q = patch.q !== undefined ? patch.q : current.q;
  if (status && status !== "all") params.set("status", status);
  if (subject && subject !== "all") params.set("subject", subject);
  if (q) params.set("q", q);
  const s = params.toString();
  return s ? `/students?${s}` : "/students";
}

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    subject?: string;
    q?: string;
    page?: string;
    grade?: string;
    teacher?: string;
    field?: string;
    sort?: string;
    noenr?: string;
  }>;
}) {
  await requireAccess("students");
  const sp = await searchParams;
  const status = sp.status ?? "all";
  const subject = sp.subject ?? "all";
  const q = sp.q ?? "";
  // 고급 필터
  const grade = sp.grade ?? "all";
  const teacherId = sp.teacher ?? "all";
  const field = (sp.field ?? "all") as SearchField;
  const sort = (sp.sort === "name" || sp.sort === "recent" ? sp.sort : "grade") as StudentSort;
  const excludeNoEnrollment = sp.noenr === "1";
  const PAGE_SIZE = 50;
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ rows, total }, counts, teachers] = await Promise.all([
    getStudentsPage(
      { status, subject, q, grade, teacherId, searchField: field, sort, excludeNoEnrollment },
      page,
      PAGE_SIZE,
    ),
    getStudentStatusCounts(),
    getTeacherOptions(),
  ]);
  const { all, enrolled, prospect, withdrawn } = counts;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const teacherOptions = teachers.map((t) => ({ value: t.id, label: t.displayName }));
  // 검색폼·페이지·export가 보존해야 할 고급 파라미터(기본값이 아닌 것만)
  const advParams: Record<string, string> = {
    ...(grade !== "all" ? { grade } : {}),
    ...(teacherId !== "all" ? { teacher: teacherId } : {}),
    ...(field !== "all" ? { field } : {}),
    ...(sort !== "grade" ? { sort } : {}),
    ...(excludeNoEnrollment ? { noenr: "1" } : {}),
  };

  const current = { status, subject, q };
  // 페이지 이동 링크 — 현재 필터(고급 포함) 유지 + page 지정 (필터 chip은 buildHref라 page 자동 리셋)
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (subject !== "all") params.set("subject", subject);
    if (q) params.set("q", q);
    for (const [k, v] of Object.entries(advParams)) params.set(k, v);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/students?${s}` : "/students";
  };

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="전체" value={all} unit="명" color="primary" icon={Users} />
        <Stat label="재원" value={enrolled} unit="명" color="primary" icon={UserCheck} />
        <Stat label="예비·상담" value={prospect} unit="명" color="gold" icon={UserPlus} />
        <Stat label="퇴원" value={withdrawn} unit="명" color="neutral" icon={UserMinus} />
      </section>

      {/* Filter bar — 넓은 창: 한 줄(상태·과목·검색), 좁은 창: 그룹 단위로 자연 접힘(flex-wrap) */}
      <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-x-5 gap-y-2.5 rounded-md border px-4 py-3">
        {/* 상태 chip */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="micro mr-1">상태</span>
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={buildHref(current, { status: f.key })}
              className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                status === f.key
                  ? "border-foreground bg-foreground text-background font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {/* 과목 chip */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="micro mr-1">과목</span>
          {SUBJECT_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={buildHref(current, { subject: f.key })}
              className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                subject === f.key
                  ? "border-primary bg-primary text-primary-foreground font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {/* 검색 — ml-auto로 넓을 땐 오른쪽 끝, 좁을 땐 자기 줄로 접힘 */}
        <form action="/students" method="get" className="ml-auto flex items-center gap-2">
          {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
          {subject !== "all" ? <input type="hidden" name="subject" value={subject} /> : null}
          {/* 고급 필터(학년·담임·검색필드·정렬·미수강)도 검색 제출 시 보존 */}
          {Object.entries(advParams).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <div className="border-line bg-bg-soft text-text-dim flex items-center gap-2 rounded-sm border px-2.5 py-1.5">
            <EyIcon name="search" size={13} />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder={field === "all" ? "이름·학교·연락처" : "검색어"}
              className="text-foreground placeholder:text-text-faint w-40 bg-transparent text-xs focus:outline-none"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">
            검색
          </Button>
        </form>
      </div>

      {/* 고급 필터 — 접이식(기본 닫힘, 활성값 있으면 열림) */}
      <StudentAdvancedFilters
        grade={grade}
        teacherId={teacherId}
        field={field}
        sort={sort}
        excludeNoEnrollment={excludeNoEnrollment}
        teachers={teacherOptions}
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="micro">
          결과 <span className="text-foreground font-bold">{total}</span>명
          {totalPages > 1 ? <span className="text-text-dim ml-2">{page}/{totalPages} 페이지</span> : null}
          {q ? <span className="text-text-dim ml-2">&ldquo;{q}&rdquo; 검색</span> : null}
        </p>
        <div className="flex items-center gap-2">
          <a
            href={`/api/exports/students?${new URLSearchParams({
              ...(status !== "all" ? { status } : {}),
              ...(subject !== "all" ? { subject } : {}),
              ...(q ? { q } : {}),
              ...advParams,
            }).toString()}`}
            className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition"
          >
            <EyIcon name="arrowDown" size={13} />
            엑셀 내보내기
          </a>
          <NewStudentTrigger />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={() => <Users size={32} strokeWidth={1.5} />}
          title="결과 없음"
          description="검색어/필터를 조정해보세요."
        />
      ) : (
        <>
        <div className="bg-card border-line shadow-card overflow-x-auto rounded-md border">
          <table className="w-full text-sm [&_td]:whitespace-nowrap">
            <thead className="border-line border-b [&_th]:whitespace-nowrap">
              <tr>
                <th className="micro px-5 py-3 text-left">학생</th>
                <th className="micro px-5 py-3 text-left">학년</th>
                <th className="micro px-5 py-3 text-left">학교</th>
                <th className="micro px-5 py-3 text-left">상태</th>
                <th className="micro px-5 py-3 text-left">수강 과목</th>
                <th className="micro px-5 py-3 text-left">담임</th>
                <th className="micro px-5 py-3 text-right">학부모 연락처</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {rows.map((s) => {
                const meta = STATUS_META[s.status] ?? { label: s.status, color: "neutral" as PillColor };
                return (
                  <tr key={s.id} className="hover:bg-bg-soft/50 transition-colors">
                    <td className="px-5 py-3">
                      <StudentQuickPanel
                        student={{
                          id: s.id,
                          name: s.name,
                          grade: s.grade,
                          school: s.school,
                          status: s.status,
                          subjects: s.subjects,
                          primaryTeacherName: s.primaryTeacherName,
                          parentPhone: s.parentPhone,
                          enrolledAt: s.enrolledAt,
                        }}
                      >
                        <span className="text-foreground text-[13px] font-bold hover:underline">
                          {s.name}
                        </span>
                      </StudentQuickPanel>
                    </td>
                    <td className="text-text-dim px-5 py-3 text-xs">{s.grade ?? "—"}</td>
                    <td className="text-text-dim px-5 py-3 text-xs">{s.school ?? "—"}</td>
                    <td className="px-5 py-3">
                      <Pill color={meta.color}>{meta.label}</Pill>
                    </td>
                    <td className="px-5 py-3">
                      {s.subjects.length === 0 ? (
                        <span className="text-text-faint text-xs">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {s.subjects.map((sub) => {
                            const sm = SUBJECT_META[sub] ?? SUBJECT_FALLBACK;
                            return (
                              <Pill key={sub} color={sm.color}>
                                {sm.label}
                              </Pill>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className="text-text-dim px-5 py-3 text-xs">
                      {s.primaryTeacherName ?? "—"}
                    </td>
                    <td className="text-text-dim num px-5 py-3 text-right text-xs">
                      {s.parentPhone ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  color,
  icon: Icon,
}: {
  label: string;
  value: number;
  unit: string;
  color: "primary" | "gold" | "blue" | "neutral";
  icon: LucideIcon;
}) {
  const ICON_BG: Record<typeof color, string> = {
    primary: "bg-primary-soft text-primary",
    gold: "bg-gold-soft text-gold",
    blue: "bg-blue-soft text-blue",
    neutral: "bg-bg-soft text-text-dim",
  };
  return (
    <div className="bg-card border-line shadow-card rounded-md border p-4">
      <header className="flex items-center justify-between">
        <p className="micro">{label}</p>
        <span className={`flex size-[26px] items-center justify-center rounded-sm ${ICON_BG[color]}`}>
          <Icon size={13} strokeWidth={2} />
        </span>
      </header>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="tabular text-foreground text-[28px] leading-none">{value}</span>
        <span className="text-text-dim text-xs">{unit}</span>
      </p>
    </div>
  );
}
