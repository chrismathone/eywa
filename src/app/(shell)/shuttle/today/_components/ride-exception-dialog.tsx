"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { SearchableSelect, type ComboOption } from "@/components/ui/searchable-select";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import { cn } from "@/lib/utils";
import { formatKoreanDate } from "@/lib/date-kst";
import {
  SHUTTLE_ACTION,
  SHUTTLE_CHIP,
  SHUTTLE_CHIP_OFF,
  SHUTTLE_CHIP_ON,
  SHUTTLE_INPUT,
  SHUTTLE_ROW,
  SHUTTLE_ROW_TEXT,
} from "@/features/shuttle/control-size";
import {
  DIRECTION_LABEL,
  RIDE_EXCEPTION_LABEL,
  runTitle,
  type Direction,
  type ShuttleRun,
  type ShuttleVehicle,
} from "@/features/shuttle/types";
import type { RideException } from "@/features/shuttle/roster";
import type { AssignableStudent } from "@/features/shuttle/server/students";
import { clearRideException, setRideException } from "@/features/shuttle/server/actions";

/**
 * 일회성 탑승 개입(0229a) — 원장 2026-08-20: *"오늘 연락이 와서 갑자기 탄다던지, 안타던지 하는
 * 일회성 셔틀 개입도 필요함."*
 *
 * 🔴 **여기서 바꾸는 건 '예정'이지 '기록'이 아니다.** 등하원 기록(탑승/미탑승)에 미리 찍어 해결하면
 *    안 탔는데 탄 걸로(또는 그 반대로) 남고 그 거짓이 출결 신호로 새어나간다 → 예정은 별도 축(0229a).
 *
 * 🔴 **'오늘 안 탐'을 거는 문은 2026-09-04에 닫았다**(원장 *"오늘 안탐 빼도될듯"*). 화면에서
 *    미탑승과 갈라 쓸 실익이 없다는 판단이다 — 출결 화면의 셔틀 신호를 같은 날 뺐으므로, 두
 *    기능이 만들어 내는 **눈에 보이는 차이가 사라졌다**(미탑승 하나로 끝난다).
 *    ⚠️ **해석·표시는 그대로 둔다**: 이미 걸린 `skip` 행이 있으면 명단에 회색으로 남고 아래
 *       '오늘의 변경'에서 되돌릴 수 있다(지금은 0건이지만, 남은 것을 못 지우게 만들지 않는다).
 *       되살리려면 이 파일의 라디오 두 칸만 되돌리면 된다 — roster/서버는 손대지 않았다.
 *
 * 📱 모바일 1순위 — 탭 타겟·입력 크기는 전부 [`control-size.ts`](@/features/shuttle/control-size).
 * ⚠️ 사유는 **선택**이다(원장 브리프: 필수로 만들면 급할 때 아무도 못 찍는다).
 */
