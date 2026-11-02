"use client";

import { useState } from "react";
import { Pill } from "@/components/atoms/pill";
import { ToolbarChip } from "@/components/toolbar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { HOMEROOM_CELL_META, type HomeroomCell, type HomeroomTeacher } from "@/features/consultations/homeroom-model";
import { bucketLabel } from "@/features/consultations/stats-model";
import { MonthGauge } from "./stats-homeroom-gauge";
import { HomeroomStudentGrid } from "./stats-homeroom-students";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const mLabel = (ym: string) => bucketLabel(`${ym}-01`, "month");
const LEGEND: HomeroomCell[] = ["self", "other", "none", "before"];

function Stat({ label, value, tone, title }: { label: string; value: string; tone?: "danger"; title?: string }) {
  return (
    <div className="bg-bg-soft rounded-xl px-3 py-2 text-center" title={title}>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`num text-lg font-bold ${tone === "danger" ? "text-danger" : ""}`}>{value}</p>
    </div>
  );
}

/**
 * 게이지 카드를 누르면 뜨는 담임 상세(원장 2026-11-02 *"게이지 영역 클릭하면 모달폼으로 디테일 게이지 학생 리스트 등"*) —
 * 기간 전체의 달별 계기판 + 숫자 요약 + 학생 × 달 표(표 보기의 펼친 표와 같은 부품).
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
  const [unmetOnly, setUnmetOnly] = useState(false);
  const last = months.length - 1;
  const now = t?.months[last];
  return (
    <Dialog
      open={t !== null}
      onOpenChange={(v) => {
        if (!v) {
          setUnmetOnly(false);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        {t && now ? (
          <>
            <div className="space-y-1 pr-8">
              <DialogTitle className="flex items-center gap-1.5">
                {t.name}
                {t.subjects.map((k) => (
                  <Pill key={k} color={subjects.colorOf(k)}>
                    {subjects.labelOf(k)}
                  </Pill>
                ))}
              </DialogTitle>
              <DialogDescription className="break-keep">
                담임 반 {t.classNames.length}개 · 담임 본인이 쓴 상담 기준 · {mLabel(months[0]!)}
                {last > 0 ? `~${mLabel(months[last]!)}` : ""}
              </DialogDescription>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
              {months.map((ym, i) => (
                <MonthGauge key={ym} ym={ym} m={t.months[i]!} current={i === last} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label={`${mLabel(prevMonth)} 학생`} value={`${fmt(t.prev.students)}명`} />
              <Stat label={`${mLabel(months[last]!)} 학생`} value={`${fmt(t.students.length)}명`} />
              <Stat
                label={`${mLabel(prevMonth)} 퇴원`}
                value={t.prev.withdrawn.length > 0 ? `${fmt(t.prev.withdrawn.length)}명` : "—"}
                title={t.prev.withdrawn.map((s) => s.name).join(", ")}
              />
              <Stat label="이번 달 미상담" value={`${fmt(now.none)}명`} tone={now.none > 0 ? "danger" : undefined} />
              <Stat label="담임 아닌 직원 상담" value={now.other > 0 ? `${fmt(now.other)}명` : "—"} />
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {LEGEND.map((c) => (
                    <span key={c} className="text-muted-foreground inline-flex items-center gap-1">
                      <span className={`inline-flex size-4 items-center justify-center rounded ${TONE_SOFT[HOMEROOM_CELL_META[c].tone]}`}>
                        {HOMEROOM_CELL_META[c].mark}
                      </span>
                      {HOMEROOM_CELL_META[c].label}
                    </span>
                  ))}
                </p>
                <ToolbarChip active={unmetOnly} onClick={() => setUnmetOnly((v) => !v)}>
                  이번 달 미상담 학생만
                </ToolbarChip>
              </div>
              <div className="overflow-x-auto">
                <HomeroomStudentGrid t={t} months={months} unmetOnly={unmetOnly} />
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
