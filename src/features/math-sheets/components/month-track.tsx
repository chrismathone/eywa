"use client";

import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { positionFrozen } from "../lib/progress-stall";
import type { MathCellState } from "../lib/cell-state";
import type { MathSheetMonthData, MathStudentRow } from "../server/month-queries";

/**
 * B안 — **진도 레일**. A안이 "무엇을 나갔나"라면 이건 "얼마나 나갔나"다.
 *
 * 재료는 `progress_containers`(현행·선행 2트랙, 학생별 커리큘럼 위치) — **수학에만 있다.**
 * 영어엔 대응물이 없어서 ECS 월간 뷰에는 이 보기가 없다.
 *
 * 🔴 위치를 모르는 학생(교재가 '프린트'라 커리큘럼 매칭이 안 되는 경우 등)에게 **0%짜리 막대를
 *    그리지 않는다** — 모르는 것을 "안 나갔다"로 그리면 없는 사실을 만든다. 그런 학생은 막대 자리에
 *    "진도 기록 없음"이라고 적는다.
 * ⚠️ 점(날짜)의 무늬는 A안 칸과 **같은 규약**이다(빗금=왔는데 안 적힘, 회색=출결조차 없음).
 */
const DOT_TONE: Record<MathCellState, string> = {
  written: "bg-primary-soft text-primary border-transparent",
  unwritten:
    "border-line-faint text-danger bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,rgba(188,56,56,.08)_4px,rgba(188,56,56,.08)_8px)]",
  absent: "bg-bg-soft text-text-faint border-transparent",
  untracked: "bg-muted text-text-faint border-line-faint",
  "off-roster": "bg-transparent text-text-faint border-dashed border-line-faint",
};

/** 막대 길이 — 그 학년 커리큘럼 안에서의 상대 위치는 알 수 없으므로 **이 달에 움직인 폭**을 그린다. */
function moveWidth(row: { startPosition: number | null; lastPosition: number | null }): number | null {
  if (row.startPosition == null || row.lastPosition == null) return null;
  const moved = Math.max(0, row.lastPosition - row.startPosition);
  // 한 달에 20차시를 넘게 나가는 일은 드물어 20을 가득으로 본다(넘으면 가득).
  return Math.min(100, Math.round((moved / 20) * 100));
}

