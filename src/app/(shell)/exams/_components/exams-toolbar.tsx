"use client";

import { SheetText } from "@/features/teacher-view/interface-label";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FilterSelect, type FilterSelectOption } from "@/components/filter-select";
import { SearchToggle } from "@/components/search-toggle";
import { Toolbar, ToolbarButton, ToolbarDivider } from "@/components/toolbar";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { withEmbed } from "@/components/workspace/embed-context";

/**
 * 통합 성적관리 툴바 — 다른 화면과 같은 규약(`축: 값` 드롭다운 · control-scale 높이 · 상시 버튼 ≤2).
 * 기간은 날짜 두 칸이라 드롭다운이 아니라 같은 높이의 날짜 입력으로 둔다. 바꾸면 곧바로 URL로 반영된다
 * (옛 [적용] 버튼 폼 대체 — 다른 필터 드롭다운과 반응 방식을 맞춘다).
 */
export function ExamsToolbar({ from, to, subject, kind, missing, q, subjectOptions, kindOptions, exportHref, action }: {
  from: string; to: string; subject: string; kind: string; missing: boolean; q: string;
  subjectOptions: FilterSelectOption[]; kindOptions: FilterSelectOption[];
  exportHref: string;
  /** 오른쪽 끝 주 동작(성적 입력 창의 버튼) — 창 상태를 가진 클라 부품이라 슬롯으로 받는다. */
  action: React.ReactNode;
}) {
  const router = useRouter();
  const inFrame = useInFrame();
  const pathname = usePathname() ?? "/exams";
  const current = useSearchParams();
  const setDate = (key: "from" | "to", value: string) => {
    // 연도를 칠 때 0002·0020…도 "유효한 날짜"라 매 타자마다 이동한다 — 온전한 연도일 때만.
    if (!/^(19|20)\d{2}-\d{2}-\d{2}$/.test(value)) return;
    const params = new URLSearchParams(current?.toString() ?? "");
    params.set(key, value);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  };
  const dateInput = `${CONTROL_H} ${CONTROL_LABEL} border-line bg-background rounded-lg border px-2`;
  return <Toolbar>
    <span className={`${CONTROL_LABEL} text-text-dim`}><SheetText value={"기간:"} /></span>
    <input type="date" aria-label="시작일" className={dateInput} value={from} max={to} onChange={(e) => setDate("from", e.target.value)} />
    <span aria-hidden>~</span>
    <input type="date" aria-label="종료일" className={dateInput} value={to} min={from} onChange={(e) => setDate("to", e.target.value)} />
    <FilterSelect paramName="subject" axisLabel="과목" value={subject} allValue="all" options={subjectOptions} />
    {/* 열 머리 '시험'(fKind)·'시험정보'(fInfo)는 이 값 안에서 다시 좁힌다 — 여기를 바꾸면 둘을 푼다(어긋나 0건이 되지 않게, 리뷰 2026-10-14). */}
    <FilterSelect paramName="kind" axisLabel="시험" value={kind} allValue="all" options={kindOptions} clearParams={["fKind", "fInfo"]} />
    <FilterSelect paramName="missing" axisLabel="미입력" allLabel="숨김" value={missing ? "1" : ""} options={[{ value: "1", label: "표시" }]} />
    <SearchToggle placeholder="학생 이름" defaultValue={q} />
    <span className="ml-auto" />
    <ToolbarButton onClick={() => window.location.assign(inFrame ? withEmbed(exportHref) : exportHref)}><SheetText value={"엑셀 내보내기"} /></ToolbarButton>
    <ToolbarDivider />
    {action}
  </Toolbar>;
}
