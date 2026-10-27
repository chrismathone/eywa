"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { HOMEROOM_CELL_META, type HomeroomCell, type HomeroomStats } from "@/features/consultations/homeroom-model";
import {
  filterHomeroomTeachers,
  nextSort,
  sortHomeroomTeachers,
  type HomeroomFilter,
  type HomeroomSort,
  type HomeroomSortKey,
} from "@/features/consultations/homeroom-sort";
import { bucketLabel } from "@/features/consultations/stats-model";
import { saveConsultationStatsPrefs } from "@/features/consultations/server/stats-prefs-actions";
import { HomeroomStudentGrid } from "./stats-homeroom-students";
import { HomeroomFilters } from "./stats-homeroom-filters";
import { HomeroomTeacherRow, SortHead } from "./stats-homeroom-row";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const mLabel = (ym: string) => bucketLabel(`${ym}-01`, "month");
const LEGEND: HomeroomCell[] = ["self", "other", "none", "before"];

/**
 * 담임별 상담 현황(homeroom-model.ts) — 담임 한 줄 = 달별 '담임이 상담한 학생 / 대상 학생'. 줄을 누르면 그 담임의 학생 × 달 표가 펼쳐진다.
 * 열 머리를 누르면 그 열로 정렬, 위 줄에서 골라 보기(과목·담임·미상담만, homeroom-sort.ts) — 둘 다 누르는 순간 계정에 저장([[#90]]).
 * 강사는 본인 한 줄이라 처음부터 펼친다.
 */
export function StatsHomeroom({
  data,
  teacherScoped,
  initialSort,
  initialFilter,
}: {
  data: HomeroomStats | null;
  teacherScoped: boolean;
  initialSort: HomeroomSort;
  initialFilter: HomeroomFilter;
}) {
  const subjects = useSubjectMaps();
  const [open, setOpen] = useState<string | null>(teacherScoped && data?.teachers.length === 1 ? data.teachers[0]!.id : null);
  const [sort, setSort] = useState(initialSort);
  const [filter, setFilter] = useState(initialFilter);
  const sorted = useMemo(
    () => (data ? sortHomeroomTeachers(filterHomeroomTeachers(data.teachers, filter), sort, subjects.labelOf) : []),
    [data, filter, sort, subjects],
  );
  const card = "border-line col-span-full space-y-3 rounded-2xl border p-3";
  if (!data) {
    return <p className={`${card} text-muted-foreground text-sm`}>담임별 상담 현황을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>;
  }
  const { months, retired } = data;
  const last = months.length - 1;
  // 달이 하나뿐이면 평균 = 그 달 — 같은 숫자를 두 번 세우지 않는다.
  const showAvg = months.length > 1;
  const onSort = (key: HomeroomSortKey) => {
    const next = nextSort(sort, key);
    setSort(next);
    void saveConsultationStatsPrefs({ hrSort: next }).catch(() => undefined); // 표시 취향 — 저장 실패해도 화면은 바뀐 그대로
  };
  const onFilter = (next: HomeroomFilter) => {
    setFilter(next);
    void saveConsultationStatsPrefs({ hrFilter: next }).catch(() => undefined);
  };
  const head = (key: HomeroomSortKey, label: ReactNode) => <SortHead key={key} label={label} active={sort.key === key} dir={sort.dir} onClick={() => onSort(key)} />;
  return (
    <div className={card}>
      <div className="space-y-0.5">
        <p className="text-foreground text-sm font-bold">담임별 상담 현황</p>
        <p className="text-muted-foreground text-xs break-keep">
          지금 담임 반 재원생 · {months.length > 1 ? `${mLabel(months[0]!)}~${mLabel(months[last]!)}` : `${mLabel(months[0]!)}부터`} · 담임 본인이 쓴 상담 기준 · 부담임·특강·JJ 반 제외 · 위 필터와 무관
          {retired.teachers > 0 ? ` · 퇴사한 담임 ${retired.teachers}명의 반 ${retired.classes}개(학생 ${fmt(retired.students)}명) 제외` : ""}
        </p>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {LEGEND.map((c) => (
            <span key={c} className="text-muted-foreground inline-flex items-center gap-1">
              <span className={`inline-flex size-4 items-center justify-center rounded ${TONE_SOFT[HOMEROOM_CELL_META[c].tone]}`}>{HOMEROOM_CELL_META[c].mark}</span>
              {HOMEROOM_CELL_META[c].label}
            </span>
          ))}
          <span className="text-muted-foreground">· 칸에 마우스를 올리면 누가 상담했는지 보입니다</span>
        </p>
      </div>
      {data.teachers.length > 0 ? <HomeroomFilters teachers={data.teachers} filter={filter} onChange={onFilter} /> : null}
      {data.teachers.length > 1 && sorted.length !== data.teachers.length ? (
        <p className="text-muted-foreground text-xs">
          담임 {data.teachers.length}명 중 {sorted.length}명 표시
        </p>
      ) : null}
      {sorted.length === 0 ? (
        <p className="text-muted-foreground py-3 text-center text-sm">
          {data.teachers.length > 0 ? "고른 조건에 맞는 담임이 없습니다" : teacherScoped ? "담임을 맡은 반이 없습니다" : "담임 반이 없습니다"}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-line text-muted-foreground border-b text-xs">
                {head("name", "담임")}
                {head("subject", "과목")}
                {head("students", "학생")}
                {months.map((m, i) => head(`m${last - i}`, m === months[last] ? `${mLabel(m)}(진행 중)` : mLabel(m)))}
                {showAvg ? head("avg", "평균") : null}
                {head("unmet", "이번 달 미상담")}
                <th className="px-2 py-1.5 text-center font-medium whitespace-nowrap" title="이번 달 담임은 안 했지만 다른 선생님·데스크가 상담한 학생 수">
                  담임 아닌 직원 상담
                </th>
                <th className="px-2 py-1.5 text-center font-medium">이번 달 미상담 학생</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <Fragment key={t.id}>
                  <HomeroomTeacherRow t={t} showAvg={showAvg} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
                  {open === t.id ? (
                    <tr>
                      <td colSpan={months.length + (showAvg ? 7 : 6)} className="bg-bg-soft/40 p-2">
                        <HomeroomStudentGrid t={t} months={months} unmetOnly={filter.unmetStudentsOnly} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-muted-foreground text-xs break-keep">
        칸 = 담임이 상담한 학생 / 그 달 대상 학생(반에 들어오기 전 달은 빼고 센다). 열 제목을 누르면 정렬된다(상담률은 낮은 순부터). 담임은 지금 기준이라
        담임이 바뀐 반은 지난 달도 지금 담임 앞으로 보인다.
      </p>
    </div>
  );
}
