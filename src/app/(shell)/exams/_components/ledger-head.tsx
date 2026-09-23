import Link from "next/link";
import { HeaderFilter } from "@/components/header-filter";
import { EyIcon } from "@/components/icons/aywa-icons";
import type { FilterSelectOption } from "@/components/filter-select";
import type { LedgerSort, LedgerView } from "@/features/grades/unified/ledger-view";

type Href = (patch: Record<string, string>) => string;

/** 누르면 그 열로 정렬, 같은 열을 다시 누르면 방향을 뒤집는다. 지금 정렬 열만 화살표가 진하다. */
function SortButton({ sort, view, href, label }: { sort: LedgerSort; view: LedgerView; href: Href; label?: string }) {
  const on = view.sort === sort;
  const nextDir = on ? (view.dir === "asc" ? "desc" : "asc") : sort === "date" || sort === "score" || sort === "delta" ? "desc" : "asc";
  return <Link href={href({ sort, dir: nextDir, page: "1" })} aria-label={`${label ?? ""} ${nextDir === "asc" ? "오름차순" : "내림차순"} 정렬`.trim()}
    className={`inline-flex items-center gap-0.5 rounded-md px-1 hover:bg-bg-soft ${on ? "text-primary" : "text-text-dim"}`}>
    {label ? <b className="text-foreground">{label}</b> : null}
    <EyIcon name={on && view.dir === "asc" ? "arrowUp" : "arrowDown"} size={13} strokeWidth={on ? 2.6 : 1.8} />
  </Link>;
}

/**
 * 성적 원장 열 머리 — 모든 열이 정렬되고, 값이 갈리는 열은 **머리 자체가 필터**(지시서 §10 "필터·정렬은 목록 헤더 라벨").
 * 필터 선택지는 열 필터를 걸기 전 행에서 만든다(ledgerOptions) — 걸면 사라지는 선택지는 되돌릴 수 없다.
 */
export function LedgerHead({ view, href, options, subject, subjects }: {
  view: LedgerView; href: Href;
  options: { schools: FilterSelectOption[]; classes: FilterSelectOption[]; teachers: FilterSelectOption[] };
  /** 과목 필터 — 툴바의 `과목:`과 **같은 주소 값**(`subject`)을 쓴다. 두 자리가 따로 놀지 않게. */
  subject: string; subjects: FilterSelectOption[];
}) {
  const th = "px-2 py-2 font-bold whitespace-nowrap";
  const both = (filter: React.ReactNode, sort: LedgerSort) => <span className="inline-flex items-center gap-0.5">{filter}<SortButton sort={sort} view={view} href={href} /></span>;
  return <thead className="bg-bg-soft text-sm"><tr>
    <th className={`${th} text-center`}>{both(<HeaderFilter paramName="subject" axisLabel="과목" value={subject} allValue="all" options={subjects} />, "subject")}</th>
    <th className={`${th} text-center`}><SortButton sort="date" view={view} href={href} label="시험일" /></th>
    <th className={`${th} text-center`}><SortButton sort="name" view={view} href={href} label="이름" /></th>
    <th className={`${th} text-center`}>{both(<HeaderFilter paramName="fSchool" axisLabel="학교학년" value={view.school} options={options.schools} cap={500} />, "school")}</th>
    <th className={`${th} text-left`}>{both(<HeaderFilter paramName="fClass" axisLabel="반" value={view.classId} options={options.classes} cap={500} />, "class")}</th>
    <th className={`${th} text-center`}>{both(<HeaderFilter paramName="fTeacher" axisLabel="담임" value={view.teacher} options={options.teachers} cap={200} />, "teacher")}</th>
    <th className={`${th} text-center`}><SortButton sort="kind" view={view} href={href} label="시험" /></th>
    <th className={`${th} text-center`}><SortButton sort="info" view={view} href={href} label="시험정보" /></th>
    <th className={`${th} text-center`}>{both(<HeaderFilter paramName="fScore" axisLabel="점수" value={view.score}
      options={[{ value: "high", label: "90점 이상" }, { value: "mid", label: "60~89점" }, { value: "low", label: "60점 미만" }]} />, "score")}</th>
    <th className={`${th} text-center`}>{both(<HeaderFilter paramName="fDelta" axisLabel="증감" value={view.delta}
      options={[{ value: "up", label: "상승" }, { value: "down", label: "하락" }, { value: "same", label: "변화 없음" }]} />, "delta")}</th>
    <th className={`${th} text-center`}><HeaderFilter paramName="fConsult" axisLabel="상담" value={view.consult}
      options={[{ value: "done", label: "상담함" }, { value: "none", label: "상담 안 함" }]} /></th>
    <th className={`${th} text-center`}>관리</th>
  </tr></thead>;
}
