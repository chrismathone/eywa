"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { loadSeatShareSheet, saveSeatShareAdjust, type SeatShareSheet } from "@/features/attendance/server/seat-share-actions";
import { parseSeatShareUnits, seatShareOnlyShrinks, seatShareOverPlan, seatShareSame, seatShareSummary, type SeatShareAdjust } from "@/features/attendance/seat-share-adjust";
import { formatSessionUnits } from "@/features/attendance/session-units";

/**
 * 회차 확정의 **자리 몫 줄**(원장 2026-10-07 *"JJ가 한달에 정해진 횟수를 19/5 이렇게 강제로 정한다기보다 20/4 등 유도리있게"* ·
 * *"어떤반의 수업/JJ 비율을 19/5를 20/4로 변경할 수 있으면 가장 편할거같은데 · LAB도 마찬가지겠고"* ·
 * *"반별로 한번에 설정도 가능하고, 반 내에서 개별적으로도 설정 가능하게"*).
 *
 * 자리(JJ실·랩실) 교시가 있는 영어 반의 묶음 맨 아래에 한 줄 서고, [몫 조정]을 누르면 그 달 시간표 기준 몫(선생님 · 자리)이 뜬다 —
 * 자리 몫에서 몇 시수를 선생님 몫으로 돌릴지 숫자로 적는다. 반 전체 값 하나 + 따로 정할 학생만 학생별 값.
 * 날짜는 고르지 않는다(*"굳이 어떤 날을 강제하지 않아도 되고"*). 출결은 그대로고 그 선생님의 등록 차수(= 실급여 상한)만 달라진다.
 *
 * 🔴 권한자 화면에만 선다(서버가 재료를 줄 때만). 저장 액션이 같은 문을 다시 본다(#77).
 * 🔴 줄은 **반마다 하나**다 — 학생마다 세우면 표가 두 배로 길어진다. 학생별 값은 창 안에서 적는다.
 * 🔴 저장은 **바꾼 선생님 전부를 한 번에** 보낸다 — 한 명씩 보내면 두 선생님 값을 맞바꿀 때 순서 때문에 거절되고, 뒤 사람만
 *    실패하면 앞 사람 값이 이미 저장돼 다시 눌러도 "바뀐 값 없음"에서 멈춘다(적대 리뷰 2026-10-07).
 *    거절되면 기준값을 다시 읽는다(그 사이 값이 달라졌을 수 있다) — 적어 둔 값은 그대로 남는다.
 * 🔴 초안(`drafts`)에는 **손댄 선생님만** 담는다 — 열 때 전원을 채워 두면, 거절 뒤 다시 읽은 기준값과 달라진 남의 값까지
 *    '바꾼 값'으로 세어 옛 값으로 되돌려 보낸다(적대 재리뷰 2026-10-07). 손대지 않은 칸은 늘 지금 기준값을 보인다.
 * ⚠️ 표는 창을 열 때 읽는다 — 회차 확정 첫 화면에 싣지 않는다(B7).
 */
type Draft = { units: string; students: Record<string, string> };
type Teacher = SeatShareSheet["teachers"][number];
const text = (units: number) => (units === 0 ? "" : formatSessionUnits(units));
const initial = (t: Teacher): Draft => ({
  units: text(t.units), students: Object.fromEntries(Object.entries(t.students).map(([id, units]) => [id, formatSessionUnits(units)])),
});

