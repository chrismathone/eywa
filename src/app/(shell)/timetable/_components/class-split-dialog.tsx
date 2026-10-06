"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/aywa-icon-compat";
import { durationLabel, SPLIT_DAY_KO, toMin, type SplitDay } from "@/features/class-splits/rules";
import { addDays, dowOf } from "@/features/class-splits/period";
import { createClassSplit, previewClassSplit, type SplitPreview } from "@/features/class-splits/server/actions";
import { SplitPeriodFields, type PeriodChoice } from "./class-split-period";
import { DropModeTabs } from "./drop-mode-tabs";

export type ClassSplitTarget = {
  studentId: string;
  name: string;
  fromClassId: string;
  fromClassName: string;
  toClassId: string;
  toClassName: string;
  /** 요일 칸에 놓았으면 그 요일(미리 선택). */
  dropDay?: string;
};

type Ready = Extract<SplitPreview, { ok: true }>;

/**
 * 드롭 팝업의 **'수업 나누기'** 쪽(원장 2026-10-06) — 원래 반은 그대로, 고른 요일·시간만 받는 반에서 수업한다.
 * 고르는 것 = 요일 · 시작 시각 · 길이(과목 단위: 수학 1시간 · EiE 40분) · 기간(일별·월별·영구).
 * 🔴 선택지는 서버가 두 반의 그 주 배치로 만든다(`previewClassSplit`) — 저장도 같은 재료로 다시 검증한다.
 * 🔴 경고(정원·다른 수업과 겹침·이미 수강생)는 막지 않는다: 목록을 보여 주고 '그래도 나누기'를 누르면 저장한다.
 */
