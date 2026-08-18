"use client";

/**
 * 보강 추가 확인 — **모든 보강 추가가 이 창을 거친다**(원장 2026-08-19: *"이름 검색하고 누르면 그냥
 * 추가되고 끝이야. 뭐 아무것도 안나와"* → 항상 묻도록. 원스크린·출석부·ECS 세 진입점 공용).
 *
 * 묻는 것 셋:
 *  ① **어느 결석분인가** — 그 학생의 실제 결석 기록에서 고른다. 🔴 후보는 수강 중인 반이 아니라 **출결
 *     기록**에서 뽑으므로 **반 이동 전 옛 반 결석도 고를 수 있다**(원장 *"이전 수업을 이월해 보강"*).
 *     결석과 무관한 추가 보강이면 '결석분 아님', 아직 결석 전이면 직접 날짜(선보강).
 *  ② **시수** — 🔴 1로 박지 않는다(수학은 0.5당 1시간이라 3시간 반의 1회는 1.5, 원장 2026-08-06).
 *  ③ **합침/분리** — 그날 정규 수업이 **있을 때만** 묻는다(합칠 보고서가 없으면 물어봐야 답이 없다).
 *
 * ⚠️ 상태 초기화는 **부모의 조건부 렌더 + key**로 한다(effect에서 setState 금지 — React 19 룰, gotcha #25).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { MergeCandidate } from "@/features/onescreen/makeup-merge-plan";
import { absenceMemo, shortDate } from "@/features/onescreen/makeup-absence-link";
import { absenceOptionLabel, type MakeupAbsenceOption } from "../makeup-options";

/**
 * 강사의 선택.
 * 🔴 `candidate`가 null이면 **그날 정규 수업이 없는 순수 보강** — 시수를 얹을 반은 호출부가 아는
 *    '지금 보강한 반'(앵커)이다. 합침은 애초에 선택지가 아니다.
 */
export type MakeupConfirmChoice = {
  mode: "merge" | "separate";
  candidate: MergeCandidate | null;
  /** 이번 보강이 몇 시수인가 — 그 반 정규 1회와 같은 게 기본이고 강사가 고칠 수 있다. */
  addUnits: number;
  /** 며칠자 결석분인지(선택 — 추가 보강이면 없음). */
  absentDate?: string;
  /** 그 결석이 난 **반**(이월 보강이면 지금 반과 다르다). 미지정이면 시수 얹는 반과 같은 반. */
  absentClassId?: string;
};

/**
 * 보강 시수 입력 파싱 — 쉼표 소수점("1,5")도 받는다(서버 parseSessionUnits와 같은 관용).
 * 0 이하·숫자 아님은 null(확인이 안 열린다) — 0시수 보강은 기록할 이유가 없고, 음수는 급여를 깎는다.
 */