export function SeatShareRow({
  classId,
  className,
  period,
  adjusted,
}: {
  classId: string;
  className: string;
  period: string;
  /** 이미 돌린 값(선생님마다) — 한 줄 요약. */
  adjusted: readonly { teacherId: string; name: string; units: number; students: number }[];
}) {
  const [sheet, setSheet] = useState<SeatShareSheet | null>(null);
  const [error, setError] = useState("");
  const [loading, startLoading] = useTransition();
  const open = () => {
    setError("");
    startLoading(async () => {
      try {
        const result = await loadSeatShareSheet({ classId, period });
        if (result.ok) setSheet(result.sheet);
        else setError(result.error);
      } catch {
        setError("자리 몫을 불러오지 못했습니다. 다시 눌러 주세요.");
      }
    });
  };
  return (
    <tr className="border-border/60 border-t" data-seat-share-row>
      <td />
      <td colSpan={10} className="px-3 py-1.5">
        <div className="sticky left-3 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-foreground font-bold">└ 자리 몫(JJ실·랩실)</span>
          <span className="text-text-dim break-keep">
            {adjusted.length > 0
              ? `수업 몫으로 돌림 — ${adjusted.map((a) => `${a.name} ${seatShareSummary(a.units, a.students, formatSessionUnits)}`).join(" / ")}`
              : "시간표 몫 그대로"}
          </span>
          <button
            type="button"
            onClick={open}
            disabled={loading}
            className="border-line bg-card hover:bg-bg-soft rounded-md border px-2 py-0.5 text-xs font-bold disabled:opacity-50"
          >
            {loading ? "불러오는 중…" : "몫 조정"}
          </button>
          {error ? <span role="alert" className="text-danger break-keep">{error}</span> : null}
        </div>
        {sheet ? <SeatShareDialog className={className} opened={sheet} onClose={() => setSheet(null)} /> : null}
      </td>
    </tr>
  );
}

