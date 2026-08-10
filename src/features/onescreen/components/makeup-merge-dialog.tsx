"use client";

/**
 * 보강 추가 확인 — "정규 수업 발송건에 수업보고서를 합쳐서 발송하시겠습니까?"(원장 2026-08-06).
 *
 * 🔴 **자동으로 합치지 않는다.** 08-05엔 정규 행이 있으면 말없이 합쳤는데, 보강을 추가한 강사는 정규 행이
 *    갑자기 "(정규+보강)"이 되고 수업타임이 2가 된 걸 **결과로만** 봤다 → *"선생님들이 헷갈린대"*.
 *    합침/분리를 **토글로 보여 주고 고른 대로만** 한다. 어느 쪽을 고르든 무슨 일이 벌어지는지 이 화면에서
 *    문장으로 밝힌다(발송 건수·수업타임까지) — 누르는 사람이 결과를 알아야 한다.
 *
 * ⚠️ 후보가 둘 이상이면 **고르기 전엔 '합침'을 못 누른다** — 추측해서 시수를 올리면 안 한 과목까지
 *    급여가 붙는다(합치기는 그 반 session_units를 +1 한다).
 * ⚠️ 상태 초기화는 **부모의 조건부 렌더 + key**로 한다(effect에서 setState 금지 — React 19 룰, gotcha #25).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { MergeCandidate } from "../makeup-merge-plan";
import { absenceMemo, shortDate } from "../makeup-absence-link";

/**
 * 강사의 선택 — 어느 쪽이든 **어느 수업의 보강인지**(candidate)는 반드시 딸려 온다.
 * 🔴 분리도 candidate가 필요한 이유(원장 2026-08-06): *"분리해서 보고서가 2건 발송되면 거기도 수업타임이
 *    1+1로 2로 계산되도록 자동화되어야함."* 보강 행은 반이 없어(`classId=null`) 출석부에 시수를 못 적는다 —
 *    그래서 **보강분 1시수는 그 정규 반 행에 얹는다**. 어느 반에 얹을지가 곧 급여 귀속이라 추측하면 안 된다.
 */
export type MakeupMergeChoice = {
  mode: "merge" | "separate";
  candidate: MergeCandidate;
  /** 이번 보강이 몇 시수인가 — 그 반 정규 1회와 같은 게 기본이고 강사가 고칠 수 있다. */
  addUnits: number;
  /** 분리일 때만 — 며칠자 결석분인지(원장 2026-08-06). */
  absentDate?: string;
};

/**
 * 보강 시수 입력 파싱 — 쉼표 소수점("1,5")도 받는다(서버 parseSessionUnits와 같은 관용).
 * 0 이하·숫자 아님은 null(확인이 안 열린다) — 0시수 보강은 기록할 이유가 없고, 음수는 급여를 깎는다.
 */