export function RideExceptionDialog({
  date,
  today,
  canEdit,
  allRuns,
  vehicles,
  students,
  exceptions,
  onClose,
  onError,
  onDone,
}: {
  date: string;
  today: string;
  /** 0229a 적용 + 오늘 이후 날짜일 때만 편집 가능. 지난 날짜는 **읽기만**(그날의 기록이다). */
  canEdit: boolean;
  /**
   * 이 시즌의 **회차 전부**. 🔴 정류장 선택지는 여기서 만든다 — 그날 명단만으로 만들면
   * **오늘 아무도 안 타는 회차에는 학생을 못 넣는다**(토요일 회차에 "오늘만 태워 주세요"가
   * 정확히 그 경우다).
   */
  allRuns: ShuttleRun[];
  vehicles: ShuttleVehicle[];
  students: AssignableStudent[];
  exceptions: RideException[];
  onClose: () => void;
  onError: (msg: string | null) => void;
  onDone: () => void;
}) {
  const [busy, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const [memo, setMemo] = useState("");
  const [addStudentId, setAddStudentId] = useState("");
  const [addRunStopId, setAddRunStopId] = useState("");
  const [addIo, setAddIo] = useState<Direction | null>(null);

  const vehicleName = useMemo(() => new Map(vehicles.map((v) => [v.id, v.name])), [vehicles]);

  /** 노선 칸 → 사람이 읽는 자리 이름. 회차·시각까지 있어야 "어느 차 몇 시"가 서는다. */
  const stopOptions = useMemo<(ComboOption & { io: Direction })[]>(() => {
    const out: (ComboOption & { io: Direction })[] = [];
    for (const run of allRuns) {
      for (const stop of run.stops) {
        if (stop.kind !== "stop") continue; // 학원 출발·도착 칸엔 학생을 세우지 않는다(서버도 거절)
        out.push({
          value: stop.id,
          label: stop.stopName,
          hint: [vehicleName.get(run.vehicleId), runTitle(run), stop.atTime]
            .filter(Boolean)
            .join(" · "),
          io: run.direction,
        });
      }
    }
    return out;
  }, [allRuns, vehicleName]);


  const key = q.replace(/\s+/g, "").toLowerCase();
  const addShown = useMemo(() => {
    if (!key) return [];
    return students.filter((s) => s.searchKey.includes(key)).slice(0, 30);
  }, [students, key]);

  /** 오늘 걸린 변경 전부 — 원본은 예외 표다(줄에서 파생하면 명단 밖 예외가 안 보인다). */
  const entries = useMemo(() => {
    const stopLabel = new Map(stopOptions.map((o) => [o.value, [o.hint, o.label].filter(Boolean).join(" · ")]));
    return exceptions.map((e) => ({
      ...e,
      where: e.runStopId ? (stopLabel.get(e.runStopId) ?? "") : "",
    }));
  }, [exceptions, stopOptions]);

  function submit(action: () => Promise<{ error?: string } | undefined>, after?: () => void) {
    onError(null);
    startTransition(async () => {
      const res = await action();
      if (res?.error) onError(res.error);
      else {
        after?.();
        onDone();
      }
    });
  }


  function applyAdd() {
    const stop = stopOptions.find((o) => o.value === addRunStopId);
    if (!addStudentId || !stop) {
      // 어디서 타는지 모르면 기사가 못 태운다 — 서버도 같은 이유로 거절한다.
      onError("학생과 정류장을 모두 고르세요");
      return;
    }
    const fd = new FormData();
    fd.set("onDate", date);
    fd.set("studentId", addStudentId);
    fd.set("kind", "add");
    fd.set("ioKind", addIo ?? stop.io);
    fd.set("runStopId", addRunStopId);
    if (memo.trim()) fd.set("memo", memo.trim());
    submit(() => setRideException(fd), () => {
      setQ("");
      setMemo("");
      setAddStudentId("");
      setAddRunStopId("");
      setAddIo(null);
    });
  }

  function undo(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    submit(() => clearRideException(fd));
  }

  const addStudent = students.find((s) => s.id === addStudentId) ?? null;
  const past = date < today;

  return (
    // ⚠️ `position:fixed` 오버레이를 **flex로 센터링**한다(`-translate-x-1/2` 금지, [[#98]]).
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
      <div className="bg-card flex max-h-[88vh] w-full max-w-xl flex-col gap-3 rounded-2xl p-3 shadow-xl sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-foreground text-base font-bold">
            오늘만 승하차
            <span className="text-text-faint ml-1.5 text-xs font-normal">
              {formatKoreanDate(date)}
            </span>
          </h2>
          <Button variant="ghost" className={SHUTTLE_ACTION} onClick={onClose}>
            닫기
          </Button>
        </div>

        <p className="text-text-faint text-xs">
          평소 배정은 그대로 두고 <b className="font-bold">그날 하루만</b> 태우거나 뺍니다. 출결은 함께
          바뀌지 않습니다 — 결석 처리는 출석부에서 따로 합니다.
        </p>

        {!canEdit && (
          <p className="border-line text-text-dim rounded-xl border border-dashed px-3 py-2 text-xs">
            {past
              ? "지난 날짜라 읽기만 합니다 — 그날의 기록입니다."
              : "셔틀 오늘만 승하차 표가 아직 준비되지 않았습니다 — 마이그레이션 0229a를 적용하면 바로 쓸 수 있습니다."}
          </p>
        )}

        {canEdit && (
          <>

            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="재원생 이름·학교 검색"
              className={SHUTTLE_INPUT}
            />
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={300}
              placeholder="사유 (선택 — 비워도 됩니다)"
              className={SHUTTLE_INPUT}
            />

            {/* 🔴 '오늘 안 탐'을 없앤 뒤라 이 화면은 **'오늘만 탑승' 한 종류**뿐이다(머리 주석). */}
            <div className="flex flex-col gap-2">
                {!addStudent ? (
                  <ul className="flex max-h-40 min-h-0 flex-col gap-0.5 overflow-y-auto">
                    {addShown.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => setAddStudentId(s.id)}
                          className={cn(
                            "hover:bg-muted flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 text-left",
                            SHUTTLE_ROW,
                            SHUTTLE_ROW_TEXT,
                          )}
                        >
                          <span className="text-foreground font-medium">{s.name}</span>
                          <span className="text-text-faint text-xs">{s.schoolGrade}</span>
                        </button>
                      </li>
                    ))}
                    {addShown.length === 0 && (
                      <li className="text-text-faint px-1 py-2 text-xs">
                        {key ? "찾는 학생이 없습니다." : "이름이나 학교를 입력하세요."}
                      </li>
                    )}
                  </ul>
                ) : (
                  <div className="border-line flex flex-wrap items-center gap-2 rounded-xl border p-2">
                    <span className="text-foreground text-xs font-bold">{addStudent.name}</span>
                    <span className="text-text-faint text-xs">{addStudent.schoolGrade}</span>
                    <Button
                      variant="ghost"
                      className={cn(SHUTTLE_ACTION, SHUTTLE_ROW_TEXT, "ml-auto px-2")}
                      onClick={() => setAddStudentId("")}
                    >
                      다시 고르기
                    </Button>
                  </div>
                )}

                {/* 🔴 어디서 타는지가 없으면 기사가 못 태운다 — 정류장은 필수다. */}
                <SearchableSelect
                  options={stopOptions}
                  value={addRunStopId}
                  onValueChange={(v) => {
                    setAddRunStopId(v);
                    setAddIo(null); // 회차 성격을 기본값으로 다시 따르게 한다
                  }}
                  placeholder="어디서 타나요? (정류장·회차)"
                  searchPlaceholder="정류장·차·회차 검색"
                  ariaLabel="정류장"
                  triggerClassName={cn(SHUTTLE_INPUT, "w-full text-left")}
                />

                <div className="flex items-center gap-1.5" role="radiogroup" aria-label="승하차">
                  {(["in", "out"] as const).map((d) => {
                    const stop = stopOptions.find((o) => o.value === addRunStopId);
                    const on = (addIo ?? stop?.io ?? "in") === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setAddIo(d)}
                        className={cn(SHUTTLE_CHIP, on ? SHUTTLE_CHIP_ON : SHUTTLE_CHIP_OFF)}
                      >
                        {DIRECTION_LABEL[d]}
                      </button>
                    );
                  })}
                  <Button
                    className={cn(SHUTTLE_ACTION, "ml-auto")}
                    disabled={busy || !addStudentId || !addRunStopId}
                    onClick={applyAdd}
                  >
                    오늘만 태우기
                  </Button>
                </div>
              </div>
          </>
        )}

        {/* 오늘 걸린 변경 — 🔴 되돌리는 문을 잠그지 않는다([[#103]]). 지난 날짜는 목록만 보인다. */}
        <div className="border-line flex min-h-0 flex-col gap-1 rounded-xl border p-1.5">
          <span className="text-text-faint px-1 text-xs">
            이 날짜의 변경 <span className="num">{entries.length}</span>건
          </span>
          <ul className="flex max-h-40 min-h-0 flex-col gap-0.5 overflow-y-auto">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center gap-1.5 px-1 py-0.5">
                <Pill color={TONE_COLOR[e.kind === "add" ? "special" : "inert"]}>
                  {RIDE_EXCEPTION_LABEL[e.kind]}
                </Pill>
                <span className="text-foreground shrink-0 text-xs font-medium">{e.studentName}</span>
                <span className="text-text-faint min-w-0 flex-1 truncate text-xs">
                  {[DIRECTION_LABEL[e.ioKind], e.where, e.memo].filter(Boolean).join(" · ")}
                </span>
                {canEdit && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => undo(e.id)}
                    className={cn(SHUTTLE_ACTION, SHUTTLE_ROW_TEXT, "shrink-0 px-2")}
                  >
                    되돌리기
                  </Button>
                )}
              </li>
            ))}
            {entries.length === 0 && (
              <li className="text-text-faint px-1 py-2 text-xs">아직 변경이 없습니다.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
