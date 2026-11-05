
import { SheetText } from "@/features/teacher-view/interface-label";
import Link from "next/link";
import { HeaderFilter } from "@/components/header-filter";
import { HeaderValueFilter } from "@/components/header-value-filter";
import { EyIcon } from "@/components/icons/aywa-icons";
import type { FilterSelectOption } from "@/components/filter-select";
import type { LedgerSort, LedgerView } from "@/features/grades/unified/ledger-view";

type Href = (patch: Record<string, string>) => string;

/** 누르면 그 열로 정렬, 같은 열을 다시 누르면 방향을 뒤집는다. 지금 정렬 열만 화살표가 진하다. */
export function SortButton({ sort, view, href, label }: { sort: LedgerSort; view: LedgerView; href: Href; label?: string }) {
  const on = view.sort === sort;
  const nextDir = on ? (view.dir === "asc" ? "desc" : "asc") : sort === "date" || sort === "score" || sort === "delta" ? "desc" : "asc";
  return <Link href={href({ sort, dir: nextDir, page: "1" })} aria-label={`${label ?? ""} ${nextDir === "asc" ? "오름차순" : "내림차순"} 정렬`.trim()}
    className={`inline-flex items-center gap-0.5 rounded-md px-1 hover:bg-bg-soft ${on ? "text-primary" : "text-text-dim"}`}>
    {label ? <b className="text-foreground">{label}</b> : null}
    <EyIcon name={on && view.dir === "asc" ? "arrowUp" : "arrowDown"} size={13} strokeWidth={on ? 2.6 : 1.8} />
  </Link>;
}

/**
 * 성적 원장 열 머리 — 값이 갈리는 열은 **머리 자체가 필터**(지시서 §10 "필터·정렬은 목록 헤더 라벨").
 * 정렬은 순서가 뜻을 갖는 열(시험일·이름·점수·증감)에만 둔다. 학교학년·반·담임·시험·시험정보는 정렬 대신 **엑셀식 값 필터**
 * (원장 2026-10-14 *"오름차순/내림차순 필요없는 제목 행에 대해서는 엑셀처럼 필터적용가능하게"*).
 * 필터 선택지는 열 필터를 걸기 전 행에서 만든다(ledgerOptions) — 걸면 사라지는 선택지는 되돌릴 수 없다.
 */
export function LedgerHead({ view, href, options, subject, subjects, canWrite = true }: {
  view: LedgerView; href: Href;
  options: { schools: FilterSelectOption[]; classes: FilterSelectOption[]; teachers: FilterSelectOption[]; kinds: FilterSelectOption[]; infos: FilterSelectOption[] };
  /** 과목 필터 — 툴바의 `과목:`과 **같은 주소 값**(`subject`)을 쓴다. 두 자리가 따로 놀지 않게. */
  subject: string; subjects: FilterSelectOption[];
  /** 읽기 권한이면 '관리' 열을 뺀다 — 원장 줄의 [수정]·[삭제] 칸과 **같은 값**(UnifiedLedger `canWrite`)을 넘길 것. */
  canWrite?: boolean;
}) {
  const th = "px-2 py-2 font-bold whitespace-nowrap";
  const both = (filter: React.ReactNode, sort: LedgerSort) => <span className="inline-flex items-center gap-0.5">{filter}<SortButton sort={sort} view={view} href={href} /></span>;
  return <thead className="bg-bg-soft text-sm"><tr>
    <th className={`${th} text-center`}>{both(<HeaderFilter paramName="subject" axisLabel="과목" value={subject} allValue="all" options={subjects} />, "subject")}</th>
    <th className={`${th} text-center`}><SortButton sort="date" view={view} href={href} label="시험일" /></th>
    <th className={`${th} text-center`}><SortButton sort="name" view={view} href={href} label="이름" /></th>
    <th className={`${th} text-center`}><HeaderValueFilter paramName="fSchool" axisLabel="학교학년" filter={view.school} options={options.schools} /></th>
    <th className={`${th} text-left`}><HeaderValueFilter paramName="fClass" axisLabel="반" filter={view.classId} options={options.classes} /></th>
    <th className={`${th} text-center`}><HeaderValueFilter paramName="fTeacher" axisLabel="담임" filter={view.teacher} options={options.teachers} /></th>
    <th className={`${th} text-center`}><HeaderValueFilter paramName="fKind" axisLabel="시험" filter={view.kind} options={options.kinds} /></th>
    <th className={`${th} text-center`}><HeaderValueFilter paramName="fInfo" axisLabel="시험정보" filter={view.info} options={options.infos} /></th>
    {/* 칸 제목은 '점수'(원장 2026-10-14) — 값은 `4개 / 5개`·`84점 / 100점`처럼 단위가 섞여 거르기는 만점 대비 비율로 한다(2026-09-24 환산 표기 제거). 값은 왼쪽 정렬. */}
    <th className={`${th} text-left`}>{both(<HeaderFilter paramName="fScore" axisLabel="점수" value={view.score}
      options={[{ value: "high", label: "90% 이상" }, { value: "mid", label: "60~89%" }, { value: "low", label: "60% 미만" }]} />, "score")}</th>
    <th className="py-2 pl-2 pr-4 text-right font-bold whitespace-nowrap">{both(<HeaderFilter paramName="fDelta" axisLabel="증감" value={view.delta}
      options={[{ value: "up", label: "상승" }, { value: "down", label: "하락" }, { value: "same", label: "변화 없음" }]} />, "delta")}</th>
    <th className={`${th} text-center`}><HeaderFilter paramName="fConsult" axisLabel="상담" value={view.consult}
      options={[{ value: "done", label: "상담함" }, { value: "none", label: "상담 안 함" }]} /></th>
    {canWrite ? <th className={`${th} text-center`}><SheetText value={"관리"} /></th> : null}
  </tr></thead>;
}
