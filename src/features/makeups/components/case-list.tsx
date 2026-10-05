import { EmbedLink as Link } from "@/components/embed-link";
import { MAKEUP_ACTION, MAKEUP_FLAG, MAKEUP_REASON, MAKEUP_STATE, makeupText } from "../status";
import type { MakeupCaseList } from "../server/read-types";
import type { SubjectMaps } from "@/features/owner/subjects";
import { makeupCaseHref, makeupListHref } from "./list-navigation";

const minutes = (value: number | null) => value === null ? "미정" : `${value}분`;
export function MakeupCaseTable({ data, subjects, filter }: {
  data: MakeupCaseList; subjects: SubjectMaps; filter: Record<string, string>;
}) {
  const href = (patch: Record<string, string>) => makeupListHref(filter, patch);
  return <div className="space-y-4">
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {Object.entries(MAKEUP_FLAG).map(([key, label]) => <div key={key} className="border-line rounded-lg border p-3">
        <dt><Link href={href({ tab: "active", flag: key === "active" ? "" : key, page: "1" })} className="text-primary inline-block min-h-6 underline">{label}</Link></dt>
        <dd className="mt-1 text-xl font-bold">{data.counts[key] ?? "—"}</dd>
      </div>)}
      {(data.counts.closed_recon_open ?? 0) > 0 ? <div className="border-line rounded-lg border p-3">
        <dt><Link href={href({ tab: "closed", flag: "recon_open", page: "1" })} className="text-primary inline-block min-h-6 underline">종결 후 확인 필요</Link></dt>
        <dd className="mt-1 text-xl font-bold">{data.counts.closed_recon_open}건</dd>
      </div> : null}
    </dl>
    <p className="text-sm">조회 {data.total}건 · 마지막 성공 {new Date(data.last_success_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
    <div className="border-line relative overflow-x-auto rounded-lg border">
      <table className="block w-full text-left text-sm md:table">
        <caption className="sr-only">보강 접수·잔량·다음 업무 목록</caption>
        <thead className="bg-bg-soft hidden md:table-header-group"><tr>{["학생·원수업", "진행", "의무 잔량 / 예약 중 / 예약 가능", "다음 업무", "담당·기한"].map(label => <th key={label} scope="col" className="whitespace-nowrap px-4 py-3">{label}</th>)}</tr></thead>
        <tbody className="block md:table-row-group">{data.rows.map(row => <tr key={row.id} className="border-line grid grid-cols-2 border-t align-top md:table-row">
          <td className="col-span-2 block break-words px-4 py-3 md:table-cell"><Link href={makeupCaseHref(row.id, filter)} className="text-primary inline-block min-h-6 font-bold underline">{row.student_name}</Link>
            <p>{subjects.labelOf(row.subject_key)} · {row.original_class_name ?? "원결석 없음"}</p>
            <p>{row.original_date ?? "—"} · {makeupText(MAKEUP_REASON, row.reason)}</p>
          </td>
          <td className="block px-4 py-3 md:table-cell"><span className="mb-1 block font-medium md:hidden">진행</span>{makeupText(MAKEUP_STATE, row.eligibility)}<p>{makeupText(MAKEUP_STATE, row.lifecycle)}</p>
            {row.imported_commitment ? <p>기존 약속 유지</p> : null}</td>
          <td className="block px-4 py-3 md:table-cell md:whitespace-nowrap"><span className="mb-1 block font-medium md:hidden">의무 잔량 / 예약 중 / 예약 가능</span>{minutes(row.outstanding_minutes)} / {minutes(row.committed_minutes)} / {minutes(row.reservable_minutes)}</td>
          <td className="block break-words px-4 py-3 md:table-cell"><span className="mb-1 block font-medium md:hidden">다음 업무</span>{makeupText(MAKEUP_ACTION, row.next_action)}
            {row.reason === "additional" ? <p>예약 제한 · 접수·승인까지만 지원</p> : null}
            {row.flags.map(flag => <p key={flag}>{makeupText(MAKEUP_FLAG, flag)}</p>)}
            {row.next_session_date ? <p>다음 예약 {row.next_session_date}</p> : null}</td>
          <td className="block break-words px-4 py-3 md:table-cell"><span className="mb-1 block font-medium md:hidden">담당·기한</span>{row.owner_name ?? "미지정"}<p>{row.due_date ?? "기한 미지정"}</p></td>
        </tr>)}</tbody>
      </table>
      {!data.rows.length ? <p className="p-6">선택한 조건의 보강 건이 없습니다.</p> : null}
    </div>
    <nav aria-label="보강 목록 페이지" className="flex items-center justify-between gap-3">
      {data.page > 1 ? <Link className="text-primary min-h-6 underline" aria-label="보강 목록 이전 페이지" href={href({ page: String(data.page - 1) })}>이전</Link> : <span />}
      <span>{data.page} / {Math.max(1, Math.ceil(data.total / data.page_size))}</span>
      {data.page * data.page_size < data.total ? <Link className="text-primary min-h-6 underline" aria-label="보강 목록 다음 페이지" href={href({ page: String(data.page + 1) })}>다음</Link> : <span />}
    </nav>
  </div>;
}
