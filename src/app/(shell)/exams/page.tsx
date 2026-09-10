import { SearchX } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/eywa-icons";
import {
  TOOLBAR_SEARCH_BOX,
  TOOLBAR_SEG_BOX,
  TOOLBAR_SEG_BOX_WRAP,
  TOOLBAR_SEG_ITEM,
  TOOLBAR_SEG_OFF,
  TOOLBAR_SEG_ON_PRIMARY,
} from "@/components/toolbar-controls";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import { Pagination } from "@/components/pagination";
import { getExamsPage, type ExamRow } from "@/features/exams/server/queries";
import { getClassesList } from "@/features/classes/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps, type SubjectMaps } from "@/features/owner/subjects";
import { CreateExamTrigger, type ExamClassOption } from "./_components/exam-form-dialog";

export const metadata = { title: "성적관리 — eywa" };

const PAGE_SIZE = 50;

const TYPE_LABEL: Record<string, string> = { weekly: "주간", mock: "모의", school: "학교" };
const TYPE_FILTERS = [
  { value: "all", label: "전체" },
  { value: "weekly", label: "주간" },
  { value: "mock", label: "모의" },
  { value: "school", label: "학교" },
];

export default async function ExamsPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string; page?: string; q?: string; type?: string; from?: string; to?: string }>;
}) {
  await requireAccess("exams");
  const sp = await searchParams;
  const subject = sp.subject ?? "all";
  const examType = sp.type ?? "all";
  const q = sp.q?.trim() || "";
  const from = sp.from || "";
  const to = sp.to || "";
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ rows, total }, settings, classList] = await Promise.all([
    getExamsPage(
      {
        subject: subject === "all" ? undefined : subject,
        examType: examType === "all" ? undefined : examType,
        q: q || undefined,
        from: from || undefined,
        to: to || undefined,
      },
      page,
      PAGE_SIZE,
    ),
    getTenantSettings(),
    getClassesList({ active: "active" }),
  ]);
  // 과목 라벨·색·필터 칩은 학원설정(operations.subjects) 단일 소스 — 미등록 과목은 칩에 안 뜸.
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const classOptions: ExamClassOption[] = classList.map((c) => ({
    id: c.id,
    className: c.className,
    subject: c.subject,
  }));

  // 필터/검색 href — 칩·검색은 page 리셋(page 미세팅).
  const buildHref = (patch: Partial<{ subject: string; type: string; q: string; from: string; to: string }>) => {
    const cur = { subject, type: examType, q, from, to, ...patch };
    const params = new URLSearchParams();
    if (cur.subject !== "all") params.set("subject", cur.subject);
    if (cur.type !== "all") params.set("type", cur.type);
    if (cur.q) params.set("q", cur.q);
    if (cur.from) params.set("from", cur.from);
    if (cur.to) params.set("to", cur.to);
    const s = params.toString();
    return s ? `/exams?${s}` : "/exams";
  };
  const pageHref = (p: number) => {
    const base = buildHref({});
    if (p <= 1) return base;
    return base === "/exams" ? `/exams?page=${p}` : `${base}&page=${p}`;
  };

  return (
    <div className="space-y-5">
      {/* Editorial 문법 ① — eyebrow→헤드라인→서브('결과 N개' micro가 유일 타이틀이던 상태 해소) */}
      <PageHeader
        eyebrow="학생 관리"
        title="성적관리"
        description="시험을 만들고 반별 점수를 일괄 입력합니다"
      />

      {/* Filter bar */}
      {/* 🔴 툴바 카드 껍데기 제거(원장 2026-09-01) — 아래 표가 자기 테두리를 가져 선이 겹쳤다. */}
      <div className="flex flex-col gap-2 px-1 py-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-1.5">
            <span className="micro shrink-0">과목</span>
            <div className={TOOLBAR_SEG_BOX_WRAP}>
            {subjects.filters.map((f) => (
              <a
                key={f.value}
                href={buildHref({ subject: f.value })}
                className={`${TOOLBAR_SEG_ITEM} shrink-0 ${subject === f.value ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
              >
                {f.label}
              </a>
            ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="micro shrink-0">유형</span>
            <div className={TOOLBAR_SEG_BOX}>
            {TYPE_FILTERS.map((f) => (
              <a
                key={f.value}
                href={buildHref({ type: f.value })}
                className={`${TOOLBAR_SEG_ITEM} shrink-0 ${examType === f.value ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
              >
                {f.label}
              </a>
            ))}
            </div>
          </div>
        </div>
        <form action="/exams" method="get" className="flex flex-wrap items-center gap-2">
          {subject !== "all" ? <input type="hidden" name="subject" value={subject} /> : null}
          {examType !== "all" ? <input type="hidden" name="type" value={examType} /> : null}
          <div className={TOOLBAR_SEARCH_BOX}>
            <EyIcon name="search" size={13} />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="시험명"
              className="text-foreground placeholder:text-text-faint h-full w-32 bg-transparent text-(length:--control-label-sm) leading-normal focus:outline-none"
            />
          </div>
          <label className="text-text-dim flex items-center gap-1 text-xs">
            기간
            <input type="date" name="from" defaultValue={from} className="border-line bg-bg-soft h-8 rounded-lg border px-1.5 text-xs" />
            <span>~</span>
            <input type="date" name="to" defaultValue={to} className="border-line bg-bg-soft h-8 rounded-lg border px-1.5 text-xs" />
          </label>
          <Button type="submit" variant="outline">검색</Button>
          {q || from || to ? (
            <a href={buildHref({ q: "", from: "", to: "" })} className="text-text-faint hover:text-foreground text-xs underline">
              초기화
            </a>
          ) : null}
        </form>
      </div>

      <div className="flex items-center justify-between">
        <p className="micro">
          결과 <span className="text-foreground font-bold">{total}</span>개
          {totalPages > 1 ? (
            <span className="text-text-faint ml-2 normal-case">
              · {page}/{totalPages} 페이지
            </span>
          ) : null}
        </p>
        <CreateExamTrigger classOptions={classOptions} />
      </div>

      {total === 0 ? (
        <EmptyState
          compact
          image="exams"
          icon={() => <SearchX size={32} strokeWidth={1.8} />}
          title={q || from || to || subject !== "all" || examType !== "all" ? "조건에 맞는 시험이 없습니다" : "등록된 시험이 없습니다"}
          description="위에서 검색 조건을 바꾸거나 시험을 등록할 수 있습니다."
        />
      ) : (
        <>
          <ExamTable rows={rows} subjects={subjects} />
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}

function ExamTable({ rows, subjects }: { rows: ExamRow[]; subjects: SubjectMaps }) {
  return (
    <div className="bg-card shadow-card overflow-auto rounded-2xl">
      <table className="w-full text-sm [&_td]:whitespace-nowrap">
        <thead className="border-line border-b [&_th]:whitespace-nowrap">
          <tr>
            <th className="micro px-4 py-3 text-left">시험일</th>
            <th className="micro px-4 py-3 text-left">과목</th>
            <th className="micro px-4 py-3 text-left">유형</th>
            <th className="micro px-4 py-3 text-left">시험명</th>
            <th className="micro px-4 py-3 text-right">응시</th>
            <th className="micro px-4 py-3 text-right">평균</th>
            <th className="micro px-4 py-3 text-right">최고</th>
            <th className="micro px-4 py-3 text-right">최저</th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {rows.map((e) => {
            const meta = { label: subjects.labelOf(e.subject), color: subjects.colorOf(e.subject) };
            const s = e.stats;
            return (
              <tr key={e.id} className="hover:bg-bg-soft/50">
                <td className="text-text-dim num px-4 py-2.5 text-xs">{e.examDate}</td>
                <td className="px-4 py-2.5">
                  <Pill color={meta.color}>{meta.label}</Pill>
                </td>
                <td className="text-text-dim px-4 py-2.5 text-xs">
                  {TYPE_LABEL[e.examType] ?? e.examType}
                </td>
                <td className="px-4 py-2.5">
                  <WindowLink
                    href={`/exams/${e.id}`}
                    title={e.name}
                    className="text-foreground text-sm font-bold hover:underline"
                  >
                    {e.name}
                  </WindowLink>
                </td>
                <td className="text-foreground num px-4 py-2.5 text-right text-xs font-bold">
                  {s.count}명
                </td>
                <td className="text-text-dim num px-4 py-2.5 text-right text-xs">
                  {s.avg ?? "—"}
                  {s.avgPct != null ? (
                    <span className="text-text-faint ml-1">({s.avgPct}%)</span>
                  ) : null}
                </td>
                <td className="text-text-dim num px-4 py-2.5 text-right text-xs">{s.max ?? "—"}</td>
                <td className="text-text-dim num px-4 py-2.5 text-right text-xs">{s.min ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
