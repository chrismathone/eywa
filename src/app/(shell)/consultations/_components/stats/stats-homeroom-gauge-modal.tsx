"use client";

import { Pill } from "@/components/atoms/pill";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useSubjectMaps } from "@/features/owner/operations-context";
import type { HomeroomTeacher } from "@/features/consultations/homeroom-model";
import { bucketLabel } from "@/features/consultations/stats-model";
import { MonthGauge } from "./stats-homeroom-gauge";
import { ModalStudentTable } from "./stats-homeroom-modal-students";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const mLabel = (ym: string) => bucketLabel(`${ym}-01`, "month");

function Stat({ label, value, sub, tone, title }: { label: string; value: string; sub?: string; tone?: "danger"; title?: string }) {
  return (
    <div className="bg-bg-soft flex flex-col justify-center rounded-xl px-3 py-2 text-center" title={title}>
      <p className="text-muted-foreground text-xs whitespace-nowrap">{label}</p>
      <p className={`num text-lg leading-tight font-bold ${tone === "danger" ? "text-danger" : ""}`}>{value}</p>
      {sub ? <p className="text-muted-foreground truncate text-xs">{sub}</p> : null}
    </div>
  );
}

/**
 * 게이지 카드를 누르면 뜨는 담임 상세(원장 2026-11-02 *"게이지 영역 클릭하면 모달폼으로 디테일 게이지 학생 리스트 등"*) —
 * 달별 계기판 + 숫자 요약 + 담임 반(칩) + 학생 × 달 표.
 */
export function HomeroomGaugeModal({
  t,
  months,
  prevMonth,
  onClose,
}: {
  t: HomeroomTeacher | null;
  months: string[];
  prevMonth: string;
  onClose: () => void;
}) {
  const subjects = useSubjectMaps();
  const last = months.length - 1;
  const now = t?.months[last];
  const withdrawn = t?.prev.withdrawn.map((s) => s.name) ?? [];
  return (
    <Dialog open={t !== null} onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent className="gap-4 p-5 sm:max-w-4xl">
        {t && now ? (
          <>
            <div className="space-y-1 pr-8">
              <DialogTitle className="flex items-center gap-2 text-base font-bold">
                {t.name}
                {t.subjects.map((k) => (
                  <Pill key={k} color={subjects.colorOf(k)}>
                    {subjects.labelOf(k)}
                  </Pill>
                ))}
              </DialogTitle>
              <DialogDescription className="break-keep">
                {mLabel(months[0]!)}
                {last > 0 ? `~${mLabel(months[last]!)}` : ""} · 담임 본인이 쓴 상담 기준 · 계기판 = 담임이 상담한 학생 ÷ 그 달 대상 학생
              </DialogDescription>
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="border-line flex flex-wrap items-end justify-around gap-2 rounded-2xl border p-3">
                {months.map((ym, i) => (
                  <div key={ym} className="w-36">
                    <MonthGauge ym={ym} m={t.months[i]!} current={i === last} />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3">
                <Stat label={`${mLabel(prevMonth)} 학생`} value={`${fmt(t.prev.students)}명`} />
                <Stat label={`${mLabel(months[last]!)} 학생`} value={`${fmt(t.students.length)}명`} />
                <Stat
                  label={`${mLabel(prevMonth)} 퇴원`}
                  value={withdrawn.length > 0 ? `${fmt(withdrawn.length)}명` : "—"}
                  sub={withdrawn.length > 0 ? withdrawn.join(", ") : undefined}
                  title={withdrawn.join(", ")}
                />
                <Stat label="이번 달 담임 상담" value={`${fmt(now.self)}명`} />
                <Stat label="이번 달 미상담" value={`${fmt(now.none)}명`} tone={now.none > 0 ? "danger" : undefined} />
                <Stat label="담임 아닌 직원 상담" value={now.other > 0 ? `${fmt(now.other)}명` : "—"} />
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-xs font-medium">담임 반 {t.classNames.length}개</p>
              <div className="flex flex-wrap gap-1.5">
                {t.classNames.map((c) => (
                  <span key={c} className="border-line rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap">
                    {c}
                  </span>
                ))}
              </div>
            </div>
            <ModalStudentTable t={t} months={months} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
