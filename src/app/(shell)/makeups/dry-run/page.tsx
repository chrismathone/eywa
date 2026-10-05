import { randomUUID } from "node:crypto";
import { EmbedLink as Link } from "@/components/embed-link";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { EmbedHiddenInput } from "@/components/embed-link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getMakeupLegacyDryRun } from "@/features/makeups/server/queries";
import { CandidateAction } from "@/features/makeups/components/candidate-action";

export const metadata = { title: "보강관리 · 도입 사전 점검 — 에이와" };
const grades = { A: "일정 보존 대상", B: "실시 근거 검토 대상", C: "근거 추가 확인", D: "분할·중복 확인", E: "재원·원반 확인" };
export default async function MakeupDryRunPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAccess("makeups");
  const [sp, settings, canWrite] = await Promise.all([searchParams, getTenantSettings(), canWriteTenant(actor.systemRole, "makeups")]);
  const text = (key: string) => typeof sp[key] === "string" ? sp[key].slice(0, 80) : "";
  const rawPage = Number(text("page") || 1);
  const filter = { q: text("q"), date_from: text("date_from"), date_to: text("date_to") };
  const page = Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100_000) : 1;
  const result = await getMakeupLegacyDryRun({ ...filter, page, page_size: 30 });
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const batchId = randomUUID();
  const href = (next: number) => `/makeups/dry-run?${new URLSearchParams({ ...filter, page: String(next) })}`;
  return <div className="space-y-4 pb-6">
    <PageHeader title="도입 사전 점검" description="기존 약속을 읽어 분류합니다. 조회로는 권리·시수·예약을 변경하지 않습니다." actions={<Link href="/makeups" className="text-primary min-h-6 underline">목록</Link>} />
    <form action="/makeups/dry-run" method="get" className="flex flex-wrap items-end gap-3"><EmbedHiddenInput />
      <label className="space-y-1"><span className="block">학생 이름</span><Input name="q" defaultValue={filter.q} /></label>
      <label className="space-y-1"><span className="block">원수업 시작일</span><Input type="date" name="date_from" defaultValue={filter.date_from} /></label>
      <label className="space-y-1"><span className="block">원수업 종료일</span><Input type="date" name="date_to" defaultValue={filter.date_to} /></label>
      <Button variant="outline">조회</Button>
    </form>
    {!result.data ? <p role="alert">{result.error}</p> : <>
      <p>전체 {result.data.total}건 · 조회 쓰기 {result.data.writes}건 · 연결해도 실시 인정은 별도 검토합니다.</p>
      <dl className="flex flex-wrap gap-3">{Object.entries(grades).map(([grade, label]) => <div key={grade} className="border-line rounded-md border p-2">
        <dt>{grade} · {label}</dt><dd>{result.data.counts[grade as keyof typeof grades]}건</dd>
      </div>)}</dl>
      <div className="border-line relative overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm">
        <caption className="sr-only">기존 보강 약속의 근거 분류·중복·원본 해시</caption><thead className="bg-bg-soft"><tr>
          {["학생·원수업", "예정 일정", "근거 분류", "원본 확인", "처리"].map(label => <th scope="col" key={label} className="px-3 py-2">{label}</th>)}
        </tr></thead><tbody>{result.data.rows.map(row => <tr key={row.id} className="border-line border-t align-top">
          <td className="px-3 py-2">{row.student_name}<p>{subjects.labelOf(row.subject_key)} · {row.class_name}</p><p>{row.original_date}</p></td>
          <td className="px-3 py-2">{row.session_date || "미정"}</td>
          <td className="min-w-48 px-3 py-2">{row.evidence_grade} · {grades[row.evidence_grade]}<p>{row.review_note}</p><p>같은 원수업의 다른 약속 {row.duplicate_count}건</p></td>
          <td className="px-3 py-2"><details><summary className="min-h-6 cursor-pointer">원본 해시·사건 키</summary><p className="max-w-56 break-all">{row.source_hash}</p><p className="max-w-56 break-all">{row.occurrence_key}</p></details></td>
          <td className="min-w-40 px-3 py-2">{canWrite && settings.makeups.mode === "on" ? <CandidateAction kind="legacy" row={row} sourceHash={row.source_hash} batchId={batchId} /> : "읽기 전용"}</td>
        </tr>)}</tbody></table>{!result.data.rows.length ? <p className="p-3">해당 기존 약속이 없습니다.</p> : null}</div>
      <p className="break-all text-sm">현재 조회 배치 {batchId} · 원본이 바뀌면 연결을 중단하고 다시 확인합니다.</p>
      <nav aria-label="도입 사전 점검 페이지" className="flex items-center justify-between gap-3">
        {page > 1 ? <Link href={href(page - 1)} className="text-primary min-h-6 underline">이전 페이지</Link> : <span />}
        <span>{page} / {Math.max(1, Math.ceil(result.data.total / result.data.page_size))}</span>
        {page * result.data.page_size < result.data.total ? <Link href={href(page + 1)} className="text-primary min-h-6 underline">다음 페이지</Link> : <span />}
      </nav>
    </>}
  </div>;
}
