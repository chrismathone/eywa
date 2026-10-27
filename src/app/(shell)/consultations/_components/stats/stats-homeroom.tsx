"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Pill } from "@/components/atoms/pill";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { HOMEROOM_CELL_META, type HomeroomCell, type HomeroomStats, type HomeroomTeacher } from "@/features/consultations/homeroom-model";
import { averageRate, nextSort, sortHomeroomTeachers, type HomeroomSort, type HomeroomSortKey } from "@/features/consultations/homeroom-sort";
import { bucketLabel, pct } from "@/features/consultations/stats-model";
import { saveConsultationStatsPrefs } from "@/features/consultations/server/stats-prefs-actions";
import { HomeroomStudentGrid } from "./stats-homeroom-students";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const mLabel = (ym: string) => bucketLabel(`${ym}-01`, "month");
const rateText = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);
const LEGEND: HomeroomCell[] = ["self", "other", "none", "before"];

/**
 * 담임별 상담 현황(homeroom-model.ts) — 담임 한 줄 = 달별 '담임이 상담한 학생 / 대상 학생'. 줄을 누르면 그 담임의 학생 × 달 표가 펼쳐진다.
 * 열 머리를 누르면 그 열로 정렬(homeroom-sort.ts) — 고른 정렬은 누르는 순간 계정에 저장([[#90]]). 강사는 본인 한 줄이라 처음부터 펼친다.
 */
export function StatsHomeroom({ data, teacherScoped, initialSort }: { data: HomeroomStats | null; teacherScoped: boolean; initialSort: HomeroomSort }) {
  const subjects = useSubjectMaps();
  const [open, setOpen] = useState<string | null>(teacherScoped && data?.teachers.length === 1 ? data.teachers[0]!.id : null);
  const [sort, setSort] = useState(initialSort);
  const sorted = useMemo(() => (data ? sortHomeroomTeachers(data.teachers, sort, subjects.labelOf) : []), [data, sort, subjects]);
  const card = "border-line col-span-full space-y-3 rounded-2xl border p-3";
  if (!data) {
    return <p className={`${card} text-muted-foreground text-sm`}>담임별 상담 현황을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>;
  }
  const { months, retired } = data;
  const last = months.length - 1;
  const onSort = (key: HomeroomSortKey) => {
    const next = nextSort(sort, key);
    setSort(next);
    void saveConsultationStatsPrefs({ hrSort: next }).catch(() => undefined); // 표시 취향 — 저장 실패해도 화면은 바뀐 그대로
  };
  const head = (key: HomeroomSortKey, label: ReactNode) => <SortHead key={key} label={label} active={sort.key === key} dir={sort.dir} onClick={() => onSort(key)} />;
  return (
    <div className={card}>
      <div className="space-y-0.5">
        <p className="text-foreground text-sm font-bold">담임별 상담 현황</p>
        <p className="text-muted-foreground text-xs break-keep">
          지금 담임 반 재원생 · {mLabel(months[0]!)}~{mLabel(months[last]!)} · 담임 본인이 쓴 상담 기준 · 부담임·특강·JJ 반 제외 · 위 필터와 무관
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
      {sorted.length === 0 ? (
        <p className="text-muted-foreground py-3 text-center text-sm">{teacherScoped ? "담임을 맡은 반이 없습니다" : "담임 반이 없습니다"}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-line text-muted-foreground border-b text-xs">
                {head("name", "담임")}
                {head("subject", "과목")}
                {head("students", "학생")}
                {months.map((m, i) => head(`m${last - i}`, m === months[last] ? `${mLabel(m)}(진행 중)` : mLabel(m)))}
                {head("avg", "평균")}
                {head("unmet", "이번 달 미상담")}
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <Fragment key={t.id}>
                  <TeacherRow t={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
                  {open === t.id ? (
                    <tr>
                      <td colSpan={months.length + 5} className="bg-bg-soft/40 p-2">
                        <HomeroomStudentGrid t={t} months={months} />
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

function SortHead({ label, active, dir, onClick }: { label: ReactNode; active: boolean; dir: "asc" | "desc"; onClick: () => void }) {
  return (
    <th className="px-2 py-1.5 text-center font-medium whitespace-nowrap" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={onClick} className={`hover:text-foreground inline-flex items-center gap-0.5 ${active ? "text-foreground font-bold" : ""}`}>
        {label}
        <span aria-hidden="true" className={active ? "" : "opacity-30"}>{active ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

function TeacherRow({ t, open, onToggle }: { t: HomeroomTeacher; open: boolean; onToggle: () => void }) {
  const subjects = useSubjectMaps();
  const now = t.months[t.months.length - 1]!;
  return (
    <tr className="border-line hover:bg-bg-soft cursor-pointer border-b" onClick={onToggle} aria-expanded={open}>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <button type="button" className="text-foreground font-bold" title={t.classNames.join(", ")}>
          <span aria-hidden="true" className="text-muted-foreground mr-1 text-xs">{open ? "▾" : "▸"}</span>
          {t.name}
        </button>
      </td>
      <td className="px-2 py-1.5 text-center whitespace-nowrap">
        <span className="inline-flex gap-1">
          {t.subjects.map((k) => (
            <Pill key={k} color={subjects.colorOf(k)}>
              {subjects.labelOf(k)}
            </Pill>
          ))}
        </span>
      </td>
      <td className="num px-2 py-1.5 text-center">{fmt(t.students.length)}</td>
      {t.months.map((m, i) => (
        <td key={i} className="px-2 py-1.5 text-center whitespace-nowrap" title={`담임 상담 ${m.self} · 담임 아닌 직원이 상담 ${m.other} · 미상담 ${m.none}`}>
          <span className="num text-foreground font-medium">
            {m.self}/{m.target}
          </span>
          <span className="num text-muted-foreground ml-1 text-xs">{rateText(pct(m.self, m.target))}</span>
        </td>
      ))}
      <td className="num text-foreground px-2 py-1.5 text-center font-medium">{rateText(averageRate(t))}</td>
      <td className="px-2 py-1.5 text-center">
        <span className={`num font-bold ${now.none > 0 ? "text-danger" : "text-muted-foreground"}`}>{fmt(now.none)}명</span>
      </td>
    </tr>
  );
}