function SeatShareDialog({ className, opened, onClose }: { className: string; opened: SeatShareSheet; onClose: () => void }) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState("");
  // 기준값 — 저장이 거절되면 다시 읽어 갈아 끼운다(적어 둔 값 `drafts`는 그대로 둔다).
  const [sheet, setSheet] = useState(opened);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(opened.teachers.filter((t) => Object.keys(t.students).length > 0).map((t) => t.id)));
  const [, month] = sheet.period.split("-");
  const input = "border-input bg-card num w-16 rounded-md border px-2 py-1 text-right text-xs";
  const draftOf = (t: Teacher) => drafts[t.id] ?? initial(t);
  const edit = (t: Teacher, change: (draft: Draft) => Draft) => setDrafts((cur) => ({ ...cur, [t.id]: change(cur[t.id] ?? initial(t)) }));

  const known = new Set(sheet.students.map((s) => s.id));
  /**
   * 초안 → 저장할 값. 빈 칸 = 반 전체 0 · 학생은 '반 전체와 같음'(값 없음). 틀린 숫자가 하나라도 있으면 null.
   * 다시 읽은 재료에 없는 학생(그 사이 명단에서 빠졌고 남은 값도 없다)의 초안은 싣지 않는다 — 칸이 없어 고칠 수도 없는 값이다.
   */
  const valueOf = (t: Teacher): SeatShareAdjust | null => {
    const draft = draftOf(t);
    const units = draft.units.trim() === "" ? 0 : parseSeatShareUnits(draft.units);
    if (units === null) return null;
    const students: Record<string, number> = {};
    for (const [id, raw] of Object.entries(draft.students)) {
      if (raw.trim() === "" || !known.has(id)) continue;
      const own = parseSeatShareUnits(raw);
      if (own === null) return null;
      students[id] = own;
    }
    return { units, students };
  };
  const savedOf = (t: Teacher): SeatShareAdjust => ({ units: t.units, students: t.students });
  const changed = sheet.teachers.filter((t) => {
    const now = valueOf(t);
    return now === null || !seatShareSame(now, savedOf(t));
  });
  const invalid = sheet.teachers.some((t) => valueOf(t) === null);
  // 여러 선생님이 같은 자리 몫을 나눠 가진다 — 선생님마다 가장 큰 값의 합이 자리 몫을 넘으면 막는다(서버와 같은 식 · 지금보다 늘지 않으면 통과).
  const moved = sheet.teachers.reduce((sum, t) => sum + (valueOf(t)?.units ?? 0), 0);
  const over = seatShareOverPlan(sheet.seat, sheet.teachers.map(savedOf), sheet.teachers.map(valueOf));
  // 그 달 이 반 담당이 아니거나 수업 몫이 없는 선생님 — 남은 값을 줄이거나 지울 수만 있다(서버도 같은 판정). 몫이 없으면 돌려도 실리지 않는다.
  const shrinkOnly = (t: Teacher) => !t.assigned || !(t.planned > 0);
  const stuck = sheet.teachers.find((t) => {
    const now = valueOf(t);
    return shrinkOnly(t) && now !== null && !seatShareOnlyShrinks(savedOf(t), now);
  });

  function save() {
    setError("");
    startSaving(async () => {
      try {
        const teachers = changed.flatMap((t) => {
          const value = valueOf(t);
          return value ? [{ teacherId: t.id, ...value }] : [];
        });
        if (teachers.length !== changed.length) return;
        const result = await saveSeatShareAdjust({ classId: sheet.classId, period: sheet.period, teachers });
        if (result.ok) {
          toast.success(`${className} — ${Number(month)}월 자리 몫을 조정했습니다`);
          onClose();
          router.refresh();
          return;
        }
        const who = result.teacherId ? sheet.teachers.find((t) => t.id === result.teacherId)?.name : null;
        setError(`${who ? `${who} — ` : ""}${result.error ?? "저장하지 못했습니다. 다시 눌러 주세요."}`);
        // 거절된 사이 값이 달라졌을 수 있다(다른 사람의 저장 등) — 기준값을 다시 읽어 '바꾼 값'을 새로 센다.
        const again = await loadSeatShareSheet({ classId: sheet.classId, period: sheet.period });
        if (again.ok) setSheet(again.sheet);
        router.refresh();
      } catch {
        setError("저장하지 못했습니다. 다시 눌러 주세요.");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(value) => { if (!value && !saving) onClose(); }}>
      <DialogContent className="z-[90] max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogTitle>{className} · {Number(month)}월 수업 / 자리 몫</DialogTitle>
        <DialogDescription className="break-keep">
          시간표대로면 이 달 몫은 아래와 같습니다. 선생님이 자리(JJ실·랩실) 수업을 대신했다면 자리 몫에서 그만큼을 선생님 몫으로 돌리세요 —
          날짜는 고르지 않습니다. 출결은 그대로이고 그 선생님의 등록 차수(급여에 잡히는 상한)만 늘어납니다.
        </DialogDescription>
        <p className="text-sm break-keep">
          <span className="text-text-dim">시간표 기준 </span>
          {sheet.teachers.map((t) => `${t.name} ${formatSessionUnits(t.planned)}`).join(" · ")}
          {sheet.teachers.length > 0 ? " · " : ""}자리 <span className="num font-bold">{formatSessionUnits(sheet.seat)}</span>
        </p>
        {sheet.seat === 0 ? (
          <p role="note" className="text-text-dim text-sm break-keep">이 달 이 반에는 돌릴 자리 몫이 없습니다(자리 교시가 없거나 따로 운영하는 랩실입니다).</p>
        ) : null}
        {sheet.teachers.length === 0 ? (
          <p role="alert" className="text-danger text-sm break-keep">이 달 이 반을 맡은 선생님이 없어 조정할 수 없습니다.</p>
        ) : null}
        <div className="space-y-3">
          {sheet.teachers.map((t) => {
            const draft = draftOf(t);
            const value = valueOf(t);
            const isOpen = expanded.has(t.id);
            const take = Math.min(value?.units ?? 0, sheet.seat);
            // 그 달 명단에 없는 학생은 이 선생님 앞으로 남은 값이 있거나 적어 둔 값이 있을 때만 보인다(지울 수 있게).
            const students = sheet.students.filter((s) => !s.gone || Object.hasOwn(t.students, s.id) || (draft.students[s.id] ?? "").trim() !== "");
            return (
              <section key={t.id} className="border-line rounded-lg border px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-bold">{t.name}</span>
                  <label className="text-text-dim text-xs" htmlFor={`seat-share-${t.id}`}>반 전체</label>
                  <input id={`seat-share-${t.id}`} aria-label={`${t.name} 반 전체 시수`} className={input} inputMode="decimal" placeholder="0" disabled={saving}
                    value={draft.units} onChange={(e) => edit(t, (cur) => ({ ...cur, units: e.target.value }))} />
                  <span className="text-text-dim text-xs">시수</span>
                  <span className="text-text-dim text-xs break-keep">
                    → {t.name} <span className="num">{formatSessionUnits(t.planned + take)}</span> · 자리 <span className="num">{formatSessionUnits(Math.max(0, sheet.seat - moved))}</span>
                  </span>
                  <button type="button" className="text-text-dim hover:text-foreground ml-auto text-xs underline" aria-expanded={isOpen}
                    onClick={() => setExpanded((cur) => { const next = new Set(cur); if (next.has(t.id)) next.delete(t.id); else next.add(t.id); return next; })}>
                    {isOpen ? "학생별 접기" : "학생별로 따로"}
                  </button>
                </div>
                {shrinkOnly(t) ? (
                  <p role="note" className="text-text-dim mt-1 text-xs break-keep">
                    {t.assigned ? "이 달 이 반에서 수업 몫이 없어 돌려도 실리지 않습니다" : "이 달 이 반 담당이 아닙니다"} — 남은 값을 줄이거나 지울 수만 있습니다.
                  </p>
                ) : null}
                {isOpen ? (
                  <ul className="bg-bg-soft/50 mt-2 space-y-1 rounded-lg px-2 py-1.5">
                    {students.length === 0 ? <li className="text-text-dim text-xs">이 달 수강생이 없습니다.</li> : null}
                    {students.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate">
                          {s.name}
                          {s.gone ? <span className="text-text-dim"> · 이 달 명단에 없음(줄이거나 지울 수만 있습니다)</span> : null}
                        </span>
                        <span className="flex items-center gap-1">
                          <input aria-label={`${t.name} ${s.name} 시수`} className={input} inputMode="decimal" placeholder="반 전체" disabled={saving}
                            value={draft.students[s.id] ?? ""}
                            onChange={(e) => edit(t, (cur) => ({ ...cur, students: { ...cur.students, [s.id]: e.target.value } }))} />
                          <span className="text-text-dim">시수</span>
                        </span>
                      </li>
                    ))}
                    <li className="text-text-dim pt-1 break-keep">비워 두면 반 전체 값을 따릅니다. 이 학생만 빼려면 0을 적으세요.</li>
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>
        {invalid ? <p role="alert" className="text-danger mt-2 text-sm break-keep">시수는 0 이상 0.5 단위로 적어 주세요.</p> : null}
        {!invalid && over ? <p role="alert" className="text-danger mt-2 text-sm break-keep">자리 몫 {formatSessionUnits(sheet.seat)}시수보다 많이 돌릴 수 없습니다.</p> : null}
        {!invalid && stuck ? <p role="alert" className="text-danger mt-2 text-sm break-keep">{stuck.name} — 값을 늘릴 수 없습니다(줄이거나 지울 수만 있습니다).</p> : null}
        {error ? <p role="alert" className="text-danger mt-2 text-sm break-keep">{error}</p> : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          <span className="text-text-dim mr-auto text-xs">{changed.length > 0 ? "바꾼 값이 있습니다" : "바꾼 값 없음"}</span>
          <button type="button" disabled={saving} onClick={onClose} className="border-line rounded border px-3 py-1 text-sm">닫기</button>
          <button type="button" disabled={saving || invalid || over || !!stuck || changed.length === 0} onClick={save} className="bg-primary rounded px-3 py-1 text-sm text-white disabled:opacity-50">
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
