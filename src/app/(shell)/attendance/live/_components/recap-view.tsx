"use client";

/**
 * 출결 요약 탭(관리자용) — **결정론 집계만** 그린다. AI 정리 카드는 그 위에 얹히는 부가물이라
 * 없거나 실패해도 이 화면은 온전하다(원장 2026-08-19: *"팩트만을 가지고"*).
 *
 * 화면 순서 = 관리자가 손댈 순서다: ① 기간 종합 스탯 ② AI 정리(선택) ③ **날짜별 블록**
 * (결석 → 지각·조퇴·보강 → 미입력 출석부) ④ 기간 전체에서 입력이 덜 된 강사.
 * 숫자만 크게 띄우고 명단을 접지 않는다 — "결석 18건"만 보이고 누구인지 다음 화면에 있으면
 * 결국 아무도 안 본다.
 *
 * 🔑 월요일은 금·토·일 사흘을 덮는다(원장 정정) — 합계는 위에 한 번, 내용은 **날짜별로 나눠서**.
 */
import { useId, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { BigStat } from "@/components/atoms/big-stat";
import { CalendarDays } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { formatKoreanDate } from "@/lib/date-kst";
import type { RangeRecap } from "@/features/attendance/recap/range";
import type { RecapTeacherLine } from "@/features/attendance/recap/digest";
import { partialByTeacher, unmarkedByTeacher } from "@/features/attendance/recap/teacher-unmarked";
import {
  SubjectFilterChips,
  SubjectScopeChip,
  useSubjectFilter,
} from "@/features/attendance/components/subject-filter-chips";
import { matchesSubjectFilter } from "@/features/attendance/live/view-prefs";
import { RecapAiCard, type RecapAiState } from "./recap-ai-card";
import { PartialRow, RecapDayBlock, UnmarkedRow } from "./recap-day";

export function RecapView({
  recap,
  isToday,
  ai,
  /** 계정에 저장된 과목 필터(2026-08-20) — 좁히는 축은 **사건 줄**이고 합계·AI 정리는 전체 기준이다. */
  initialSubject = "all",
}: {
  recap: RangeRecap;
  /** 오늘을 요약하면 아직 끝나지 않은 하루다 — 숫자가 확정이 아님을 화면이 먼저 말한다. */
  isToday: boolean;
  ai: RecapAiState;
  initialSubject?: string;
}) {
  const t = recap.totals;
  const subject = useSubjectFilter(initialSubject);
  // 범위 전체에서 이 과목에 걸리는 사건 줄 수 — 범위 칩이 "몇/몇을 보고 있는지" 적는 근거.
  const eventRows = recap.days.flatMap((d) => [...d.absences, ...d.others]);
  const shownEventRows = eventRows.filter((e) => matchesSubjectFilter(subject.value, e.subject));
  const absentTotal = t.absent + t.excused;
  const otherTotal = t.late + t.earlyLeave + t.makeup;
  // 수업이 아예 없던 날은 블록을 만들지 않는다 — 일요일 빈 블록이 금·토 사이에 끼면 읽기만 어렵다.
  // (보강·특강이 실제로 있었다면 slots>0이라 블록으로 뜬다. 있는데 안 보이는 일은 없다.)
  const shown = recap.days.filter((d) => d.totals.slots > 0);
  const skipped = recap.days.filter((d) => d.totals.slots === 0);
  const behind = recap.teachers.filter((x) => x.cells > 0 && x.recorded < x.cells);

  if (shown.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title={
          recap.days.length > 1
            ? `${formatKoreanDate(recap.from)} ~ ${formatKoreanDate(recap.to)} — 수업이 없습니다`
            : `${formatKoreanDate(recap.to)} — 수업이 없습니다`
        }
        description={
          recap.days.find((d) => d.holiday)
            ? "휴원일이라 확인할 출결이 없습니다."
            : "시간표에 열린 교시가 없어 요약할 출결이 없습니다."
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      {isToday ? (
        <p className="bg-amber-soft text-amber rounded-2xl px-3 py-2 text-[13px] font-medium">
          오늘은 아직 진행 중입니다 — 아래 숫자는 지금까지 입력된 것까지입니다.
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* 🔴 미조치를 **긴급 / 사유 확인**으로 갈라 적는다(원장 2026-08-20) — 여행·휴가가 대부분이라
            "미조치 18건"만 보면 매일 빨간불이고, 그러면 아무도 안 본다. `absentPending`(전체)의 뜻은
            그대로 두고 그 안을 나눈다. */}
        <BigStat
          label="결석·공결"
          value={absentTotal}
          unit="건"
          tone={t.absentUrgent > 0 ? "danger" : t.absentPending > 0 ? "amber" : "green"}
          icon={<EyIcon name="userX" size={16} />}
          valueClass={absentTotal > 0 ? "text-danger" : undefined}
          sub={
            t.absentUrgent > 0
              ? `연락 필요 ${t.absentUrgent}건 · 사유 확인 ${t.absentNotified}건`
              : t.absentPending > 0
                ? `미조치 ${t.absentPending}건 모두 사유가 확인됨`
                : "모두 확인 완료"
          }
        />
        <BigStat
          label="지각·조퇴·보강"
          value={otherTotal}
          unit="건"
          tone="amber"
          icon={<EyIcon name="clock" size={16} />}
          sub={`지각 ${t.late} · 조퇴 ${t.earlyLeave} · 보강 ${t.makeup}`}
        />
        {/* ⚠️ 여러 날을 덮으면 같은 반이 금·토 각각 한 번씩 세어진다 — 그래서 단위가 '반'이 아니라
            '건'(그날 그 반의 출석부 하나)이다. 하루짜리에선 그대로 '반'. */}
        <BigStat
          label="출석부 미입력"
          value={t.unmarkedClasses}
          unit={recap.days.length > 1 ? "건" : "반"}
          tone={t.unmarkedClasses > 0 ? "amber" : "green"}
          icon={<EyIcon name="clipboardList" size={16} />}
          sub={t.unmarkedClasses > 0 ? `학생 ${t.unmarkedStudents}명이 기록 없음` : "전 반 입력 완료"}
        />
        {/* ⚠️ 기록이 0건이면 "0%"는 사실이 아니다 — 입력률이 0인 게 아니라 아무도 안 찍은 것이다
            (월간 출석부 LiveStats와 같은 규약). */}
        <BigStat
          label="출결 입력"
          value={t.inputRate ?? "—"}
          unit={t.inputRate == null ? "기록 없음" : "%"}
          tone={t.inputRate != null && t.inputRate >= 90 ? "green" : "amber"}
          icon={<EyIcon name="percent" size={16} />}
          sub={`${t.cells}칸 중 ${t.recorded}칸 · ${t.slots}교시`}
        />
      </section>

      {/* 과목 필터 — 아래 **날짜별 사건 줄**만 좁힌다. 위 스탯·AI 정리는 범위 전체 기준 그대로다. */}
      <div className="toolbar-rail flex flex-wrap items-center gap-2">
        <SubjectFilterChips value={subject.value} onPick={subject.pick} pending={subject.pending} />
        <SubjectScopeChip
          subject={subject.value}
          shown={shownEventRows.length}
          total={eventRows.length}
          unit="건"
          totalsNote="위 스탯과 AI 정리는 전체 기준"
        />
      </div>

      <RecapAiCard from={recap.from} to={recap.to} state={ai} />

      {/* 빈 날은 블록 대신 한 줄 — "안 봤다"와 "볼 게 없었다"를 구분해 준다. */}
      {skipped.length > 0 ? (
        <p className="text-text-faint text-[12px]">
          {skipped
            .map((d) => `${formatKoreanDate(d.date)} ${d.holiday ? `휴원일(${d.holiday})` : "수업 없음"}`)
            .join(" · ")}
        </p>
      ) : null}

      <div className="space-y-6">
        {shown.map((day) => (
          <RecapDayBlock
            key={day.date}
            day={day}
            single={shown.length === 1}
            subject={subject.value}
          />
        ))}
      </div>

      {/* 강사는 날짜를 가로질러 합친다 — 사흘치를 날짜별로 흩으면 "누가 계속 안 찍나"가 안 보인다. */}
      {behind.length > 0 ? (
        <section className="space-y-2">
          <h2 className="flex items-baseline gap-2">
            <span className="text-sm font-bold">입력이 덜 된 강사·자리</span>
            <span className="num text-text-dim text-sm">{behind.length}</span>
            {recap.days.length > 1 ? <span className="text-text-faint text-[11px]">기간 합계</span> : null}
            {behind.some((x) => x.unmarkedClasses > 0 || x.partialCells > 0) ? (
              <span className="text-text-faint text-[11px]">
                이름을 누르면 미입력 출석부·빈 칸 명단이 열립니다.
              </span>
            ) : null}
            {/* 🔴 강사 줄은 **과목 축이 없다**(한 사람이 여러 과목을 찍는다) — 조용히 안 좁히면
                "필터를 걸었는데 왜 다 보이지"가 되므로 그 사실을 적는다. */}
            {subject.active ? (
              <span className="text-text-faint text-[11px]">과목 필터와 무관하게 전체를 셉니다.</span>
            ) : null}
          </h2>
          {/* 펼침 버튼이 행을 가득 채우므로 hover 배경이 모서리를 넘지 않게 목록이 자른다
              (카드 테두리는 그림자 링이라 이 클립에 안 걸린다 [[#114]]). */}
          <ul className="bg-card shadow-card divide-line divide-y overflow-hidden rounded-2xl">
            {behind.map((line) => (
              <BehindTeacherRow key={line.teacherName} line={line} recap={recap} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * 입력이 덜 된 강사 한 줄 — 누르면 **그 강사의 미입력 출석부와 빈 칸 명단**이 날짜별로 펼쳐진다
 * (원장 제보 2026-08-19: *"누르면 리스트라도 볼 수 있어야 하는데 바로가기 같은것도 없네."*
 * + 2026-08-20: *"유형숙과 추민아는 펼쳐보기가 안되서 누가 입력안되었는지 체크가 안돼."*).
 *
 * 🔑 목록은 새로 세지 않고 날짜 블록이 쓰는 `day.unmarked`·`day.partial`을 그 강사 것만 고른 것이라,
 *    줄에 적힌 `미입력 N반`·`빈 칸 N개`와 펼친 수가 **같은 값**이다(`teacher-unmarked.ts` + Vitest가 잠근다).
 * 🔴 겹치지 않는 것은 **칸**이다(출석부가 아니다) — digest가 슬롯의 `hasAnyRecord`로 갈라 담으므로
 *    같은 칸이 두 번 세어지는 일은 없지만, **한 반이 두 묶음에 동시에 뜰 수는 있다**(영어처럼 교시별로
 *    기록이 남는 반에서 1교시는 통째로 비고 2교시는 몇 명만 빈 경우 — 교시가 서로 다르니 둘 다 사실이다).
 *    반 이름이 겹쳐 보인다고 여기서 다시 합치거나 한쪽을 빼지 말 것.
 * ⚠️ 펼침은 화면 로컬 상태로 둔다 — 정렬·필터처럼 오래 남는 뷰 세팅이 아니라 한 번 보고 마는 동작이다.
 */
function BehindTeacherRow({ line, recap }: { line: RecapTeacherLine; recap: RangeRecap }) {
  const [open, setOpen] = useState(false);
  const uid = useId();
  const panelId = `${uid}-unmarked`;
  const groups = unmarkedByTeacher(recap.days, line.teacherName);
  const partialGroups = partialByTeacher(recap.days, line.teacherName);
  const multiDay = recap.days.length > 1;
  // 통째 빈 출석부가 없어도 **칸이 덜 찍혔으면 펼친다** — 학생 한 명만 빠진 출석부가 실제로 흔하고,
  // 예전엔 그 줄이 펼쳐지지 않아 누가 빠졌는지 확인할 길이 아예 없었다.
  const expandable = line.unmarkedClasses > 0 || line.partialCells > 0;

  const head = (
    <>
      {expandable ? (
        <EyIcon
          name={open ? "chevronUp" : "chevronDown"}
          size={14}
          className="text-text-faint shrink-0"
        />
      ) : (
        // 펼칠 수 없는 줄도 이름 시작 위치가 같아야 한 열로 읽힌다.
        <span aria-hidden className="inline-block size-[14px] shrink-0" />
      )}
      <span className="font-bold">{line.teacherName}</span>
      <span className="num text-text-dim ml-auto text-xs">
        {line.cells}칸 중 {line.recorded}칸
      </span>
      {line.unmarkedClasses > 0 ? (
        <span className="num text-amber shrink-0 text-xs font-bold">
          미입력 {line.unmarkedClasses}반
        </span>
      ) : null}
      {line.partialCells > 0 ? (
        <span className="num text-amber shrink-0 text-xs font-bold">
          빈 칸 {line.partialCells}개
        </span>
      ) : null}
    </>
  );

  return (
    <li className="text-sm">
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="hover:bg-bg-soft/40 flex w-full items-center gap-x-2 px-3 py-2 text-left transition"
        >
          {head}
        </button>
      ) : (
        <div className="flex items-center gap-x-2 px-3 py-2">{head}</div>
      )}

      {expandable && open ? (
        <div id={panelId} className="border-line space-y-3 border-t px-3 pt-2 pb-3">
          {groups.length === 0 && partialGroups.length === 0 ? (
            // 여기까지 오면 파생이 집계와 어긋난 것이다 — 숫자를 감추지 말고 그 사실을 말한다.
            <p className="text-text-faint text-xs break-keep">
              이 요약 범위({formatKoreanDate(recap.from)}
              {recap.from === recap.to ? "" : ` ~ ${formatKoreanDate(recap.to)}`})의 날짜별 목록에서는 빈
              출석부를 찾지 못했습니다 — 범위 밖 날짜일 수 있습니다.
            </p>
          ) : null}

          {/* ① 통째로 안 열린 출석부(반 단위). 없으면 제목째 생략한다 — 빈 제목은 노이즈다. */}
          {groups.length > 0 ? (
            <div className="space-y-2">
              {partialGroups.length > 0 ? (
                <p className="text-text-dim text-[11px] font-bold">출석부 미입력</p>
              ) : null}
              {groups.map((g) => (
                <div key={g.date} className="space-y-1">
                  {/* 기간 합계 줄이라 날짜를 밝힌다 — "언제 안 찍었나"가 사라지면 물어볼 수가 없다. */}
                  {multiDay ? (
                    <p className="text-text-faint text-[11px] font-medium">{formatKoreanDate(g.date)}</p>
                  ) : null}
                  <ul className="border-line divide-line divide-y rounded-xl border">
                    {g.classes.map((c) => (
                      <UnmarkedRow key={c.classId} row={c} date={g.date} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}

          {/* ② 열긴 열었는데 남은 빈 칸(칸 단위) — 누가 빠졌는지가 여기서만 보인다. */}
          {partialGroups.length > 0 ? (
            <div className="space-y-2">
              {groups.length > 0 ? (
                <p className="text-text-dim text-[11px] font-bold">빈 칸이 남은 출석부</p>
              ) : null}
              {partialGroups.map((g) => (
                <div key={g.date} className="space-y-1">
                  {multiDay ? (
                    <p className="text-text-faint text-[11px] font-medium">{formatKoreanDate(g.date)}</p>
                  ) : null}
                  <ul className="border-line divide-line divide-y rounded-xl border">
                    {g.classes.map((c) => (
                      <PartialRow key={`${c.classId}|${c.teacherLine}`} row={c} date={g.date} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
