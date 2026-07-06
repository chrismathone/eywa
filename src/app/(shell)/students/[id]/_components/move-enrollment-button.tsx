"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { moveEnrollmentsBatch } from "@/features/enrollments/server/actions";
import type { AssignDialogClass, AssignDialogStudent } from "@/components/enrollment-assign-dialog";
import { kstToday } from "@/lib/date-kst";

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABEL: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};

/** "YYYY-MM-DD" + n일 (UTC 산술 — TZ 드리프트 없음). */
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * 반 이동 — 이 수강(옛 반)을 종료(전출)하고 대상 반에 등록(전입)한다. move_enrollments_batch RPC로
 * **옛 반 is_transferred=true(퇴원 아님·시간표에서 숨김) + 새 반 is_transferred_in=true(초록 배경)**를
 * 원자적으로 설정한다. 수강 배정+수강 종료 2단계와 달리 전출/전입이 올바로 기록된다.
 */
export function MoveEnrollmentButton({
  enrollmentId,
  student,
  currentClassName,
  classes,
}: {
  enrollmentId: string;
  student: AssignDialogStudent;
  currentClassName: string;
  classes: AssignDialogClass[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="다른 반으로 이동 (옛 반 전출 + 새 반 전입)"
        className="text-text-dim hover:text-blue hover:border-blue/30 hover:bg-blue/10 inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-1 text-xs whitespace-nowrap transition"
      >
        <ArrowRightLeft className="size-3" />
        반 이동
      </button>
      {open ? (
        <MoveDialog
          enrollmentId={enrollmentId}
          student={student}
          currentClassName={currentClassName}
          classes={classes}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function MoveDialog({
  enrollmentId,
  student,
  currentClassName,
  classes,
  onClose,
}: {
  enrollmentId: string;
  student: AssignDialogStudent;
  currentClassName: string;
  classes: AssignDialogClass[];
  onClose: () => void;
}) {
  const router = useRouter();
  const subjects = useSubjectMaps();
  const [targetId, setTargetId] = useState("");
  // 적용일 = 새 반 시작일(옛 반은 그 전날까지). 기본 = 내일(반이동은 보통 다음날 — 사용자 규약).
  const [eff, setEff] = useState(() => addDays(kstToday(), 1));
  const [attending, setAttending] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = classes.find((c) => c.id === targetId);
  const targetDays = target?.days ?? [];
  const orderedDays = DAY_ORDER.filter((d) => targetDays.includes(d));
  // 대상 반이 바뀌면 등원 요일 초기화(전 요일) — 렌더 중 prev 비교(effect-setState 룰 회피 #25).
  const [prevTarget, setPrevTarget] = useState(targetId);
  if (targetId !== prevTarget) {
    setPrevTarget(targetId);
    setAttending([]);
  }
  const toggleDay = (d: string) =>
    setAttending((prev) => {
      const next = prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d];
      return DAY_ORDER.filter((x) => next.includes(x));
    });

  const submit = async () => {
    if (!targetId) {
      setError("이동할 반을 선택하세요");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eff)) {
      setError("적용일을 선택하세요");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await moveEnrollmentsBatch(
        [{ enrollmentId, newClassId: targetId, attendanceDays: attending }],
        eff,
      );
      if (res.error) {
        setError(res.error);
        return;
      }
      const r0 = res.results?.[0];
      if (r0 && !r0.ok) {
        // GiST 시간겹침 등 — RPC의 sqlerrm을 친절히 감싼다.
        setError(
          /overlap|exclusion|23P01/i.test(r0.error ?? "")
            ? "대상 반과 수강 기간이 겹칩니다. 적용일이나 반을 확인해 주세요."
            : (r0.error ?? "이동에 실패했습니다"),
        );
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError("이동 결과를 확인하지 못했습니다(네트워크 오류 등). 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-border w-full max-w-md rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">반 이동</p>
            <h2 className="text-foreground mt-1 text-lg font-semibold">
              {student.name || "학생"}
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                {student.grade ?? ""}
              </span>
            </h2>
            <p className="text-muted-foreground text-xs">
              <span className="text-foreground font-medium">{currentClassName}</span> 에서 다른 반으로 이동합니다
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-foreground block text-sm font-medium">이동할 반</label>
            <SearchableSelect
              value={targetId}
              onValueChange={setTargetId}
              placeholder="반 선택..."
              searchPlaceholder="반 이름·강사 검색..."
              options={classes.map((c) => ({
                value: c.id,
                label: c.className,
                hint: `${subjects.labelOf(c.subject)}${c.scheduleLabel ? ` · ${c.scheduleLabel}` : ""}${c.teacherName ? ` · ${c.teacherName}` : ""} · ${c.studentCount}명`,
              }))}
            />
          </div>

          <div className="space-y-1">
            <label className="text-muted-foreground block text-[11px] font-medium">
              적용일 (이 날부터 새 반, 그 전날까지 옛 반)
            </label>
            <input
              type="date"
              value={eff}
              min={kstToday()}
              onChange={(e) => setEff(e.target.value)}
              className="border-border bg-card text-foreground num w-full rounded-md border px-2 py-1.5 text-sm"
            />
            <p className="text-muted-foreground text-[11px]">
              전출/전입으로 처리되어 옛 반엔 퇴원으로 뜨지 않고, 같은 날이어도 이름이 중복되지 않습니다.
            </p>
          </div>

          {orderedDays.length > 0 ? (
            <div className="space-y-1.5">
              <label className="text-foreground block text-sm font-medium">
                등원 요일
                <span className="text-muted-foreground ml-1 text-xs font-normal">
                  · 특정 요일만 등원하면 해제 (분리등원)
                </span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {orderedDays.map((d) => {
                  const on = attending.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(d)}
                      aria-pressed={on}
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {DAY_LABEL[d] ?? d}
                    </button>
                  );
                })}
              </div>
              <p className="text-muted-foreground text-[11px]">
                {attending.length === 0
                  ? "요일을 선택하지 않으면 전 요일 등원으로 저장됩니다."
                  : attending.length >= orderedDays.length
                    ? "전 요일 등원"
                    : `${attending.map((d) => DAY_LABEL[d] ?? d).join("·")}만 등원`}
              </p>
            </div>
          ) : null}

          {error ? <p className="text-danger text-sm">{error}</p> : null}

          <footer className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              취소
            </Button>
            <Button type="button" onClick={submit} disabled={busy || !targetId}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRightLeft className="size-4" />}
              반 이동
            </Button>
          </footer>
        </div>
      </div>
    </div>
  );
}
