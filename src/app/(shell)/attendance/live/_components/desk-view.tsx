"use client";

/**
 * 데스크 확인 큐 — 과목별로 쪼갠 뒤 결석 → 미입력 반 → 미확인.
 * 처리한 건은 지우지 않고 아래로(#105).
 */
import { useState, type ReactNode } from "react";
import { CheckCircle2 } from "@/components/icons/aywa-icon-compat";
import { EmptyState } from "@/components/empty-state";
import { EmbedAnchor } from "@/components/embed-link";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { OUTCOME_LABEL, orderQueueSubjects, type DeskQueue, type QueueStudent } from "@/features/attendance/live/queue";
import { SearchScopeChip, StudentSearchToggle } from "@/features/attendance/components/student-search-box";
import {
  SubjectFilterSelect,
  SubjectScopeChip,
  useSubjectFilter,
} from "@/features/attendance/components/subject-filter-chips";
import { matchesSubjectFilter } from "@/features/attendance/live/view-prefs";
import {
  emptySearchMessage,
  isSearchActive,
  matchesStudentSearch,
} from "@/features/attendance/student-search";
import { DeskClassRow } from "./desk-class-row";
import { DeskStudentRow } from "./desk-student-row";

export function DeskView({
  queue,
  date,
  canEdit,
  carryOver,
  /** 계정에 저장된 과목 필터(2026-08-20) — 이 화면은 이미 과목 섹션이라 **섹션 표시 여부**만 바꾼다. */
  initialSubject = "all",
}: {
  queue: DeskQueue;
  date: string;
  canEdit: boolean;
  carryOver: { date: string; count: number } | null;
  initialSubject?: string;
}) {
  const subjects = useSubjectMaps();
  // ⚠️ 아래 `keys.map((subject) => …)`가 같은 이름을 쓴다 — 섀도잉을 피해 훅 값은 `subjectFilter`.
  const subjectFilter = useSubjectFilter(initialSubject);
  /**
   * 학생 검색(원장 2026-08-19) — **클라 필터**(서버 왕복 0·저장 없음). 안 걸린 줄은 안 그린다.
   * 🔴 '미입력 반' 레인은 **학생 이름이 없는 줄**(반이 통째로 비었다는 신호)이라 검색 대상이 아니다 —
   *    조용히 지우면 "그 학생 반이 사라졌다"가 되므로, 감춘 건수를 한 줄로 밝힌다.
   */
  const [query, setQuery] = useState("");
  const searching = isSearchActive(query);
  const hit = (s: QueueStudent) => matchesStudentSearch(query, [s.studentName, s.schoolGrade]);
  const students = searching ? queue.lanes.students.filter(hit) : queue.lanes.students;
  const doneRows = searching ? queue.done.filter(hit) : queue.done;
  const classRows = searching ? [] : queue.lanes.classes;
  const hiddenClassRows = searching ? queue.lanes.classes.length : 0;
  const empty = queue.counts.classes === 0 && queue.counts.students === 0;
  const absentRows = students.filter((s) => s.signal === "absent");
  const unmarkedRows = students.filter((s) => s.signal !== "absent");
  const shownRows = students.length + doneRows.length;
  // 검색할 학생 줄 자체가 없으면 입력칸을 안 그린다 — 빈 큐 위에 뜬 검색칸은 노이즈다.
  const searchableRows = queue.lanes.students.length + queue.done.length;
  const allKeys = orderQueueSubjects(
    [
      ...classRows.map((c) => c.subject),
      ...students.map((s) => s.subject),
      ...doneRows.map((s) => s.subject),
    ],
    subjects.options.map((o) => o.value),
  );
  // 🔴 좁히는 축 = **과목 섹션**(이 화면은 이미 과목으로 쪼개져 있다). 섹션 안 줄은 손대지 않는다.
  const keys = allKeys.filter((k) => matchesSubjectFilter(subjectFilter.value, k));

  return (
    <div className="space-y-6">
      {/* 검색 줄 — 처리함까지 같은 규칙으로 좁힌다(그 학생을 되짚는 자리라). 칩이 많은 줄이 아니라
          입력칸 하나뿐이지만, 좁은 화면에서 칩과 함께 감기지 않게 레일 규약을 그대로 쓴다. */}
      {/* 툴바 자체가 비면 그리지 않는다 — 빈 레일은 노이즈다.
          ⚠️ 검색 조건은 **필터 전** 줄 수(`searchableRows`)로 본다: 검색 결과가 0건일 때 툴바가 사라지면
             입력칸까지 함께 없어져 **검색을 지울 수단이 사라진다**. */}
      {searchableRows > 0 || (allKeys.length > 0 && subjects.filters.length > 1) ? (
        <div className="toolbar-rail flex flex-wrap items-center gap-2">
          {/* 검색할 줄이 없으면 입력칸만 접는다 — 과목 칩은 남긴다(섹션 좁히기는 여전히 가능하다). */}
          {/* 검색은 토글(§10) — 검색어가 걸려 있으면 펼친 채 + 결과 칩. */}
          {searchableRows > 0 ? (
            <StudentSearchToggle
              value={query}
              onChange={setQuery}
              inputWidth="w-[104px]"
              chip={<SearchScopeChip shown={shownRows} total={searchableRows} unit="건" totalsNote="탭의 확인 건수는 전체 기준" />}
            />
          ) : null}
          <SubjectFilterSelect
            value={subjectFilter.value}
            onPick={subjectFilter.pick}
            pending={subjectFilter.pending}
          />
          <SubjectScopeChip
            subject={subjectFilter.value}
            shown={keys.length}
            total={allKeys.length}
            unit="개 과목"
            totalsNote="탭의 확인 건수는 전체 기준"
          />
        </div>
      ) : null}
      {/* 과목으로 좁혀 섹션이 하나도 안 남았을 때 — 왜 비었는지 밝히고 되돌릴 길을 준다. */}
      {keys.length === 0 && allKeys.length > 0 ? (
        <div className="bg-card shadow-card flex flex-wrap items-center gap-3 rounded-2xl px-4 py-4">
          <span className="text-foreground text-sm font-bold break-keep">
            고른 과목에는 확인할 건이 없습니다 — 다른 과목에 {allKeys.length}개 묶음이 남아 있습니다.
          </span>
          <button
            type="button"
            onClick={() => subjectFilter.pick("all")}
            className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition"
          >
            전체 보기
          </button>
        </div>
      ) : null}
      {/* ⚠️ 이 안내는 레일 **밖**이다 — 문장이 길어 레일 안에 두면 폰에서 가로로 끌어야 읽힌다. */}
      {searching && hiddenClassRows > 0 ? (
        <p className="text-text-faint text-xs break-keep">
          미입력 반 {hiddenClassRows}건은 학생 이름이 없어 검색에서 빠집니다 — 검색을 지우면 보입니다.
        </p>
      ) : null}
      {searching && shownRows === 0 ? (
        <div className="bg-card shadow-card flex flex-wrap items-center gap-3 rounded-2xl px-4 py-4">
          <span className="text-foreground text-sm font-bold">
            {emptySearchMessage(query, "이 날 확인 목록")}
          </span>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition"
          >
            검색 지우기
          </button>
        </div>
      ) : null}
      {carryOver && carryOver.count > 0 && (
        <EmbedAnchor
          href={`/attendance/live?tab=desk&date=${carryOver.date}`}
          className="text-amber text-sm font-bold"
        >
          어제 남은 결석 {carryOver.count}건
        </EmbedAnchor>
      )}
      {!searching && empty && queue.counts.done === 0 && (
        <EmptyState
          icon={CheckCircle2}
          title="확인할 건이 없습니다"
          description="수업 시작 10분이 지나도 출결이 비어 있으면 여기에 뜹니다."
        />
      )}

      {keys.map((subject) => {
        const classes = classRows.filter((c) => c.subject === subject);
        const absent = absentRows.filter((s) => s.subject === subject);
        const unmarked = unmarkedRows.filter((s) => s.subject === subject);
        const done = doneRows.filter((s) => s.subject === subject);
        if (classes.length + absent.length + unmarked.length + done.length === 0) return null;
        return (
          <section key={subject || "none"} className="space-y-4">
            <h2 className="text-lg font-bold">{subjects.labelOf(subject) || "과목 없음"}</h2>
            {absent.length > 0 && (
              <Lane title="결석" count={absent.length} danger>
                {absent.map((s) => (
                  <DeskStudentRow
                    key={`${s.studentId}@${s.classId}@${s.slotStart}`}
                    row={s}
                    date={date}
                    canEdit={canEdit}
                  />
                ))}
              </Lane>
            )}
            {classes.length > 0 && (
              <Lane title="미입력 반" count={classes.length}>
                {classes.map((c) => (
                  <DeskClassRow
                    key={`${c.classId}@${c.slotStart}`}
                    row={c}
                    date={date}
                    canEdit={canEdit}
                  />
                ))}
              </Lane>
            )}
            {unmarked.length > 0 && (
              <Lane title="미확인" count={unmarked.length}>
                {unmarked.map((s) => (
                  <DeskStudentRow
                    key={`${s.studentId}@${s.classId}@${s.slotStart}`}
                    row={s}
                    date={date}
                    canEdit={canEdit}
                  />
                ))}
              </Lane>
            )}
            {done.length > 0 && (
              <Lane title="처리함" count={done.length}>
                {done.map((s) => (
                  <div
                    key={`${s.studentId}@${s.classId}@${s.slotStart}`}
                    className="text-text-dim flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 text-sm"
                  >
                    <span className="text-foreground font-bold">{s.studentName}</span>
                    <span className="num text-xs">
                      {s.className} · {s.slotStart}
                    </span>
                    <span className="ml-auto text-xs">
                      {s.followup?.state === "dismissed"
                        ? "해당 없음"
                        : s.followup?.outcome
                          ? (OUTCOME_LABEL[s.followup.outcome] ?? "확인")
                          : "확인"}
                    </span>
                    {s.followup?.handledByName && (
                      <span className="text-text-faint text-xs">{s.followup.handledByName}</span>
                    )}
                  </div>
                ))}
              </Lane>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Lane({
  title,
  count,
  danger,
  children,
}: {
  title: string;
  count: number;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-baseline gap-2">
        <span className="text-sm font-bold">{title}</span>
        <span className={`num text-sm ${danger ? "text-att-absent-ink" : "text-text-dim"}`}>{count}</span>
      </h3>
      <div className="bg-card shadow-card divide-line divide-y rounded-2xl">{children}</div>
    </section>
  );
}
