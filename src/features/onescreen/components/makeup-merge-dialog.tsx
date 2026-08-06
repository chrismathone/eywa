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
import { mergedUnits } from "../makeup-merge-plan";

export type MakeupMergeChoice = { mode: "merge"; candidate: MergeCandidate } | { mode: "separate" };

export function MakeupMergeDialog({
  studentName,
  candidates,
  sentSubjects,
  onConfirm,
  onCancel,
}: {
  studentName: string;
  candidates: readonly MergeCandidate[];
  /** 이미 발송된 정규 행 이름들 — 합치면 보강 내용이 안 실린다는 사실을 **고르기 전에** 알린다. */
  sentSubjects: readonly string[];
  onConfirm: (choice: MakeupMergeChoice) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"merge" | "separate">("merge");
  // 후보가 하나면 그것으로 확정, 둘 이상이면 고르기 전엔 비워 둔다(추측 금지).
  const [pick, setPick] = useState<string | null>(candidates.length === 1 ? (candidates[0]?.name ?? null) : null);

  const chosen = candidates.find((c) => c.name === pick) ?? null;
  const blocked = mode === "merge" && !chosen;
  const sent = !!chosen && sentSubjects.includes(chosen.name);

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

        {/* 어느 과목 정규 행에 합칠지 — 후보가 둘 이상일 때만 묻는다(하나면 위 문장에 이미 있다). */}
        {mode === "merge" && candidates.length > 1 ? (
          <div className="mt-3" role="radiogroup" aria-label="합칠 과목">
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

        {/* 고른 대로 무슨 일이 벌어지는지 — 발송 건수와 수업타임까지 밝힌다. */}
        <p className="text-text-faint mt-3 text-[12px] leading-relaxed">
          {mode === "merge"
            ? chosen
              ? // ⚠️ 숫자 뒤에 조사(이/가·로/으로)를 붙이지 말 것 — 받침이 값마다 달라(2=이, 3=삼) 틀린 조사가 나온다.
                `${chosen.name} 보고서 1건에 합쳐 "(정규+보강)"으로 한 번만 발송합니다. 출석부 수업타임 ${mergedUnits(chosen.attendanceUnits)}.`
              : "합칠 수업을 골라 주세요."
            : "보강 보고서를 따로 만듭니다 — 같은 날 학부모에게 정규 1건 + 보강 1건, 모두 2건이 발송됩니다."}
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
              onConfirm(mode === "merge" && chosen ? { mode: "merge", candidate: chosen } : { mode: "separate" })
            }
          >
            {mode === "merge" ? "합쳐서 발송" : "분리해서 발송"}
          </Button>
        </div>
      </div>
    </div>
  );
}