function parseAddUnits(raw: string): number | null {
  const n = Number(raw.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function MakeupMergeDialog({
  studentName,
  candidates,
  sentSubjects,
  makeupDate,
  onConfirm,
  onCancel,
}: {
  studentName: string;
  candidates: readonly MergeCandidate[];
  /** 이미 발송된 정규 행 이름들 — 합치면 보강 내용이 안 실린다는 사실을 **고르기 전에** 알린다. */
  sentSubjects: readonly string[];
  /** 보강을 실제로 한 날(=지금 보고 있는 날짜). 시수가 얹히는 날이자 결석일 선택의 상한. */
  makeupDate: string;
  onConfirm: (choice: MakeupMergeChoice) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"merge" | "separate">("merge");
  // 후보가 하나면 그것으로 확정, 둘 이상이면 고르기 전엔 비워 둔다(추측 금지).
  const [pick, setPick] = useState<string | null>(candidates.length === 1 ? (candidates[0]?.name ?? null) : null);
  /**
   * 분리일 때 **며칠자 결석분인지**. 비워 두면 확인을 못 누른다 — 어느 결손을 메운 보강인지 모르면
   * 결석 칸에 남길 메모("N/N 보강 예정")를 만들 수 없고, 출석부 두 칸이 서로를 못 가리킨다.
   */
  const [absentDate, setAbsentDate] = useState("");
  /**
   * 이번 보강의 시수. 🔴 **1로 박으면 안 된다**(원장 2026-08-06: *"1.5는 3시간 수업건에 대해서 1.5로 입력되고
   * 있음 — 즉 0.5당 1시간"*). 수학 3시간 반의 보강을 1로 적으면 급여가 0.5 모자란다.
   * 기본값 = **그 반 정규 1회 시수**(그 행의 현재 값, 미입력이면 1) — 같은 수업을 한 번 더 한 것이니 그게 맞다.
   * ⚠️ 그래도 **강사가 고칠 수 있게** 연다: 행에 값이 없으면(오늘 출결 미입력) 1로 보이는데 3시간 반이면 1.5가
   *    맞고, 일부만 보강했으면 0.5일 수도 있다 — 화면이 추측한 값을 그대로 급여로 흘리지 않는다.
   */
  const [addUnitsRaw, setAddUnitsRaw] = useState("");

  const chosen = candidates.find((c) => c.name === pick) ?? null;
  // 고른 반이 바뀌면 기본값도 그 반 것을 따른다 — 강사가 직접 친 값이 있으면 그게 이긴다.
  const addUnits = addUnitsRaw.trim() ? parseAddUnits(addUnitsRaw) : (chosen?.attendanceUnits ?? 1);
  // ⚠️ 분리도 고르기 전엔 못 누른다 — 분리 역시 그 반에 시수를 얹으므로 귀속이 정해져야 한다.
  /**
   * 🔴 **날짜는 선택이다**(원장 2026-08-07: *"오늘 날짜에 추가 보강할 수도 있잖아.. 근데 추가가 안된다니?"*).
   *    분리 보강이 반드시 결석분인 건 아니다 — 결석과 무관한 **추가 보강**도 있고, 그건 메울 결석이 없다.
   *    필수로 두는 바람에 그 경우를 적을 칸이 없어 강사가 보강일(오늘)을 넣었고, 그게 다시 막혔다.
   * ⚠️ 막는 것은 **보강일과 같은 날** 하나뿐 — 출석부가 한 칸이라 "결석 0 그대로 + 시수 얹기"를 동시에
   *    적을 자리가 없다. 그 경우가 곧 '추가 보강'이므로 **비워 두면** 된다(아래 문구가 그 길을 가리킨다).
   */
  const dateBad = mode === "separate" && !!absentDate && absentDate === makeupDate;
  /** 아직 오지 않은 결석을 미리 메우는 경우 — 문구와 메모가 달라진다. */
  const beforehand = mode === "separate" && !!absentDate && makeupDate < absentDate;
  const blocked = !chosen || dateBad || addUnits === null;
  const sent = !!chosen && sentSubjects.includes(chosen.name);
  const total = chosen && addUnits !== null ? (chosen.attendanceUnits ?? 1) + addUnits : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="bg-background border-line w-full max-w-md rounded-lg border p-5 shadow-lg"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-foreground mb-1.5 text-sm font-bold">
          정규 수업 발송건에 수업보고서를 합쳐서 발송하시겠습니까?
        </h2>
        <p className="text-text-dim text-sm leading-relaxed">
          {/* ⚠️ 구분자는 쉼표 — 행 이름 자체가 " · "를 품는다("수학 · 고1 특강"). 가운뎃점으로 이으면
              "수학 · 수학 · 고1 특강"이 되어 두 반인지 세 반인지 읽히지 않는다. */}
          {studentName} 학생은 오늘 {candidates.map((c) => c.name).join(", ")} 정규 수업이 있습니다.
        </p>

        {/* 합침 ↔ 분리 토글 — 라디오 그룹(키보드로도 고를 수 있어야 한다). */}
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

        {/* 어느 수업의 보강인지 — 후보가 둘 이상일 때만 묻는다(하나면 위 문장에 이미 있다).
            ⚠️ 합침·분리 **둘 다** 묻는다: 합침은 어느 보고서에 합칠지, 분리는 어느 반에 보강 1시수를 얹을지.
               어느 쪽이든 그 반의 급여 귀속이 달라지므로 추측하면 안 된다. */}
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

        {/* 분리 = 며칠자 결석분인지. 그 날짜 칸엔 **메모만** 붙고 결석(0)은 그대로 — 시수는 보강한 날에 얹힌다.
            ⚠️ 미래 날짜도 고를 수 있다(선보강). 아직 출결 행이 없는 날이면 메모는 안 붙고 그 사실을 알린다. */}
        {mode === "separate" ? (
          <div className="mt-3">
            <label htmlFor="makeup-absent-date" className="text-text-faint mb-1.5 block text-[12px]">
              며칠자 결석분 보강인가요? <span className="text-text-faint">(결석분일 때만)</span>
            </label>
            {/* 두 갈래를 다 적는다 — 안 적으면 "필수인가?" 하고 아무 날짜나 넣게 된다(그게 이번 제보였다). */}
            <p className="text-text-faint mb-1.5 text-[11px]">
              결석과 무관한 <b>추가 보강</b>이면 <b>비워 두세요</b>. 아직 결석 전이면 <b>결석 예정일</b>을
              고르면 됩니다(미리 보강한 경우).
            </p>
            <input
              id="makeup-absent-date"
              type="date"
              value={absentDate}
              onChange={(e) => setAbsentDate(e.target.value)}
              className="border-line bg-bg-soft focus:border-primary h-8 rounded-lg border px-2 text-[13px] outline-none"
            />
          </div>
        ) : null}

        {/* 보강 시수 — 🔴 1로 박지 않는다. 수학은 **0.5당 1시간**이라 3시간 반의 1회는 1.5다(원장 2026-08-06).
            기본값은 그 반 정규 1회와 같게 두되, 화면이 추측한 값을 그대로 급여로 흘리지 않도록 열어 둔다. */}
        {chosen ? (
          <div className="mt-3">
            <label htmlFor="makeup-add-units" className="text-text-faint mb-1.5 block text-[12px]">
              이번 보강 시수
            </label>
            <div className="flex items-center gap-2">
              <input
                id="makeup-add-units"
                inputMode="decimal"
                value={addUnitsRaw}
                placeholder={String(chosen.attendanceUnits ?? 1)}
                onChange={(e) => setAddUnitsRaw(e.target.value)}
                aria-invalid={addUnits === null}
                className="border-line bg-bg-soft focus:border-primary h-8 w-20 rounded-lg border px-2 text-[13px] outline-none"
              />
              <span className="text-text-faint text-[11px]">0.5 = 1시간 (수학 기준)</span>
            </div>
          </div>
        ) : null}

        {/* 고른 대로 무슨 일이 벌어지는지 — 발송 건수·수업타임·출석부 두 칸까지 밝힌다.
            🔴 **막힌 상태면 색을 바꾼다** — 흐린 회색 한 줄로는 안 읽힌다(원장이 이유가 적혀 있는데도
               "왜 활성화 안되지?"라고 물었다). 버튼이 안 눌리는 이유는 눈에 띄어야 한다. */}
        <p
          className={`mt-3 text-[12px] leading-relaxed ${
            !chosen || addUnits === null || dateBad ? "text-amber font-medium" : "text-text-faint"
          }`}
        >
          {!chosen
            ? "어느 수업의 보강인지 골라 주세요."
            : addUnits === null
              ? "보강 시수는 0보다 큰 숫자로 적어 주세요(0.5 = 1시간)."
              : mode === "merge"
                ? // ⚠️ 숫자 뒤에 조사(이/가·로/으로)를 붙이지 말 것 — 받침이 값마다 달라(2=이, 3=삼) 틀린 조사가 나온다.
                  // ⚠️ "정규 1"로 박지 말 것 — 강사가 이미 고쳐 뒀을 수 있다. 현재값 + 입력값을 그대로 보인다.
                  `${chosen.name} 보고서 1건에 합쳐 "(정규+보강)"으로 한 번만 발송합니다. 출석부 수업타임은 ${chosen.name} 행에 ${chosen.attendanceUnits ?? 1} + 보강 ${addUnits} = ${total}.`
                : // 🔴 **막힌 이유를 그 자리에서 이름 붙여 말한다.** 예전엔 날짜를 이미 골랐는데도 "골라
                  //    주세요"라고만 해서, 강사가 "골랐는데 왜 안 되지?" 하고 멈췄다(원장 제보 2026-08-07
                  //    *"이거 왜 발송 버튼이 활성화 안되지?"* — 그 화면의 날짜는 보강일과 같은 8/10이었다).
                  //    비었을 때와 같은 날일 때는 **다른 문제**이므로 다른 문장으로 가른다.
                  absentDate === makeupDate
                    ? // 출석부가 한 칸이라 "결석 0 그대로 + 시수 얹기"를 동시에 적을 수 없다 — 나눌 수 없는 게
                      // 규칙이 아니라 **자리가 없다**는 사실이다. 두 갈래 출구를 함께 준다.
                    `${shortDate(absentDate)}은 보강한 날과 같은 날입니다 — 출석부가 한 칸이라 결석분으로 이을 수 없습니다. 오늘 한 추가 보강이면 날짜를 비워 두세요.`
                  : !absentDate
                    ? // 추가 보강 — 메울 결석이 없으니 연결도 없다. 무엇이 일어나는지는 똑같이 다 적는다.
                      `보강 보고서를 따로 만듭니다 — 정규 1건 + 보강 1건, 모두 2건이 발송됩니다. 결석분 연결은 없고(추가 보강), 출석부는 ${shortDate(makeupDate)} ${chosen.name} 칸이 ${chosen.attendanceUnits ?? 1} + 보강 ${addUnits} = ${total}.`
                    : // 출석부 두 칸이 서로를 가리키게 된다 — 결석 칸은 0 그대로(메모만), 시수는 보강한 날에.
                    `보강 보고서를 따로 만듭니다 — 정규 1건 + 보강 1건, 모두 2건이 발송됩니다. 출석부는 ${shortDate(absentDate)} ${chosen.name} 칸에 "${absenceMemo(makeupDate, absentDate)}" 메모만 붙고(결석 0은 그대로), ${shortDate(makeupDate)} 칸이 ${chosen.attendanceUnits ?? 1} + 보강 ${addUnits} = ${total}.${beforehand ? " 아직 지나지 않은 날이라 그 칸에 출결 기록이 없으면 메모는 남지 않습니다." : ""}`}
        </p>
        {mode === "merge" && sent ? (
          // ⚠️ 한 덩어리 문자열로 — `{chosen?.name} 보고서는`처럼 식과 텍스트를 섞으면 사이 공백이 사라진다
          //    ("수학보고서는", 실측). 붙은 글자는 오타로 보인다.
          <p className="text-amber mt-1.5 text-[12px] leading-relaxed">
            {`${chosen?.name} 보고서는 이미 발송되어 보강 내용은 실리지 않습니다(수업타임만 올라갑니다). 보강 내용을 보내려면 ‘분리’를 고르세요.`}
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
              chosen &&
              addUnits !== null &&
              onConfirm({
                mode,
                candidate: chosen,
                addUnits,
                ...(mode === "separate" ? { absentDate } : {}),
              })
            }
          >
            {mode === "merge" ? "합쳐서 발송" : "분리해서 발송"}
          </Button>
        </div>
      </div>
    </div>
  );
}
