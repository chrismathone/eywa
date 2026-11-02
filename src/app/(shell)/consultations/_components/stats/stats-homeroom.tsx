"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { HOMEROOM_CELL_META, type HomeroomCell, type HomeroomStats } from "@/features/consultations/homeroom-model";
import {
  alignHomeroomFilter,
  filterHomeroomTeachers,
  statsLinkOf,
  nextSort,
  sortHomeroomTeachers,
  type HomeroomFilter,
  type HomeroomSort,
  type HomeroomSortKey,
  type HomeroomView,
} from "@/features/consultations/homeroom-sort";
import { bucketLabel } from "@/features/consultations/stats-model";
import { saveConsultationStatsPrefs } from "@/features/consultations/server/stats-prefs-actions";
import { HomeroomStudentGrid } from "./stats-homeroom-students";
import { HomeroomFilters } from "./stats-homeroom-filters";
import { HomeroomTeacherRow, SortHead } from "./stats-homeroom-row";
import { HomeroomGaugeGrid } from "./stats-homeroom-gauge";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const mLabel = (ym: string) => bucketLabel(`${ym}-01`, "month");
const LEGEND: HomeroomCell[] = ["self", "other", "none", "before"];

/**
 * 담임별 상담 현황(homeroom-model.ts) — 담임 한 줄 = 달별 '담임이 상담한 학생 / 대상 학생'. 줄을 누르면 그 담임의 학생 × 달 표가 펼쳐진다.
 * 열 머리를 누르면 그 열로 정렬, 위 줄에서 골라 보기(과목·담임·미상담만, homeroom-sort.ts) — 둘 다 누르는 순간 계정에 저장([[#90]]).
 * 강사는 본인 한 줄이라 처음부터 펼친다.
 * 🔗 과목·담임 고르기 = 위 상담 통계(지표·추이)의 과목·상담사 조건(원장 2026-10-28 — 상담사별 분해 카드를 숨기며 이 표에 이었다).
 *    고르면 주소의 `who`·`subject`를 바꿔 통계가 다시 집계되고, 주소가 바뀌면(위 드롭다운) 이 표의 고르기도 따라온다(`alignHomeroomFilter`).
 */
