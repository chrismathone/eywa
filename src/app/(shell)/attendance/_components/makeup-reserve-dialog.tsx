"use client";

/**
 * 보강 예약 창(원장 2026-09-14) — 출석부 칸 우클릭 → '보강 예약'. 결석일은 연 칸의 날짜, 보강일·교시·메모를 고른다.
 *
 * 🔴 교시는 **서버가 준 선택지**(학원설정 교시표 — 평일은 그 반 과목 표, 주말은 주말 표)에서만 고른다(원장 *"수기
 *    금지"*). 시각 입력칸은 없고, 날짜를 바꾸면 그 날짜의 표를 다시 묻는다(`getMakeupPeriodOptions`).
 * 🔴 저장은 `reserveMakeup` 하나 — 결석일 칸 처리(결석 0·메모)까지 서버가 한 번에 한다.
 * ⚠️ 선택지 조회는 **이벤트에서만**(effect setState 금지, [[#25]]) — 열 때는 보강일이 비어 있어 묻지 않는다.
 */
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatKoreanDate, kstToday } from "@/lib/date-kst";
import {
  getMakeupPeriodOptions,
  reserveMakeup,
} from "@/features/attendance/server/makeup-reservation-actions";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  contiguousPeriodRange,
  togglePeriodSelection,
  validateReservationDates,
  type MakeupReportMode,
  type ReservationHost,
  type ReservationPeriodOption,
} from "@/features/attendance/makeup-reservation";
import { formatSessionUnits } from "@/features/attendance/session-units";
import { unitsFromMinutes } from "@/features/attendance/auto-units";

/** 자주 적는 메모 — 문장은 그대로 메모가 되므로 고칠 수 있게 둔다(결석 접수 창과 같은 문법). */
const QUICK_NOTES = ["학부모 요청", "시험 기간", "개인 사정", "병결 보강"];