function parseAddUnits(raw: string): number | null {
  const n = Number(raw.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 직접 입력 모드 sentinel — 셀렉트 값과 섞이지 않게 빈 문자열 대신 명시 토큰을 쓴다. */
const PICK_NONE = "__none__";
const PICK_CUSTOM = "__custom__";

export function MakeupConfirmDialog({
  studentName,
  candidates,
  sentSubjects,
  makeupDate,
  absenceOptions,
  absenceLoading,
  defaultUnits,
  onConfirm,
  onCancel,
}: {
  studentName: string;
  /** 그날 그 학생의 정규 수업 행(합칠 수 있는 것만). 비어 있으면 '보강만' 모드. */
  candidates: readonly MergeCandidate[];
  /** 이미 발송된 정규 행 이름들 — 합치면 보강 내용이 안 실린다는 사실을 **고르기 전에** 알린다. */
  sentSubjects?: readonly string[];
  /** 보강을 실제로 한 날(=지금 보고 있는 날짜). 시수가 얹히는 날이자 결석일 선택의 상한. */
  makeupDate: string;
  /** 그 학생의 결석 기록(이전 반 포함). 비어 있으면 직접 입력만 남는다. */
  absenceOptions: readonly MakeupAbsenceOption[];
  absenceLoading?: boolean;
  /** 정규 수업이 없을 때의 시수 기본값(보통 1). */
  defaultUnits?: number;
  onConfirm: (choice: MakeupConfirmChoice) => void;
  onCancel: () => void;
}) {
  const canMerge = candidates.length > 0;
  const [mode, setMode] = useState<"merge" | "separate">(canMerge ? "merge" : "separate");
  // 후보가 하나면 그것으로 확정, 둘 이상이면 고르기 전엔 비워 둔다(추측 금지).
  const [pick, setPick] = useState<string | null>(candidates.length === 1 ? (candidates[0]?.name ?? null) : null);
  /** 결석 후보 선택 — `PICK_NONE`(추가 보강) · `PICK_CUSTOM`(직접 날짜) · `classId|date`. */
  const [absencePick, setAbsencePick] = useState<string>(PICK_NONE);
  const [customDate, setCustomDate] = useState("");
  const [customNote, setCustomNote] = useState<string | null>(null);
  const [addUnitsRaw, setAddUnitsRaw] = useState("");

  const chosen = candidates.find((c) => c.name === pick) ?? null;
  const baseUnits = chosen?.attendanceUnits ?? defaultUnits ?? 1;
  // 고른 반이 바뀌면 기본값도 그 반 것을 따른다 — 강사가 직접 친 값이 있으면 그게 이긴다.
  const addUnits = addUnitsRaw.trim() ? parseAddUnits(addUnitsRaw) : baseUnits;

  const selectedOption =
    absencePick !== PICK_NONE && absencePick !== PICK_CUSTOM
      ? (absenceOptions.find((o) => `${o.classId}|${o.date}` === absencePick) ?? null)
      : null;
  const absentDate = selectedOption?.date ?? (absencePick === PICK_CUSTOM ? customDate : "");
  const absentClassId = selectedOption?.classId;
  /** 아직 오지 않은 결석을 미리 메우는 경우 — 문구가 달라진다(선보강). */
  const beforehand = !!absentDate && makeupDate < absentDate;
  // 합침을 골랐으면 결석분 연결은 의미가 없다(같은 날 한 칸에서 만난다) — 물어보지 않는다.
  const asksAbsence = mode === "separate";
  const blocked = (canMerge && !chosen) || addUnits === null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="bg-background border-line max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border p-5 shadow-lg"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-foreground mb-1.5 text-sm font-bold">
          {canMerge ? "정규 수업 발송건에 수업보고서를 합쳐서 발송하시겠습니까?" : "보강을 추가합니다"}
        </h2>
        <p className="text-text-dim text-sm leading-relaxed">
          {/* ⚠️ 구분자는 쉼표 — 행 이름 자체가 " · "를 품는다("수학 · 고1 특강"). */}
          {canMerge
            ? `${studentName} 학생은 오늘 ${candidates.map((c) => c.name).join(", ")} 정규 수업이 있습니다.`
            : `${studentName} 학생의 보강입니다 — 오늘 이 선생님의 정규 수업은 없습니다.`}
        </p>

        {canMerge ? (
          <div className="mt-4 flex gap-1.5" role="radiogroup" aria-label="보강 보고서 처리 방식">
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
                aria-checked={mode === o.v}
                onClick={() => setMode(o.v)}
                className={
                  mode === o.v
                    ? "border-primary bg-primary-soft text-primary flex-1 rounded-lg border px-3 py-2 text-[13px] font-bold"
                    : "border-line text-text-dim hover:bg-bg-soft flex-1 rounded-lg border px-3 py-2 text-[13px] font-bold"
                }
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : null}

        {/* 어느 수업의 보강인지 — 후보가 둘 이상일 때만(하나면 위 문장에 이미 있다).
            ⚠️ 합침·분리 둘 다 묻는다: 어느 쪽이든 그 반의 급여 귀속이 달라진다. */}
        {candidates.length > 1 ? (
          <div className="mt-3" role="radiogroup" aria-label="보강 수업 선택">
            <p className="text-text-faint mb-1.5 text-[12px]">어느 수업의 보강인가요?</p>
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  role="radio"
                  aria-checked={pick === c.name}
                  onClick={() => setPick(c.name)}
                  className={
                    pick === c.name
                      ? "border-primary bg-primary-soft text-primary rounded-lg border px-2.5 py-1.5 text-[12px] font-bold"
                      : "border-line text-text-dim hover:bg-bg-soft rounded-lg border px-2.5 py-1.5 text-[12px] font-bold"
                  }
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* ① 며칠자 결석분인가 — **목록에서 고른다**(반 이동 전 옛 반 결석 포함). */}
        {asksAbsence ? (
          <div className="mt-3">
            <label htmlFor="makeup-absence-pick" className="text-text-faint mb-1.5 block text-[12px]">
              며칠자 결석분 보강인가요?
            </label>
            <select
              id="makeup-absence-pick"
              value={absencePick}
              onChange={(e) => {
                setAbsencePick(e.target.value);
                setCustomNote(null);
              }}
              className="border-line bg-bg-soft focus:border-primary h-9 w-full rounded-lg border px-2 text-[13px] outline-none"
            >
              <option value={PICK_NONE}>결석분 아님 (추가 보강)</option>
              {absenceOptions.map((o) => (
                <option key={`${o.classId}|${o.date}`} value={`${o.classId}|${o.date}`}>
                  {absenceOptionLabel(o)}
                </option>
              ))}
              <option value={PICK_CUSTOM}>직접 입력 (아직 결석 전 · 목록에 없음)</option>
            </select>
            <p className="text-text-faint mt-1.5 text-[11px] leading-snug">
              {absenceLoading
                ? "결석 기록을 불러오는 중…"
                : absenceOptions.length === 0
                  ? "최근 90일 결석 기록이 없습니다 — 추가 보강이면 그대로 두세요."
                  : "반을 옮겼어도 이전 반 결석이 함께 보입니다(이월 보강)."}
            </p>
            {absencePick === PICK_CUSTOM ? (
              <div className="mt-2">
                <input
                  type="date"
                  value={customDate}
                  aria-label="결석 날짜 직접 입력"
                  onChange={(e) => {
                    const v = e.target.value;
                    // 보강한 날은 결석분이 될 수 없다(출석부가 한 칸) — 값을 받지 않고 갈 길을 알려 준다.
                    if (v && v === makeupDate) {
                      setCustomNote(
                        `${shortDate(makeupDate)}은 보강한 날이라 결석분으로 고를 수 없습니다 — 그날 한 추가 보강이면 '결석분 아님'을 고르세요.`,
                      );
                      return;
                    }
                    setCustomNote(null);
                    setCustomDate(v);
                  }}
                  className="border-line bg-bg-soft focus:border-primary h-8 rounded-lg border px-2 text-[13px] outline-none"
                />
                {customNote ? <p className="text-amber mt-1.5 text-[11px] leading-snug">{customNote}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ② 시수 — 🔴 1로 박지 않는다(0.5 = 1시간). */}
        <div className="mt-3">
          <label htmlFor="makeup-add-units" className="text-text-faint mb-1.5 block text-[12px]">
            이번 보강 시수
          </label>
          <div className="flex items-center gap-2">
            <input
              id="makeup-add-units"
              inputMode="decimal"
              value={addUnitsRaw}
              placeholder={String(baseUnits)}
              onChange={(e) => setAddUnitsRaw(e.target.value)}
              aria-invalid={addUnits === null}
              className="border-line bg-bg-soft focus:border-primary h-8 w-20 rounded-lg border px-2 text-[13px] outline-none"
            />
            <span className="text-text-faint text-[11px]">0.5 = 1시간 (수학 기준)</span>
          </div>
        </div>

        {/* 고른 대로 무슨 일이 벌어지는지 — 막힌 상태면 색을 바꾼다(흐린 회색 한 줄은 안 읽힌다). */}
        <p
          className={`mt-3 text-[12px] leading-relaxed ${blocked ? "text-amber font-medium" : "text-text-faint"}`}
        >
          {canMerge && !chosen
            ? "어느 수업의 보강인지 골라 주세요."
            : addUnits === null
              ? "보강 시수는 0보다 큰 숫자로 적어 주세요(0.5 = 1시간)."
              : mode === "merge" && chosen
                ? `${chosen.name} 보고서 1건에 합쳐 "(정규+보강)"으로 한 번만 발송합니다. 출석부 수업타임은 ${chosen.name} 행에 ${chosen.attendanceUnits ?? 1} + 보강 ${addUnits} = ${(chosen.attendanceUnits ?? 1) + addUnits}.`
                : !absentDate
                  ? `보강 보고서를 따로 만듭니다${canMerge ? " — 정규 1건 + 보강 1건, 모두 2건이 발송됩니다" : ""}. 결석분 연결은 없고(추가 보강), ${shortDate(makeupDate)} 보강 수업타임은 ${addUnits}.`
                  : `보강 보고서를 따로 만듭니다${canMerge ? " — 정규 1건 + 보강 1건, 모두 2건이 발송됩니다" : ""}. 출석부는 ${shortDate(absentDate)}${selectedOption ? ` ${selectedOption.className}` : ""} 칸에 "${absenceMemo(makeupDate, absentDate)}" 메모만 붙고(결석 0은 그대로), ${shortDate(makeupDate)} 칸 보강 수업타임은 ${addUnits}.${beforehand ? " 아직 지나지 않은 날이라 그 칸에 출결 기록이 없으면 메모는 남지 않습니다." : ""}`}
        </p>
        {mode === "merge" && chosen && (sentSubjects ?? []).includes(chosen.name) ? (
          <p className="text-amber mt-1.5 text-[12px] leading-relaxed">
            {`${chosen.name} 보고서는 이미 발송되어 보강 내용은 실리지 않습니다(수업타임만 올라갑니다). 보강 내용을 보내려면 ‘분리’를 고르세요.`}
          </p>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={blocked}
            onClick={() =>
              addUnits !== null &&
              onConfirm({
                mode,
                candidate: chosen,
                addUnits,
                ...(mode === "separate" && absentDate ? { absentDate } : {}),
                ...(mode === "separate" && absentClassId ? { absentClassId } : {}),
              })
            }
          >
            {mode === "merge" ? "합쳐서 발송" : canMerge ? "분리해서 발송" : "보강 추가"}
          </Button>
        </div>
      </div>
    </div>
  );
}