export function StatsHomeroom({
  data,
  teacherScoped,
  initialSort,
  initialFilter,
  initialView,
  linkedWho,
  linkedSubject,
}: {
  data: HomeroomStats | null;
  teacherScoped: boolean;
  initialSort: HomeroomSort;
  initialFilter: HomeroomFilter;
  initialView: HomeroomView;
  /** 지금 통계 조건(주소의 상담사·과목) — 이 표의 고르기와 맞물린다. */
  linkedWho: string;
  linkedSubject: string;
}) {
  const subjects = useSubjectMaps();
  const router = useRouter();
  const pathname = usePathname() ?? "/consultations/stats";
  const searchParams = useSearchParams();
  // 펼친 담임 — 강사(본인 한 줄)이거나, 주소로 한 담임을 골라 들어왔으면(목록 요약 띠 [담임별]의 이름) 그 줄을 펼친 채로.
  const [open, setOpen] = useState<string | null>(
    teacherScoped && data?.teachers.length === 1 ? data.teachers[0]!.id : linkedWho && data?.teachers.some((t) => t.id === linkedWho) ? linkedWho : null,
  );
  // `#homeroom`으로 들어오면 이 표로 내려간다 — 표가 Suspense 뒤에 늦게 서면 라우터의 해시 스크롤이 놓친다(리뷰 2026-10-30).
  useEffect(() => {
    if (window.location.hash === "#homeroom") document.getElementById("homeroom")?.scrollIntoView({ block: "start" });
  }, []);
  const [sort, setSort] = useState(initialSort);
  const [view, setView] = useState(initialView);
  const [filter, setFilter] = useState(() => alignHomeroomFilter(initialFilter, linkedWho, linkedSubject));
  // 주소가 바뀌면(위 드롭다운 · 이 표가 보낸 이동) 고르기를 맞춘다 — 렌더 중 비교(effect 안 setState 금지 규칙, [[#25]]).
  const linkKey = `${linkedWho}|${linkedSubject}`;
  const [seenLink, setSeenLink] = useState(linkKey);
  // 이 표가 마지막으로 보낸 목적지 — 이동이 도착하기 전(주소가 아직 옛 값)에 또 누르면 옛 주소와 견줘 "같으니 안 보냄"으로 끝나
  // 앞 이동이 도착하며 고르기를 되돌린다(A를 골랐다 바로 풀면 A로 돌아간다). 그래서 견줄 값은 '보낸 목적지'다. 앞선 이동은 라우터가 버린다.
  const [sentLink, setSentLink] = useState<string | null>(null);
  if (seenLink !== linkKey) {
    setSeenLink(linkKey);
    setFilter((f) => alignHomeroomFilter(f, linkedWho, linkedSubject));
  }
  if (sentLink !== null && sentLink === linkKey) setSentLink(null);
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
  const onView = (next: HomeroomView) => {
    setView(next);
    void saveConsultationStatsPrefs({ hrView: next }).catch(() => undefined);
  };
  const onSort = (key: HomeroomSortKey) => {
    const next = nextSort(sort, key);
    setSort(next);
    void saveConsultationStatsPrefs({ hrSort: next }).catch(() => undefined); // 표시 취향 — 저장 실패해도 화면은 바뀐 그대로
  };
  const onFilter = (next: HomeroomFilter) => {
    setFilter(next);
    void saveConsultationStatsPrefs({ hrFilter: next }).catch(() => undefined);
    // 통계 조건이 달라질 때만 이동한다(미상담만·펼친 표 거르기는 이 표 안의 일). 다른 조건·embed는 지금 주소 그대로 싣는다([[#133]]).
    const link = statsLinkOf(next);
    const target = `${link.who}|${link.subject}`;
    if (target === (sentLink ?? linkKey)) return;
    setSentLink(target);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    for (const [k, v] of Object.entries(link)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    params.delete("page");
    const s = params.toString();
    router.push(`${pathname}${s ? `?${s}` : ""}`, { scroll: false });
  };
  const head = (key: HomeroomSortKey, label: ReactNode) => <SortHead key={key} label={label} active={sort.key === key} dir={sort.dir} onClick={() => onSort(key)} />;
  return (
    // id — 목록 요약 띠의 [담임별] 팝업이 여기로 바로 내려온다(`/consultations/stats#homeroom`).
    <div id="homeroom" className={`${card} scroll-mt-4`}>
      <div className="space-y-0.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-foreground text-sm font-bold">담임별 상담 현황</p>
          <ToolbarSegment label="보기">
            <ToolbarSegmentItem active={view === "table"} onClick={() => onView("table")}>
              표
            </ToolbarSegmentItem>
            <ToolbarSegmentItem active={view === "gauge"} onClick={() => onView("gauge")}>
              게이지
            </ToolbarSegmentItem>
          </ToolbarSegment>
        </div>
        <p className="text-muted-foreground text-xs break-keep">
          지금 담임 반 재원생 · {months.length > 1 ? `${mLabel(months[0]!)}~${mLabel(months[last]!)}` : `${mLabel(months[0]!)}부터`} · 담임 본인이 쓴 상담 기준 · 부담임·특강·JJ 반 제외 · 기간·카테고리 필터와 무관 · 과목·담임(한 명)을 고르면 위 상담 통계도 그 조건으로
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
      ) : view === "gauge" ? (
        <HomeroomGaugeGrid teachers={sorted} months={months} prevMonth={data.prevMonth} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-line text-muted-foreground border-b text-xs">
                {head("name", "담임")}
                {head("subject", "과목")}
                {head("prev", `${mLabel(data.prevMonth)} 학생`)}
                {head("students", `${mLabel(months[last]!)} 학생`)}
                {head("left", `${mLabel(data.prevMonth)} 퇴원`)}
                {months.map((m, i) => head(`m${last - i}`, m === months[last] ? `${mLabel(m)}(진행 중)` : mLabel(m)))}
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
                  <HomeroomTeacherRow t={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
                  {open === t.id ? (
                    <tr>
                      <td colSpan={months.length + 8} className="bg-bg-soft/40 p-2">
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
        칸 = 담임이 상담한 학생 / 그 달 대상 학생(반에 들어오기 전 달은 빼고 센다). 열 제목을 누르면 정렬된다(상담률은 낮은 순부터). 상담 칸은 지금
        담임 기준이다. {mLabel(data.prevMonth)} 학생 = 그 달 말일에 담임 반에 있던 학생(지금 퇴원했어도 센다) · {mLabel(months[last]!)} 학생 = 오늘 재원생 ·{" "}
        {mLabel(data.prevMonth)} 퇴원 = 그 달에 학원을 나갔거나 그 과목을 그만둔 학생(학생 퇴원일 기준 · 반이동 제외). 지난달 학생·퇴원은 그 당시
        담임 앞으로 센다(담임 변경 기록 기준) · 이름은 마우스 오버·펼친 표. 한 학생이 같은 과목을 여러 반에서 들으면 가장 많은 요일을 듣는 반의
        담임만 센다(같으면 모두 · 화목 반에서 화요일만 들으면 그 반 담임에겐 부담임 · 강사평가 원생상담과 같은 기준).
      </p>
    </div>
  );
}
