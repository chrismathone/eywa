import { SearchX } from "lucide-react";
import { WindowLink } from "@/components/workspace/window-link";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import { Pagination } from "@/components/pagination";
import { getExamsPage, type ExamRow } from "@/features/exams/server/queries";
import { CreateExamTrigger } from "./_components/exam-form-dialog";

export const metadata = { title: "시험관리 — eywa" };

const PAGE_SIZE = 50;

const SUBJECT_META: Record<string, { label: string; color: PillColor }> = {
  math: { label: "수학", color: "primary" },
  english: { label: "영어", color: "blue" },
  korean: { label: "국어", color: "rose" },
  science: { label: "과학", color: "purple" },
  arts: { label: "예술", color: "amber" },
};

const TYPE_LABEL: Record<string, string> = { weekly: "주간", mock: "모의", school: "학교" };

const SUBJECT_FILTERS = [
  { key: "all", label: "전체" },
  { key: "math", label: "수학" },
  { key: "english", label: "영어" },
  { key: "korean", label: "국어" },
  { key: "science", label: "과학" },
  { key: "arts", label: "예술" },
];

export default async function ExamsPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string; page?: string }>;
}) {
  await requireAccess("exams");
  const sp = await searchParams;
  const subject = sp.subject ?? "all";
  const page = Math.max(1, Number(sp.page) || 1);

  const { rows, total } = await getExamsPage(
    { subject: subject === "all" ? undefined : subject },
    page,
    PAGE_SIZE,
  );
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const chipHref = (key: string) => (key === "all" ? "/exams" : `/exams?subject=${key}`);
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (subject !== "all") params.set("subject", subject);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/exams?${s}` : "/exams";
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="micro mr-1">과목</span>
          {SUBJECT_FILTERS.map((f) => (
            <a
              key={f.key}
              href={chipHref(f.key)}
              className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                subject === f.key
                  ? "border-foreground bg-foreground text-background font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              {f.label}
            </a>
          ))}
        </div>
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
        <CreateExamTrigger />
      </div>

      {total === 0 ? (
        <EmptyState
          icon={() => <SearchX size={32} strokeWidth={1.5} />}
          title="등록된 시험이 없습니다"
          description="시험을 등록하고 반 전체 점수를 일괄 입력해 보세요."
        />
      ) : (
        <>
          <ExamTable rows={rows} />
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}

function ExamTable({ rows }: { rows: ExamRow[] }) {
  return (
    <div className="bg-card border-line shadow-card overflow-auto rounded-md border">
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
            const meta = SUBJECT_META[e.subject] ?? { label: e.subject, color: "neutral" as PillColor };
            const s = e.stats;
            return (
              <tr key={e.id} className="hover:bg-bg-soft/50">
                <td className="text-text-dim font-mono px-4 py-2.5 text-[12px]">{e.examDate}</td>
                <td className="px-4 py-2.5">
                  <Pill color={meta.color}>{meta.label}</Pill>
                </td>
                <td className="text-text-dim px-4 py-2.5 text-[12px]">
                  {TYPE_LABEL[e.examType] ?? e.examType}
                </td>
                <td className="px-4 py-2.5">
                  <WindowLink
                    href={`/exams/${e.id}`}
                    title={e.name}
                    className="text-foreground text-[13px] font-bold hover:underline"
                  >
                    {e.name}
                  </WindowLink>
                </td>
                <td className="text-foreground num px-4 py-2.5 text-right text-[12px] font-bold">
                  {s.count}명
                </td>
                <td className="text-text-dim num px-4 py-2.5 text-right text-[12px]">
                  {s.avg ?? "—"}
                  {s.avgPct != null ? (
                    <span className="text-text-faint ml-1">({s.avgPct}%)</span>
                  ) : null}
                </td>
                <td className="text-text-dim num px-4 py-2.5 text-right text-[12px]">{s.max ?? "—"}</td>
                <td className="text-text-dim num px-4 py-2.5 text-right text-[12px]">{s.min ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
