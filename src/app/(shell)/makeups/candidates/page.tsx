import { EmbedLink as Link } from "@/components/embed-link";
import { EmbedHiddenInput } from "@/components/embed-link";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getMakeupCandidates } from "@/features/makeups/server/queries";
import { CandidateAction } from "@/features/makeups/components/candidate-action";
import { PageHeader } from "@/components/page-header";
import { Toolbar } from "@/components/toolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata = { title: "보강관리 · 미연결 근거 — 에이와" };
export default async function MakeupCandidatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAccess("makeups");
  const [sp, settings, canWrite] = await Promise.all([searchParams, getTenantSettings(), canWriteTenant(actor.systemRole, "makeups")]);
  const kind = sp.kind === "legacy" ? "legacy" : "absence";
  const requestedPage = Number(sp.page || 1);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100_000) : 1;
  const date = (value: string | undefined) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  const filter = { kind, q: (sp.q || "").slice(0, 80), subject_key: (sp.subject_key || "").slice(0, 40),
    date_from: date(sp.date_from), date_to: date(sp.date_to) };
  const result = await getMakeupCandidates({ ...filter, page, page_size: 30 });
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const pilotSubjects = new Set<string>(settings.makeups.pilotSubjects);
  const href = (nextPage: number) => `/makeups/candidates?${new URLSearchParams({ ...filter, page: String(nextPage) })}`;
  return <div className="space-y-4 pb-6">
    <PageHeader title="미연결 근거" description="결석·기존 약속을 확인하여 접수·연결합니다" actions={<Link href="/makeups" className="text-primary underline">목록</Link>} />
    <form action="/makeups/candidates" method="get"><EmbedHiddenInput /><Toolbar rail={false}>
      <label className="flex items-center gap-2">근거
        <select name="kind" defaultValue={kind} className="border-line min-h-8 rounded-md border bg-white px-2"><option value="absence">미연결 결석</option><option value="legacy">기존 보강 약속</option></select>
      </label>
      <Input name="q" defaultValue={filter.q} aria-label="미연결 근거 학생 이름 검색" placeholder="학생 이름 검색" className="max-w-64" />
      <label className="flex items-center gap-2">원수업 시작일<Input type="date" name="date_from" defaultValue={filter.date_from} /></label>
      <label className="flex items-center gap-2">원수업 종료일<Input type="date" name="date_to" defaultValue={filter.date_to} /></label>
      <Button type="submit" variant="outline">조회</Button>
    </Toolbar></form>
    {!result.data ? <p role="alert">{result.error}</p> : <>
      <p>{result.data.total}건 · 접수만으로 권리가 확정되거나 완료로 인정되지 않습니다.</p>
      <div className="border-line relative overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm">
        <caption className="sr-only">미연결 결석·기존 보강 약속</caption><thead className="bg-bg-soft"><tr>{["학생", "원수업", "예정 일정", "처리"].map(label => <th scope="col" key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
        <tbody>{result.data.rows.map(row => <tr key={row.id} className="border-line border-t align-top">
          <td className="px-4 py-3">{row.student_name}<p>{subjects.labelOf(row.subject_key)}</p></td>
          <td className="px-4 py-3">{row.original_date}<p>{row.class_name}</p></td><td className="px-4 py-3">{row.session_date ?? "—"}</td>
          <td className="px-4 py-3">{canWrite && settings.makeups.mode === "on" && pilotSubjects.has(row.subject_key) ? <CandidateAction kind={kind} row={row} /> : "읽기 전용"}</td>
        </tr>)}</tbody></table>{!result.data.rows.length ? <p className="p-4">해당 근거가 없습니다.</p> : null}</div>
      <nav aria-label="미연결 근거 페이지" className="flex justify-between gap-3">
        {result.data.page > 1 ? <Link href={href(result.data.page - 1)} className="text-primary underline" aria-label="미연결 근거 이전 페이지">이전</Link> : <span />}
        <span>{result.data.page} / {Math.max(1, Math.ceil(result.data.total / result.data.page_size))}</span>
        {result.data.page * result.data.page_size < result.data.total ? <Link href={href(result.data.page + 1)} className="text-primary underline" aria-label="미연결 근거 다음 페이지">다음</Link> : <span />}
      </nav>
    </>}
  </div>;
}