function StudentCard({
  stu,
  days,
  elapsedDays,
}: {
  stu: MathStudentRow;
  days: MathSheetMonthData["days"];
  /** 그 달 수업일 중 이미 지난 날 — 0이면 아직 한 번도 안 한 달이다. */
  elapsedDays: number;
}) {
  const stalled = stu.stalledDates.length > 0;
  const written = days.filter((d) => stu.cells[d.date] === "written").length;
  const unwritten = days.filter((d) => stu.cells[d.date] === "unwritten").length;
  // 🔴 **아직 안 지난 달을 경고로 칠하지 않는다**(원장 2026-09-01 9월 화면이 전부 빨간 '기록 0건'이었다).
  //    수업이 한 번도 안 지났으면 '안 적은 것'이 아니라 '아직 안 한 것'이다.
  const notStarted = elapsedDays === 0;
  const noTrace = !notStarted && days.length > 0 && days.every((d) => stu.cells[d.date] === "untracked");

  return (
    <div
      className={`rounded-xl border bg-white p-3 ${
        noTrace ? "border-danger" : stalled ? "border-amber" : "border-line"
      }`}
    >
      <div className="mb-2.5 flex items-baseline gap-1.5">
        <Link href={`/students/${stu.studentId}`} className="hover:text-primary text-[13.5px] font-extrabold">
          {stu.name}
        </Link>
        <span className="text-text-faint text-[11px]">{schoolGradeLabel(stu.school, stu.grade)}</span>
        <span className="flex-1" />
        {notStarted ? (
          <span className="bg-muted text-text-faint rounded-full px-2 py-0.5 text-[11px] font-bold">
            아직 수업 전
          </span>
        ) : noTrace ? (
          <span className="bg-danger-soft text-danger rounded-full px-2 py-0.5 text-[11px] font-bold">
            기록 0건
          </span>
        ) : stalled ? (
          <span className="bg-amber-soft text-amber flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold">
            <EyIcon name="alert" size={10} />
            같은 진도 {stu.stalledDates.length}회
          </span>
        ) : (
          <span className="bg-green-soft text-green rounded-full px-2 py-0.5 text-[11px] font-bold">
            기록 {written}
          </span>
        )}
      </div>

      {stu.tracks.length > 0 ? (
        stu.tracks.map((t) => {
          const w = moveWidth(t);
          const moved =
            t.startPosition != null && t.lastPosition != null
              ? Math.max(0, t.lastPosition - t.startPosition)
              : null;
          // 🔴 "이 달에 안 움직였다"는 **경고가 아니라 사실**이다 — 진도 문자열이 매번 달라도(박서준처럼)
          //    커리큘럼 위치가 제자리인 경우가 있어 정체 판정으로는 안 잡힌다. 그렇다고 카드째 빨갛게
          //    칠하면 거짓 경보가 된다(교재가 '프린트'면 매칭이 안 돼 위치가 원래 안 움직인다) —
          //    그래서 **이미 보여 주고 있는 숫자만** 눈에 띄게 한다. 수업을 2번 이상 한 달에만.
          const frozen = positionFrozen(t.startPosition, t.lastPosition) && written >= 2;
          return (
            <div key={`${t.track}-${t.gradeScope ?? ""}`} className="mb-2">
              <div className="text-text-faint mb-1 flex items-baseline justify-between text-[10.5px]">
                <b className="text-[11px] font-extrabold">
                  {t.trackLabel}
                  {t.gradeScope ? ` · ${t.gradeScope}` : ""}
                </b>
                <span className={`num ${frozen ? "text-amber font-bold" : ""}`}>
                  {moved != null ? `+${moved}차시` : "위치 미상"}
                </span>
              </div>
              <div className="bg-muted h-2 overflow-hidden rounded-full">
                {w != null ? (
                  <div
                    className={`h-full rounded-full ${t.track === "ahead" ? "bg-blue" : "bg-primary"}`}
                    style={{ width: `${Math.max(w, 2)}%` }}
                  />
                ) : null}
              </div>
              {/* 🔴 위치 숫자(387 → 399)만으로는 어디까지 나갔는지 아무도 모른다 — **차시 이름**을 적는다
                  (원장 2026-09-01 "세부 차시 보이면 더 좋겠네"). 커리큘럼 매칭이 안 되면(교재가 프린트인
                  경우 등) 그 줄을 아예 안 그린다 — 없는 것을 지어내지 않는다. */}
              {t.lastLesson ? (
                <div className="text-text-dim mt-1 text-[11.5px] leading-snug">
                  <span className="text-text-faint">지금 </span>
                  {t.lastLesson}
                  {t.lastUnit ? <span className="text-text-faint"> · {t.lastUnit}</span> : null}
                </div>
              ) : null}
            </div>
          );
        })
      ) : (
        <div className="text-text-faint mb-2 text-[11px]">진도 기록 없음 — 컨테이너가 열려 있지 않습니다.</div>
      )}

      <div className="border-line-faint mt-2 flex gap-1 border-t pt-2">
        {days.map((d) => {
          const state = stu.cells[d.date] ?? "untracked";
          return (
            <span
              key={d.date}
              title={`${d.date} · ${state === "written" ? (stu.records[d.date]?.textbook ?? "기록 있음") : state === "unwritten" ? "출석 · 기록 없음" : state === "absent" ? "결석" : state === "off-roster" ? "수강 전/후" : "출결도 기록도 없음"}`}
              className={`num flex h-6 flex-1 items-center justify-center rounded-md border text-[9.5px] font-extrabold ${
                stu.records[d.date]?.offGoal ? "bg-amber-soft text-amber border-transparent" : DOT_TONE[state]
              }`}
            >
              {Number(d.date.slice(8, 10))}
            </span>
          );
        })}
      </div>

      {unwritten > 0 ? (
        <div className="text-danger mt-2 text-[11px] leading-snug font-bold">
          출석했는데 기록이 없는 날 {unwritten}일
        </div>
      ) : null}
    </div>
  );
}

export function MonthTrack({ data }: { data: MathSheetMonthData }) {
  if (data.days.length === 0) {
    return (
      <p className="text-text-faint rounded-2xl border border-dashed p-8 text-center text-sm">
        {data.monthLabel}에는 이 반 수업이 없습니다.
      </p>
    );
  }
  return (
    <div className="grid gap-3 px-1 sm:grid-cols-2 xl:grid-cols-3">
      {data.students.map((stu) => (
        <StudentCard key={stu.studentId} stu={stu} days={data.days} elapsedDays={data.elapsedDays} />
      ))}
    </div>
  );
}
