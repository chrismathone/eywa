"use client";

import { Fragment, useState } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { HOMEROOM_CELL_META, type HomeroomCell, type HomeroomStats, type HomeroomTeacher } from "@/features/consultations/homeroom-model";
import { bucketLabel, pct } from "@/features/consultations/stats-model";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const mLabel = (ym: string) => bucketLabel(`${ym}-01`, "month");
const LEGEND: HomeroomCell[] = ["self", "other", "none", "before"];

/**
 * 담임별 상담 현황(homeroom-model.ts) — 담임 한 줄 = 달별 '담임이 상담한 학생 / 대상 학생'. 줄을 누르면 그 담임의 학생 × 달 표가 펼쳐진다
 * (이번 달 미상담이 맨 위). 강사는 본인 한 줄이라 처음부터 펼친다.
 */
export function StatsHomeroom({ data, teacherScoped }: { data: HomeroomStats | null; teacherScoped: boolean }) {
  const [open, setOpen] = useState<string | null>(teacherScoped && data?.teachers.length === 1 ? data.teachers[0]!.id : null);
  const card = "border-line col-span-full space-y-3 rounded-2xl border p-3";
  if (!data) {
    return <p className={`${card} text-muted-foreground text-sm`}>담임별 상담 현황을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>;
  }
  const { months, teachers, retired } = data;
  const last = months.length - 1;
  return (
    <div className={card}>
      <div className="space-y-0.5">
        <p className="text-foreground text-sm font-bold">담임별 상담 현황</p>
        <p className="text-muted-foreground text-xs break-keep">
          지금 담임 반 재원생 · {mLabel(months[0]!)}~{mLabel(months[last]!)} · 담임 본인이 쓴 상담 기준 · 부담임·특강 반 제외 · 위 필터와 무관
          {retired.teachers > 0 ? ` · 퇴사한 담임 ${retired.teachers}명의 반 ${retired.classes}개(학생 ${fmt(retired.students)}명) 제외` : ""}
        </p>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {LEGEND.map((c) => (
            <span key={c} className="text-muted-foreground inline-flex items-center gap-1">
              <span className={`inline-flex size-4 items-center justify-center rounded ${TONE_SOFT[HOMEROOM_CELL_META[c].tone]}`}>{HOMEROOM_CELL_META[c].mark}</span>
              {HOMEROOM_CELL_META[c].label}
            </span>
          ))}
        </p>
      </div>
      {teachers.length === 0 ? (
        <p className="text-muted-foreground py-3 text-center text-sm">{teacherScoped ? "담임을 맡은 반이 없습니다" : "담임 반이 없습니다"}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-line text-muted-foreground border-b text-xs">
                <th className="px-2 py-1.5 text-center font-medium">담임</th>
                <th className="px-2 py-1.5 text-center font-medium">학생</th>
                {months.map((m) => (
                  <th key={m} className="px-2 py-1.5 text-center font-medium whitespace-nowrap">
                    {mLabel(m)}
                    {m === months[last] ? <span className="ml-0.5">(진행 중)</span> : null}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-center font-medium whitespace-nowrap">이번 달 미상담</th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => (
                <Fragment key={t.id}>
                  <TeacherRow t={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
                  {open === t.id ? (
                    <tr>
                      <td colSpan={months.length + 3} className="bg-bg-soft/40 p-2">
                        <StudentGrid t={t} months={months} />
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
        칸 = 담임이 상담한 학생 / 그 달 대상 학생(반에 들어오기 전 달은 빼고 센다). 담임은 지금 기준이라 담임이 바뀐 반은 지난 달도 지금 담임 앞으로 보인다.
      </p>
    </div>
  );
}

function TeacherRow({ t, open, onToggle }: { t: HomeroomTeacher; open: boolean; onToggle: () => void }) {
  const now = t.months[t.months.length - 1]!;
  return (
    <tr className="border-line hover:bg-bg-soft cursor-pointer border-b" onClick={onToggle} aria-expanded={open}>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <button type="button" className="text-foreground font-bold" title={t.classNames.join(", ")}>
          <span aria-hidden="true" className="text-muted-foreground mr-1 text-xs">{open ? "▾" : "▸"}</span>
          {t.name}
        </button>
      </td>
      <td className="num px-2 py-1.5 text-center">{fmt(t.students.length)}</td>
      {t.months.map((m, i) => {
        const rate = pct(m.self, m.target);
        return (
          <td key={i} className="px-2 py-1.5 text-center whitespace-nowrap" title={`담임 상담 ${m.self} · 다른 직원만 ${m.other} · 미상담 ${m.none}`}>
            <span className="num text-foreground font-medium">
              {m.self}/{m.target}
            </span>
            <span className="num text-muted-foreground ml-1 text-xs">{rate === null ? "—" : `${Math.round(rate)}%`}</span>
          </td>
        );
      })}
      <td className="px-2 py-1.5 text-center">
        <span className={`num font-bold ${now.none > 0 ? "text-danger" : "text-muted-foreground"}`}>{fmt(now.none)}명</span>
      </td>
    </tr>
  );
}

function StudentGrid({ t, months }: { t: HomeroomTeacher; months: string[] }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs break-keep">담임 반: {t.classNames.join(" · ")}</p>
      <table className="border-collapse text-sm">
        <thead>
          <tr className="text-muted-foreground text-xs">
            <th className="px-2 py-1 text-center font-medium">학생</th>
            {months.map((m) => (
              <th key={m} className="w-14 px-1 py-1 text-center font-medium">{mLabel(m)}</th>
            ))}
            <th className="px-2 py-1 text-center font-medium whitespace-nowrap">마지막 담임 상담</th>
          </tr>
        </thead>
        <tbody>
          {t.students.map((s) => (
            <tr key={s.id} className="border-line border-t">
              <td className="px-2 py-1 whitespace-nowrap">
                <WindowLink href={`/students/${s.id}`} className="text-foreground font-medium hover:underline">
                  {s.name}
                </WindowLink>
                {s.grade ? <span className="text-muted-foreground ml-1 text-xs">{s.grade}</span> : null}
              </td>
              {s.cells.map((c, i) => {
                const meta = HOMEROOM_CELL_META[c];
                const n = s.selfCounts[i]!;
                return (
                  <td key={i} className="px-1 py-1 text-center">
                    <span title={`${mLabel(months[i]!)} · ${meta.label}${n > 1 ? ` ${n}건` : ""}`} className={`inline-flex h-6 min-w-8 items-center justify-center rounded px-1 text-xs ${TONE_SOFT[meta.tone]}`}>
                      {meta.mark}
                      {n > 1 ? <span className="num ml-0.5">{n}</span> : null}
                    </span>
                  </td>
                );
              })}
              <td className="num text-muted-foreground px-2 py-1 text-center text-xs">{s.lastSelf ? `${Number(s.lastSelf.slice(5, 7))}/${Number(s.lastSelf.slice(8, 10))}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
