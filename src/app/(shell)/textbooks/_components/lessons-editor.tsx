"use client";

import { writeLockedPlaceholder } from "@/lib/write-lock";
import { FIELD } from "./form-bits";

export type LessonValue = { progress: string; homework: string };

/**
 * 차수 표 — 1..N 전부가 행으로 선다(원장 2026-09-16 *"차수가 10차수 면 차수마다 진도 과제 10차수 모두
 * 작성할수있어야함"*).
 *
 * 🔴 **저장 전에도 선다** — 차수 칸에 숫자를 치면 그 자리에서 행이 생긴다(원장 2026-09-16 *"차수 숫자
 *    입력하면 온체인지로 바로 갯수에맞게 나오게"*). 그래서 이 컴포넌트는 서버 조회가 아니라 **부모가 든
 *    값**만 그린다(순수 표시 + onChange). 저장은 부모의 버튼 하나가 한 번에 한다.
 * 🔑 진도·과제가 **둘 다 비면** 저장할 때 그 차수 행은 지워진다 — 빈 행이 쌓이면 "작성한 차수" 수가
 *    거짓이 되고, 기입 때 아무것도 안 들어가는 칸이 대상으로 잡힌다.
 * ⚠️ 차수 수를 줄인 뒤에도 남아 있는 옛 행은 **감추지 않고** 뒤에 회색으로 붙는다(쓴 게 조용히 사라지지 않게).
 */
export function LessonsEditor({
  lessonNos,
  values,
  sessionCount,
  canWrite,
  onChange,
}: {
  /** 그릴 차수 번호(오름차순) — 1..sessionCount + 범위 밖 옛 행. */
  lessonNos: number[];
  values: Map<number, LessonValue>;
  /** 지금 정해진 차수 수 — 이보다 뒤의 행은 "차수를 줄인 뒤 남은 옛 기록"이다. */
  sessionCount: number;
  canWrite: boolean;
  onChange: (lessonNo: number, field: "progress" | "homework", value: string) => void;
}) {
  if (lessonNos.length === 0) {
    return (
      <p className="text-text-dim border-line-faint rounded-lg border px-3 py-6 text-center text-xs">
        {/* 읽기 권한에게 '숫자를 넣으라'고 권하지 않는다(write-lock.ts — 빈 목록 문구도 읽기용으로). */}
        {canWrite ? (
          <>
            위 <b>차수</b>에 숫자를 넣으면 그만큼 진도·과제 칸이 바로 열립니다.
          </>
        ) : (
          "적어 둔 차수가 없습니다."
        )}
      </p>
    );
  }
  const lockedHint = canWrite ? undefined : writeLockedPlaceholder("textbooks");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-bold">차수별 진도·과제</h3>
        <span className="text-text-faint text-xs">비워 두면 그 차수는 시트에 기입되지 않습니다.</span>
      </div>
      <div className="bg-card border-line-faint max-h-[42vh] overflow-y-auto rounded-lg border px-1">
        <table className="w-full border-collapse text-xs">
          <colgroup>
            <col style={{ width: 52 }} />
            <col />
            <col />
          </colgroup>
          <thead className="bg-card sticky top-0 z-10">
            <tr className="text-text-dim text-xs">
              <th className="py-1.5 text-center font-bold">차수</th>
              <th className="py-1.5 text-left font-bold">진도</th>
              <th className="py-1.5 text-left font-bold">과제</th>
            </tr>
          </thead>
          <tbody>
            {lessonNos.map((no) => {
              const v = values.get(no) ?? { progress: "", homework: "" };
              const extra = no > sessionCount;
              return (
                <tr key={no} className={extra ? "bg-bg-soft/60" : undefined}>
                  <td
                    className="num py-0.5 text-center font-bold"
                    title={extra ? "차수 수 밖의 옛 기록입니다 — 비우면 지워집니다" : undefined}
                  >
                    {no}
                  </td>
                  <td className="py-0.5 pr-1">
                    <input
                      value={v.progress}
                      onChange={(e) => onChange(no, "progress", e.target.value)}
                      disabled={!canWrite}
                      placeholder={lockedHint}
                      maxLength={500}
                      aria-label={`${no}차수 진도`}
                      className={FIELD}
                    />
                  </td>
                  <td className="py-0.5">
                    <input
                      value={v.homework}
                      onChange={(e) => onChange(no, "homework", e.target.value)}
                      disabled={!canWrite}
                      placeholder={lockedHint}
                      maxLength={500}
                      aria-label={`${no}차수 과제`}
                      className={FIELD}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