export function MakeupReserveDialog({
  studentId,
  studentName,
  classId,
  className,
  absenceDate,
  scopeTeacherId,
  onClose,
  onReserved,
}: {
  studentId: string;
  studentName: string;
  classId: string;
  className: string;
  /** 결석한(할) 날 = 팝오버를 연 칸의 날짜. */
  absenceDate: string;
  /** 강사 전체 보기의 주인 — 결석 칸 쓰기에 그대로 실린다. */
  scopeTeacherId?: string | null;
  onClose: () => void;
  /** 저장 성공 — 호출부가 화면을 새로 고친다(예약 칸·명단은 서버 값이다). */
  onReserved?: () => void;
}) {
  const router = useRouter();
  const today = kstToday();
  const [makeupDate, setMakeupDate] = useState("");
  const [options, setOptions] = useState<ReservationPeriodOption[]>([]);
  const [optionNote, setOptionNote] = useState<string | null>(null);
  // 이어진 교시 여러 개(원장 2026-09-14) — 토글 규칙은 순수부 `togglePeriodSelection`(양 끝 빼기·옆으로 늘리기).
  const [periodIds, setPeriodIds] = useState<string[]>([]);
  const [autoUnitsSubject, setAutoUnitsSubject] = useState(false);
  const [note, setNote] = useState("");
  /**
   * 보강일이 이 학생의 정규 수업일인가(서버 판정 — 이행의 시수 합침과 같은 조건). undefined = 아직 모름(날짜 전).
   * true·null(확인 못 함)이면 '+ 보강 학생 추가'와 같은 합침/분리를 묻는다(원장 2026-10-22). 기본은 합침 — 보강 추가 확인창과 같다.
   */
  const [regularDay, setRegularDay] = useState<boolean | null | undefined>(undefined);
  const [reportMode, setReportMode] = useState<MakeupReportMode>("merge");
  /**
   * **기록할 반**(원장 2026-10-22 *"보강 예약에도 기록할 반 고르기를 넣자"*) — '+ 보강 학생 추가'와 같은 후보(서버 판정): 보강일에 학생이 다니는
   * 열린 같은 과목 반. null 목록 = 아직 날짜 전. 고른 반이 결석난 반과 다르면 결석 칸은 결석난 반에, 예약은 고른 반에 선다.
   */
  const [hosts, setHosts] = useState<ReservationHost[] | null>(null);
  const [hostClassId, setHostClassId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 늦게 온 옛 응답이 최신 선택지를 덮지 않게(날짜를 빠르게 바꿀 때).
  const seq = useRef(0);

  function changeDate(value: string) {
    setMakeupDate(value);
    setPeriodIds([]);
    setOptions([]);
    setOptionNote(null);
    setRegularDay(undefined);
    setHosts(null);
    setError(null);
    const check = validateReservationDates({ absenceDate, makeupDate: value, today });
    if (!check.ok) {
      // 빈 값은 "아직 안 골랐다"라 조용히, 그 밖의 사유는 그 자리에서 알린다(저장 눌러야 알면 늦다).
      if (value) setError(check.error);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    void getMakeupPeriodOptions(classId, value, studentId, hostClassId)
      .then((r) => {
        if (mine !== seq.current) return;
        if ("error" in r) {
          setOptionNote(r.error);
          return;
        }
        setOptions(r.options);
        setAutoUnitsSubject(r.autoUnits);
        setRegularDay(r.regularDay);
        setHosts(r.hostChoices ?? null);
        setHostClassId(r.hostClassId ?? null);
        if (r.options.length === 0) setOptionNote("이 날짜에 쓸 교시표가 비어 있습니다 — 학원설정의 교시를 확인하세요");
        else setOptionNote(`${r.weekend ? "주말" : "평일"} 교시표 · ${r.subjectLabel} · 이어진 교시는 여러 개 고를 수 있습니다`);
      })
      .catch(() => {
        if (mine !== seq.current) return;
        setOptionNote("교시를 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요");
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }

  /** 기록할 반을 바꾼다 — 그 반의 정규 수업일인지(합침/분리를 물을지)만 다시 묻는다(교시표는 같은 과목이라 그대로). */
  function changeHost(value: string) {
    setHostClassId(value);
    setRegularDay(undefined);
    setError(null);
    if (!makeupDate) return;
    const mine = ++seq.current;
    setLoading(true);
    void getMakeupPeriodOptions(classId, makeupDate, studentId, value)
      .then((r) => {
        if (mine !== seq.current) return;
        if ("error" in r) {
          setError(r.error);
          return;
        }
        setRegularDay(r.regularDay);
      })
      .catch(() => {
        if (mine === seq.current) setError("반을 확인하지 못했습니다 — 잠시 후 다시 시도해 주세요");
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }
  const host = hosts?.find((h) => h.classId === hostClassId) ?? null;
  // 후보를 받은 뒤에는 반을 골라야 저장된다(후보가 없으면 예약할 반이 없다). 후보를 못 받은 화면은 종전대로 결석난 반.
  const hostMissing = hosts !== null && !host;
  const hostName = host?.className ?? className;

  // 선택 구간(순수부와 같은 판정) — 없으면 저장 잠금. 시수 예고는 수학 자동 시수와 같은 식(교시 하나 0.5).
  const range = contiguousPeriodRange(options, periodIds, makeupDate);
  const previewUnits = range && autoUnitsSubject ? (unitsFromMinutes(range.minutes) ?? 1) : null;
  const blocked = !makeupDate || !range || saving || loading || !!error || hostMissing;
  // 합침/분리를 묻는 날 = 정규 수업일(또는 확인 못 함). 정규 수업이 없는 날은 합칠 보고서가 없다(보강 보고서 따로).
  const asksReport = !!makeupDate && regularDay !== undefined && regularDay !== false;

  async function save() {
    if (blocked || !range) return;
    setSaving(true);
    setError(null);
    const res = await reserveMakeup({
      studentId,
      classId,
      absenceDate,
      makeupDate,
      periodIds: range.ids,
      note,
      scopeTeacherId: scopeTeacherId ?? null,
      ...(asksReport ? { reportMode } : {}),
      ...(host ? { hostClassId: host.classId } : {}),
    });
    setSaving(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    toast.success(
      `${studentName} 보강 예약 — ${res.span}${
        res.absence === "created" ? ` · ${absenceDate.slice(5)} 결석(0)으로 찍음` : " · 결석 칸에 메모"
      }`,
    );
    onReserved?.();
    router.refresh();
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      // 🔴 React 이벤트는 포털을 지나 **연 칸(AttendanceCell)** 으로 버블한다 — 막지 않으면 창 안 클릭이 칸 선택·
      //    팝오버 열기·격자 키 처리로 새어 창이 열린 채 격자가 움직인다. 여기서 끊는다.
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      role="presentation"
    >
      <div
        className="bg-background border-line max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label="보강 예약"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <h2 className="text-foreground text-sm font-bold">보강 예약</h2>
        <p className="text-text-dim mt-1 text-xs leading-relaxed break-keep">
          <span className="text-foreground font-bold">{studentName}</span> · {className} ·{" "}
          <span className="num">{formatKoreanDate(absenceDate)}</span> 결석분. 저장하면 결석일 칸은 결석(0)과 메모
          &quot;보강 예정&quot;이 남고, 보강일 출석부·시간표·원스크린에 이 학생이 미리 섭니다.
        </p>

        {/* ① 보강일 */}
        <div className="mt-4">
          <label className="text-text-dim text-xs font-bold" htmlFor="reserve-date">
            보강일
          </label>
          <input
            id="reserve-date"
            type="date"
            autoFocus
            value={makeupDate}
            min={today}
            onChange={(e) => changeDate(e.target.value)}
            className="border-line bg-bg-soft focus:border-primary mt-1 h-9 w-full rounded-lg border px-2 text-sm outline-none"
          />
        </div>

        {/* ①-2 기록할 반 — '+ 보강 학생 추가'의 수업 선택과 같은 후보 · 드롭다운 하나(원장 2026-09-21 *"드랍다운으로 처리해 나열하지말고"*) ·
            하나뿐이면 값만 적는다. */}
        {makeupDate && hosts !== null ? (
          <div className="mt-3">
            <p className="text-text-dim text-xs font-bold">기록할 반</p>
            {hosts.length === 0 ? (
              <p className="text-danger mt-1 text-xs leading-relaxed break-keep">
                그날 이 학생이 다니는 같은 과목 반이 없어 예약할 수 없습니다 — 보강일을 바꾸거나, 반 배정을 먼저 확인해 주세요.
              </p>
            ) : hosts.length === 1 ? (
              <p className="text-foreground mt-1 text-sm font-bold">{hosts[0]!.className}</p>
            ) : (
              <div className="mt-1">
                <SearchableSelect
                  options={hosts.map((h) => ({ value: h.classId, label: h.className, ...(h.absenceClass ? { hint: "결석난 반" } : {}) }))}
                  value={hostClassId ?? ""}
                  onValueChange={changeHost}
                  ariaLabel="기록할 반"
                  placeholder="반을 고르세요"
                  searchPlaceholder="반 이름 검색"
                  triggerClassName="border-line bg-bg-soft text-foreground h-9 w-full rounded-lg border px-2 text-sm"
                />
              </div>
            )}
            {host && !host.absenceClass ? (
              <p className="text-text-dim mt-1.5 text-xs leading-relaxed break-keep">
                결석은 {className} <span className="num">{absenceDate.slice(5).replace("-", "/")}</span> 칸에 남고, 보강은{" "}
                <span className="text-foreground font-bold">{host.className}</span> 출석부·원스크린에 섭니다.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* ② 교시 — 설정 교시표에서만 */}
        <div className="mt-3">
          <p className="text-text-dim text-xs font-bold">
            교시 {loading ? <span className="font-normal">확인 중…</span> : null}
          </p>
          {optionNote ? <p className="text-text-faint mt-1 text-xs">{optionNote}</p> : null}
          {!makeupDate ? (
            <p className="text-text-faint mt-1 text-xs">보강일을 먼저 고르세요 — 그 날의 운영 교시가 나옵니다.</p>
          ) : options.length > 0 ? (
            <div className="border-line mt-1 grid max-h-52 grid-cols-2 gap-1 overflow-y-auto rounded-lg border p-1.5">
              {options.map((o) => {
                const on = periodIds.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      setPeriodIds((cur) => togglePeriodSelection(options, cur, o.id));
                      setError(null);
                    }}
                    aria-pressed={on}
                    className={`num rounded-md px-2 py-1.5 text-left text-xs transition ${
                      on ? "bg-purple text-white font-bold" : "hover:bg-bg-soft text-foreground"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          ) : null}
          {range ? (
            <p className="text-text-dim mt-1.5 text-xs break-keep">
              <span className="text-foreground num font-bold">
                {range.label ? `${range.label} · ` : ""}
                {range.startTime}~{range.endTime}
              </span>
              {range.count > 1 ? ` · 교시 ${range.count}개` : ""}
              {previewUnits !== null
                ? ` · 보강일에 출결을 찍으면 시수 ${formatSessionUnits(previewUnits)}(교시 하나 0.5)`
                : ""}
            </p>
          ) : null}
        </div>

        {/* ③ 보고서 — '+ 보강 학생 추가' 확인창의 합침/분리와 같은 질문·같은 말(원장 2026-10-22 *"보고서를 함께 발송할지 따로
            발송할지 코드를 맞출것"*). 정규 수업일에만 묻는다. */}
        {makeupDate && regularDay === false ? (
          <p className="text-text-dim mt-3 text-xs leading-relaxed break-keep">
            그날은 이 학생의 {hostName} 정규 수업이 없어 보강 보고서가 따로 나갑니다.
          </p>
        ) : null}
        {asksReport ? (
          <div className="mt-3">
            <p className="text-text-dim text-xs font-bold">보고서</p>
            <div className="mt-1 grid grid-cols-2 gap-1" role="radiogroup" aria-label="보고서 발송 방식">
              {(
                [
                  { v: "merge", label: "합침 (정규+보강)" },
                  { v: "separate", label: "분리 (보강 따로)" },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  role="radio"
                  aria-checked={reportMode === o.v}
                  onClick={() => setReportMode(o.v)}
                  className={`rounded-md border px-2 py-1.5 text-xs transition ${
                    reportMode === o.v ? "bg-purple border-purple font-bold text-white" : "border-line text-foreground hover:bg-bg-soft"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-text-dim mt-1.5 text-xs leading-relaxed break-keep">
              {reportMode === "merge"
                ? "그날 정규 보고서에 보강을 합쳐 한 건으로 보냅니다(제목 “(정규+보강)”)."
                : "보강 보고서를 따로 만듭니다 — 정규 1건 + 보강 1건, 모두 2건이 발송됩니다. 보강 시수는 그날 이 반 칸에 얹습니다."}
              {regularDay === null ? " 그날이 정규 수업일인지 확인하지 못했습니다 — 정규 수업이 있으면 고른 방식으로 보냅니다." : ""}
            </p>
          </div>
        ) : null}

        {/* ④ 메모 */}
        <div className="mt-3">
          <label className="text-text-dim text-xs font-bold" htmlFor="reserve-note">
            메모 (예약 정보에 함께 보입니다)
          </label>
          <input
            id="reserve-note"
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 학부모 요청"
            className="border-line bg-bg-soft focus:border-primary mt-1 h-9 w-full rounded-lg border px-3 text-sm outline-none"
          />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {QUICK_NOTES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setNote(r)}
                className="border-line text-text-dim hover:bg-bg-soft rounded-full border px-2 py-0.5 text-xs"
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {error ? <p className="text-danger mt-3 text-xs leading-relaxed break-keep">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button onClick={() => void save()} disabled={blocked}>
            {saving
              ? "예약 중…"
              : range
                ? `${makeupDate.slice(5).replace("-", "/")} ${range.startTime}~${range.endTime} 보강 예약`
                : "보강 예약"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
