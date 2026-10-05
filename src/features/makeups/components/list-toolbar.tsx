import { Toolbar } from "@/components/toolbar";
import { EmbedHiddenInput } from "@/components/embed-link";
import { EmbedLink as Link } from "@/components/embed-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAKEUP_FLAG } from "../status";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { makeupListHref } from "./list-navigation";

export function MakeupListToolbar({ filter, subjects }: {
  filter: Record<string, string>; subjects: SubjectSetting[];
}) {
  return <form action="/makeups" method="get" data-help="makeups-filter">
    <EmbedHiddenInput />
    {(["owner_id", "student_id"] as const).map(key => filter[key] ? <input key={key} type="hidden" name={key} value={filter[key]} /> : null)}
    {filter.owner_id || filter.student_id ? <div className="mb-2 flex flex-wrap gap-3 text-sm">
      {(["owner_id", "student_id"] as const).map(key => filter[key] ? <Link key={key}
        href={makeupListHref(filter, { [key]: "", page: "1" })} className="border-line inline-flex min-h-8 items-center rounded-md border px-2"
        aria-label={key === "owner_id" ? "담당자 조건 해제" : "학생 조건 해제"}>
        {key === "owner_id" ? "담당자 지정 조건" : "학생 지정 조건"} ×
      </Link> : null)}
    </div> : null}
    <Toolbar rail={false}>
      <label className="flex items-center gap-2">상태
        <select name="tab" defaultValue={filter.tab || "active"} className="border-line min-h-8 rounded-md border bg-white px-2">
          <option value="active">미처리 전체</option><option value="open">진행 중</option><option value="on_hold">보류</option><option value="closed">종결</option><option value="all">전체</option>
        </select>
      </label>
      <label className="flex items-center gap-2">다음 업무
        <select name="flag" defaultValue={filter.flag || ""} className="border-line min-h-8 rounded-md border bg-white px-2">
          <option value="">전체</option>{Object.entries(MAKEUP_FLAG).filter(([key]) => key !== "active").map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2">과목
        <select name="subject_key" defaultValue={filter.subject_key || ""} className="border-line min-h-8 rounded-md border bg-white px-2">
          <option value="">전체</option>{subjects.map(subject => <option key={subject.key} value={subject.key}>{subject.label}</option>)}
        </select>
      </label>
      <Input name="q" aria-label="보강 학생 이름 검색" defaultValue={filter.q} placeholder="학생 이름 검색" className="max-w-64" />
      <Button type="submit" variant="outline">조회</Button>
    </Toolbar>
  </form>;
}