export function ClassSplitDialog({
  target,
  weekMonday,
  onCancel,
  onSwitchToMove,
}: {
  target: ClassSplitTarget;
  weekMonday: string;
  onCancel: () => void;
  onSwitchToMove: () => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<SplitPreview | null>(null);
  const [days, setDays] = useState<Set<SplitDay>>(new Set());
  const [start, setStart] = useState("");
  const [units, setUnits] = useState(1);
  const [period, setPeriod] = useState<PeriodChoice | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, run] = useTransition();
  const req = useMemo(
    () => ({ studentId: target.studentId, sourceClassId: target.fromClassId, targetClassId: target.toClassId, refDate: weekMonday }),
    [target, weekMonday],
  );

  useEffect(() => {
    let alive = true;
    previewClassSplit(req).then((p) => {
      if (!alive) return;
      setPreview(p);
      if (!p.ok) return;
      // 기본 요일 = 놓은 요일(있고 나눌 수 있으면) / 아니면 학생이 오는 요일 전부.
      const avail = p.days.map((d) => d.day).filter((d) => p.attendanceDays.length === 0 || p.attendanceDays.includes(d));
      const pick = target.dropDay && avail.includes(target.dropDay as SplitDay) ? [target.dropDay as SplitDay] : avail;
      setDays(new Set(pick));
      setStart(p.days.find((d) => d.day === pick[0])?.starts[0]?.time ?? "");
      // 기본 기간 = 일별 · 그 요일의 가장 가까운 날(오늘 포함).
      let date = p.today;
      for (let i = 0; i < 7 && pick[0] && dowOf(date) !== pick[0]; i++) date = addDays(date, 1);
      setPeriod({ kind: "day", date });
    });
    return () => {
      alive = false;
    };
  }, [req, target.dropDay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const ready = preview?.ok ? (preview as Ready) : null;
  // 일별이면 요일은 날짜가 정한다. 그 외엔 고른 요일들에 **공통인** 시작 시각만 고를 수 있다.
  const activeDays: SplitDay[] =
    period?.kind === "day" ? ([dowOf(period.date)].filter(Boolean) as SplitDay[]) : [...days];
  const dayRows = ready ? ready.days.filter((d) => activeDays.includes(d.day)) : [];
  const commonStarts = dayRows.length
    ? dayRows[0]!.starts.filter((s) => dayRows.every((r) => r.starts.some((x) => x.time === s.time)))
    : [];
  // 시작을 못 골랐으면 길이 선택지도 없다(빈 배열의 min은 Infinity라 거짓 선택지가 선다).
  // 길이 선택지 = 고른 요일 전부에서 **끝 시각이 같은** 칸 수만(끝은 교시 경계 — 수학 55분 교시라 분으로 더하지 않는다).
  const endsOf = (r: (typeof dayRows)[number]) => r.starts.find((x) => x.time === start)?.ends ?? [];
  const firstEnds = dayRows.length ? endsOf(dayRows[0]!) : [];
  let maxUnits = 0;
  while (maxUnits < firstEnds.length && dayRows.every((r) => endsOf(r)[maxUnits] === firstEnds[maxUnits])) maxUnits++;
  const startOk = commonStarts.some((s) => s.time === start);
  const canSave = !!ready && !!period && activeDays.length > 0 && startOk && units >= 1 && units <= maxUnits;

  function save(confirm: boolean) {
    if (!ready || !period || !canSave) return;
    setError(null);
    run(async () => {
      const res = await createClassSplit({ ...req, days: activeDays, start, units, period, confirm });
      if (res.ok) {
        toast.success(`수업 나누기 — ${res.summary}`);
        router.refresh();
        onCancel();
      } else if ("needsConfirm" in res) setWarnings(res.warnings);
      else setError(res.error);
    });
  }

  const end = startOk ? (firstEnds[units - 1] ?? "") : "";
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="bg-card border-line w-[360px] max-w-full rounded-xl border p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="수업 나누기"
      >
        <DropModeTabs mode="split" onMove={onSwitchToMove} />
        <p className="text-foreground mt-3 text-sm font-bold">
          <span className="text-text-dim font-normal">{target.name} · </span>수업 나누기
        </p>
        <p className="text-text-faint mt-1 text-xs">
          <b className="text-text-dim">{target.fromClassName}</b>은 그대로 두고, 고른 시간만{" "}
          <b className="text-text-dim">{target.toClassName}</b>
          {ready?.target.teacherName ? ` (${ready.target.teacherName})` : ""}에서 수업합니다.
        </p>
        {!preview ? (
          <p className="text-text-dim mt-4 flex items-center gap-2 text-sm">
            <Loader2 size={14} className="animate-spin" /> 두 반 시간을 확인하는 중…
          </p>
        ) : !preview.ok ? (
          <p className="text-danger mt-4 text-sm">{preview.error}</p>
        ) : warnings ? (
          <div className="mt-3">
            <p className="text-amber text-sm font-bold">확인이 필요합니다</p>
            <ul className="text-foreground mt-1 list-disc space-y-1 pl-5 text-sm">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-3 space-y-3 text-sm">
            <SplitPeriodFields value={period} onChange={setPeriod} today={ready!.today} />
            {period?.kind !== "day" ? (
              <Row label="요일">
                {ready!.days.map((d) => {
                  const off = ready!.attendanceDays.length > 0 && !ready!.attendanceDays.includes(d.day);
                  const on = days.has(d.day);
                  return (
                    <Chip key={d.day} on={on} disabled={off} title={off ? "원래 반에 오지 않는 요일" : undefined}
                      onClick={() => setDays((prev) => {
                        const next = new Set(prev);
                        if (on) next.delete(d.day);
                        else next.add(d.day);
                        return next;
                      })}
                    >
                      {SPLIT_DAY_KO[d.day]}
                    </Chip>
                  );
                })}
              </Row>
            ) : null}
            <Row label="시작">
              {commonStarts.length === 0 ? (
                <span className="text-text-faint text-xs">고른 요일에 같이 도는 시간이 없습니다.</span>
              ) : (
                commonStarts.map((s) => (
                  <Chip key={s.time} on={s.time === start} onClick={() => { setStart(s.time); setUnits(1); }}>
                    <span className="num">{s.time}</span>
                  </Chip>
                ))
              )}
            </Row>
            <Row label="길이">
              {Array.from({ length: Math.max(0, Math.min(maxUnits, 6)) }, (_, i) => i + 1).map((n) => (
                <Chip key={n} on={n === units} onClick={() => setUnits(n)}>
                  {durationLabel(toMin(firstEnds[n - 1] ?? start) - toMin(start))}
                </Chip>
              ))}
            </Row>
            {startOk ? (
              <p className="text-text-dim text-xs">
                {activeDays.map((d) => SPLIT_DAY_KO[d]).join("·")} <span className="num">{start}~{end}</span> — 이 시간 출결은{" "}
                <b>{target.toClassName}</b> 몫, 수강료·수업보고서는 <b>{target.fromClassName}</b> 그대로입니다.
              </p>
            ) : null}
          </div>
        )}
        {error ? <p className="text-danger mt-2 text-xs">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={warnings ? () => setWarnings(null) : onCancel}
            className="border-line text-text-dim hover:bg-bg-soft rounded-lg border px-3 py-1.5 text-xs font-medium transition">
            {warnings ? "돌아가기" : "취소"}
          </button>
          <button type="button" onClick={() => save(!!warnings)} disabled={!canSave || busy}
            className="bg-primary text-primary-foreground hover:bg-primary/85 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50">
            {busy ? "저장 중…" : warnings ? "그래도 나누기" : "나누기"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-text-dim w-9 shrink-0 pt-1 text-xs">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

export function Chip({ on, disabled, title, onClick, children }: {
  on: boolean; disabled?: boolean; title?: string; onClick: () => void; children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-pressed={on}
      className={`h-8 rounded-md border px-2.5 text-xs font-medium transition disabled:opacity-35 ${
        on ? "border-primary bg-primary text-primary-foreground" : "border-line text-text-dim hover:bg-bg-soft"
      }`}>
      {children}
    </button>
  );
}
