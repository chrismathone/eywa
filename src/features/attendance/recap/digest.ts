/**
 * 어제 출결 요약(관리자용) — **결정론 다이제스트**. 순수 함수(Vitest).
 *
 * 원장 2026-08-19: *"오늘의 출결에 당일 출결이 전부 기록되는데, 어제 출결을 요약해서 정리하는 기능"*
 * + *"팩트만을 가지고"* + *"필요한 사실만 관리자가 쏙쏙"*.
 *
 * 🔴 이 파일이 숫자·명단의 **유일한 진실**이다. AI(정리 문장)는 여기서 나온 값을 문장으로 옮길 뿐이고,
 *    화면도 AI가 아니라 이 결과를 그린다. 그래서 AI가 실패해도 요약 탭은 그대로 쓸 수 있다.
 *
 * 🔑 **세는 단위 = (학생 · 반 · 그날)** — 0221a와 같은 규약이다. 영어는 0196a 이후 **교시마다** 출결
 *    행이 남아서(수학은 하루 한 행), 행을 그냥 세면 같은 "하루 결석"이 과목에 따라 1회도 되고 3회도
 *    된다(실측 배수 영어 2.19 / 수학 1.00). 그 셈법이 이미 위험 명단을 32→17명으로 부풀린 전례가 있다.
 *    그래서 여기서도 한 학생이 한 반에서 같은 상태였던 교시들은 **한 건으로 접고** 교시 목록만 남긴다.
 * ⚠️ 반대로 **입력률(칸)** 은 교시×학생 그대로 센다 — "출석부가 얼마나 찍혔나"는 칸의 질문이라
 *    접으면 뜻이 사라진다. 두 단위를 라벨로 구분한다(건 / 칸).
 */

/** 요약이 명단으로 뽑는 상태(출석은 명단이 아니라 수치로만 — 관리자가 볼 것은 예외다). */
export const RECAP_STATUSES = ["absent", "excused", "late", "early_leave", "makeup"] as const;
export type RecapStatus = (typeof RECAP_STATUSES)[number];

export const RECAP_STATUS_LABEL: Record<RecapStatus, string> = {
  absent: "결석",
  excused: "공결",
  late: "지각",
  early_leave: "조퇴",
  makeup: "보강",
};

/** 조치 기록 요약(데스크 확인 큐와 같은 모양의 최소 형태). */
export type RecapFollowup = {
  state: string; // open | resolved | dismissed
  outcome: string | null;
  handledByName: string | null;
};

export type RecapSlotInput = {
  classId: string;
  className: string;
  subject: string;
  slotStart: string; // "HH:MM"
  /** 저장 축(slot-axis) — 조치 기록 조회 키. 수학은 null("그날 전체"). */
  saveSlot: string | null;
  /**
   * 집계 축 = 보드의 강사 줄 이름(이미 폴백돼 있다). 사람이면 계정 이름, **자리면 `LAB`·`JJ`**,
   * 자리도 담당·담임도 없으면 `담당 미지정`([teacher-group.ts](../live/teacher-group.ts)).
   */
  teacherName: string;
  /** 자리 반 표기(LAB·JJ) — 사람이 아니라 자리라 화면이 갈라 보여준다. */
  slotTeacherLabel: string | null;
  hasAnyRecord: boolean;
  students: {
    studentId: string;
    studentName: string;
    schoolGrade: string | null;
    status: string | null;
    note: string | null;
  }[];
};

export type RecapEvent = {
  studentId: string;
  studentName: string;
  schoolGrade: string | null;
  classId: string;
  className: string;
  subject: string;
  status: RecapStatus;
  /** 그 반에서 이 상태였던 교시들("16:20"). 여러 교시면 한 건으로 접힌 것이다. */
  slots: string[];
  /**
   * 그 교시들의 담당(자리 반은 사람이 아니라 `LAB`·`JJ` 표기). **여럿일 수 있다** — 영어는 교시마다
   * 담당이 바뀌는 편성이 흔해서, 첫 교시 담당만 남기면 데스크가 엉뚱한 강사에게 묻는다.
   */
  teacherNames: string[];
  /** 강사가 남긴 사유 메모 — 데스크가 전화 **전에** 봐야 하는 값. */
  note: string | null;
  /** 최근 14일 결석 횟수(2회 이상만 채운다). 결석 외 상태는 null. */
  recentAbsences: number | null;
  followup: RecapFollowup | null;
  /** 데스크가 매듭지었나(resolved·dismissed). open은 아직 남은 것이다. */
  settled: boolean;
};

export type RecapUnmarkedClass = {
  classId: string;
  className: string;
  subject: string;
  /** 그 비어 있는 교시들의 담당(자리 반은 `LAB`·`JJ`). 여럿이면 전부 — 누구에게 말할지가 이 줄의 목적이다. */
  teacherNames: string[];
  /**
   * 같은 교시들의 **강사 줄 이름**(아래 `teachers[].teacherName`과 같은 축). 화면이 "입력이 덜 된 강사"
   * 줄에서 그 강사의 미입력 반을 파생할 때 쓰는 키다.
   *
   * 🔴 **`teacherNames`(표시)와 같지 않다.** 표시는 슬롯 라벨이 이겨서 영어는 시트 닉네임 원문
   *    (`Jane`·`Kristine`)으로 적히는데, 집계 줄은 담당 **계정의 표시 이름**으로 센다. 실측
   *    (2026-08-19 살아 있는 슬롯) 194개가 `teacher_id` + 닉네임 라벨을 함께 들고 있어, 표시 이름으로
   *    강사 줄을 찾으면 **영어가 통째로 어긋난다**(줄엔 "미입력 3반"인데 펼치면 0건). 그래서 파생용
   *    축을 따로 싣는다 — 두 배열의 뜻을 섞지 말 것.
   * ⚠️ 자리(LAB·JJ)만은 2026-08-20부터 **두 값이 같다**(보드가 방마다 줄을 나눠 세므로 축도 `LAB`·`JJ`).
   *    그래도 축을 표시로 대체하지 말 것 — 같아지는 건 자리뿐이고 영어 닉네임에선 여전히 갈린다.
   */
  teacherLines: string[];
  slots: string[];
  /** 그 반에서 통째로 비어 있는 학생 수(교시 중복 제거). */
  expected: number;
};

/** 부분 미입력 한 교시 — 그 교시에서 아직 안 찍힌 학생들. */
export type RecapPartialSlot = {
  /** "HH:MM" */
  start: string;
  students: { studentId: string; studentName: string }[];
};

/**
 * **일부만 찍힌 출석부** — 강사가 출석부를 열었지만 학생 몇 명이 빈 칸으로 남은 반.
 *
 * 원장 제보 2026-08-20: *"유형숙과 추민아는 펼쳐보기가 안되서 누가 입력안되었는지 체크가 안돼."*
 * 통째 미입력(`unmarked`)은 반 단위라 **한 명만 빠진 출석부를 표현하지 못한다** — 그 강사 줄은
 * `미입력 0반`이라 펼칠 것이 없다고 판단했고, 그래서 누가 빠졌는지 볼 수단이 아예 없었다.
 */
export type RecapPartialClass = {
  classId: string;
  className: string;
  subject: string;
  /** 그 교시들의 표시 담당(자리 반은 `LAB`·`JJ`) — 누구에게 말할지의 표기. */
  teacherNames: string[];
  /**
   * 🔴 **집계 축 하나**(복수형이 아니다). 이 항목은 (반 × 강사 줄)로 쪼개져 있다 — 같은 반의 교시마다
   *    담당이 갈리는 편성이 실재해서(실측 2026-08-19 `중등E_초등 브릿지 A` = 14:20·16:20 / 15:00·15:40이
   *    다른 강사), `classId`로만 묶으면 한쪽 강사 줄에 **남이 안 찍은 교시**가 섞여 보인다.
   * 🔴 `teacherNames`(표시)와 같지 않다 — `RecapUnmarkedClass.teacherLines` 주석과 같은 함정이다.
   */
  teacherLine: string;
  slots: RecapPartialSlot[];
  /** 빈 칸 수(교시×학생) = `slots`의 `students` 길이 합. */
  cells: number;
};

export type RecapTeacherLine = {
  teacherName: string;
  cells: number;
  recorded: number;
  unmarkedClasses: number;
  /** 출석부는 열렸는데 남은 빈 칸 수(교시×학생) — 통째 미입력(`unmarkedClasses`)과 겹치지 않는다. */
  partialCells: number;
};

export type DayRecap = {
  date: string;
  totals: {
    /** 그날 열린 교시 수 · 반 수. */
    slots: number;
    classes: number;
    /** 입력률의 분모·분자 = 교시×학생 칸. */
    cells: number;
    recorded: number;
    /** 0~100(정수). 칸이 0이면 null — "0%"는 사실이 아니다. */
    inputRate: number | null;
    present: number;
    absent: number;
    excused: number;
    late: number;
    earlyLeave: number;
    makeup: number;
    /** 출석부가 통째로 안 열린 반 수 · 그 안에 든 학생 수. */
    unmarkedClasses: number;
    unmarkedStudents: number;
    /** 아직 조치가 안 끝난 결석·공결 건수 — 관리자가 오늘 손댈 것. */
    absentPending: number;
  };
  /** 결석·공결(미조치 먼저). */
  absences: RecapEvent[];
  /** 지각·조퇴·보강. */
  others: RecapEvent[];
  unmarked: RecapUnmarkedClass[];
  /** 출석부는 열렸는데 빈 칸이 남은 반(× 강사 줄) — 빈 칸이 많은 순. */
  partial: RecapPartialClass[];
  /** 입력이 덜 된 강사 먼저. */
  teachers: RecapTeacherLine[];
};

/**
 * 그 교시에 **말을 걸 대상**의 표기 — 자리 반(LAB·JJ)은 사람이 아니라 자리라 슬롯 라벨이 이긴다.
 * (강사별 집계 축은 이것과 별개로 `teacherName`을 쓴다 — 자리를 사람 줄에 섞으면 시수가 어긋난다.)
 */
function handlerOf(slot: RecapSlotInput): string {
  return slot.slotTeacherLabel ?? slot.teacherName;
}

/** 이미 있으면 넣지 않는다(순서 유지 = 교시 순서). */
function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function isRecapStatus(v: string | null): v is RecapStatus {
  return v != null && (RECAP_STATUSES as readonly string[]).includes(v);
}

/**
 * 슬롯 목록 → 하루 요약.
 *
 * @param followupOf      (studentId, saveSlot) → 조치 기록. 없으면 null.
 * @param recentAbsenceOf 학생 → 최근 14일 결석 횟수(2회 이상만).
 */
export function buildDayRecap(input: {
  date: string;
  slots: readonly RecapSlotInput[];
  followupOf?: (studentId: string, saveSlot: string | null) => RecapFollowup | null;
  recentAbsenceOf?: (studentId: string) => number | null;
}): DayRecap {
  const { date, slots } = input;
  const followupOf = input.followupOf ?? (() => null);
  const recentAbsenceOf = input.recentAbsenceOf ?? (() => null);

  // (학생·반·상태) → 한 건. 교시는 모아 둔다.
  const events = new Map<string, RecapEvent>();
  const unmarked = new Map<string, RecapUnmarkedClass & { studentIds: Set<string> }>();
  // 🔴 키가 (반 × 강사 줄)이다 — 반으로만 묶으면 교시마다 담당이 갈리는 반에서 남의 빈 칸이 섞인다.
  const partial = new Map<string, RecapPartialClass>();
  const teachers = new Map<string, RecapTeacherLine & { classes: Set<string> }>();
  const classIds = new Set<string>();
  const presentSeen = new Set<string>();
  let cells = 0;
  let recorded = 0;
  let present = 0;

  for (const slot of slots) {
    classIds.add(slot.classId);
    cells += slot.students.length;
    let line = teachers.get(slot.teacherName);
    if (!line) {
      line = {
        teacherName: slot.teacherName,
        cells: 0,
        recorded: 0,
        unmarkedClasses: 0,
        partialCells: 0,
        classes: new Set<string>(),
      };
      teachers.set(slot.teacherName, line);
    }
    line.cells += slot.students.length;

    if (!slot.hasAnyRecord) {
      let entry = unmarked.get(slot.classId);
      if (!entry) {
        entry = {
          classId: slot.classId,
          className: slot.className,
          subject: slot.subject,
          teacherNames: [],
          teacherLines: [],
          slots: [],
          expected: 0,
          studentIds: new Set<string>(),
        };
        unmarked.set(slot.classId, entry);
      }
      pushUnique(entry.slots, slot.slotStart);
      pushUnique(entry.teacherNames, handlerOf(slot));
      // 파생(강사 줄 → 미입력 반)이 아래 `line.unmarkedClasses`와 **같은 축**을 보게 한다.
      pushUnique(entry.teacherLines, slot.teacherName);
      for (const s of slot.students) entry.studentIds.add(s.studentId);
      // 같은 반의 여러 교시가 다 비어도 강사에겐 "출석부 한 개"다(반 단위로 센다).
      if (!line.classes.has(slot.classId)) {
        line.classes.add(slot.classId);
        line.unmarkedClasses += 1;
      }
    }

    for (const s of slot.students) {
      if (s.status == null) {
        // 🔑 새로 순회하지 않고 **여기서** 함께 담는다(같은 자리에서 이미 빈 칸을 보고 있다).
        // ⚠️ 통째로 비어 있는 슬롯은 위 `unmarked`가 반 단위로 담당한다 — 두 곳에 겹쳐 넣지 않는다.
        if (slot.hasAnyRecord) {
          const pkey = `${slot.classId}|${slot.teacherName}`;
          let entry = partial.get(pkey);
          if (!entry) {
            entry = {
              classId: slot.classId,
              className: slot.className,
              subject: slot.subject,
              teacherNames: [],
              teacherLine: slot.teacherName,
              slots: [],
              cells: 0,
            };
            partial.set(pkey, entry);
          }
          pushUnique(entry.teacherNames, handlerOf(slot));
          let bucket = entry.slots.find((x) => x.start === slot.slotStart);
          if (!bucket) {
            bucket = { start: slot.slotStart, students: [] };
            entry.slots.push(bucket);
          }
          bucket.students.push({ studentId: s.studentId, studentName: s.studentName });
          entry.cells += 1;
          line.partialCells += 1;
        }
        continue;
      }
      recorded += 1;
      line.recorded += 1;
      if (s.status === "present") {
        // 출석도 (학생·반) 단위로 접어 센다 — 결석과 같은 자로 재야 두 숫자를 나란히 놓을 수 있다.
        const pk = `${s.studentId}|${slot.classId}`;
        if (!presentSeen.has(pk)) {
          presentSeen.add(pk);
          present += 1;
        }
        continue;
      }
      if (!isRecapStatus(s.status)) continue;
      const key = `${s.studentId}|${slot.classId}|${s.status}`;
      const hit = events.get(key);
      if (hit) {
        pushUnique(hit.slots, slot.slotStart);
        pushUnique(hit.teacherNames, handlerOf(slot));
        // 메모는 먼저 적힌 것을 유지하되, 비어 있으면 뒤 교시 메모로 채운다(사유가 한 교시에만 있다).
        if (!hit.note && s.note) hit.note = s.note;
        // 🔴 조치는 **접힌 교시 중 아무 곳에나** 남아 있을 수 있다 — 첫 교시로만 찾으면 데스크가
        //    2교시 건을 처리했는데 요약은 "조치 미완료"라고 말한다([[#112]]와 같은 실수의 사촌).
        //    이미 처리된 것을 우선한다(멱등).
        if (!hit.settled) {
          const later = followupOf(s.studentId, slot.saveSlot);
          if (later) {
            hit.followup = later;
            hit.settled = later.state === "resolved" || later.state === "dismissed";
          }
        }
        continue;
      }
      const followup = followupOf(s.studentId, slot.saveSlot);
      events.set(key, {
        studentId: s.studentId,
        studentName: s.studentName,
        schoolGrade: s.schoolGrade,
        classId: slot.classId,
        className: slot.className,
        subject: slot.subject,
        status: s.status,
        slots: [slot.slotStart],
        teacherNames: [handlerOf(slot)],
        note: s.note,
        recentAbsences: s.status === "absent" ? recentAbsenceOf(s.studentId) : null,
        followup,
        settled: followup ? followup.state === "resolved" || followup.state === "dismissed" : false,
      });
    }
  }

  const all = [...events.values()];
  for (const e of all) e.slots.sort();
  const absences = all.filter((e) => e.status === "absent" || e.status === "excused").sort(compareAbsence);
  const others = all
    .filter((e) => e.status !== "absent" && e.status !== "excused")
    .sort(
      (a, b) =>
        RECAP_STATUSES.indexOf(a.status) - RECAP_STATUSES.indexOf(b.status) ||
        (a.slots[0] ?? "").localeCompare(b.slots[0] ?? "") ||
        a.studentName.localeCompare(b.studentName, "ko"),
    );

  const unmarkedList = [...unmarked.values()]
    .map(({ studentIds, ...rest }) => ({ ...rest, expected: studentIds.size }))
    .sort((a, b) => b.expected - a.expected || a.className.localeCompare(b.className, "ko"));

  const partialList = [...partial.values()]
    .map((c) => ({
      ...c,
      slots: [...c.slots]
        .sort((a, b) => a.start.localeCompare(b.start))
        .map((s) => ({
          ...s,
          students: [...s.students].sort((a, b) => a.studentName.localeCompare(b.studentName, "ko")),
        })),
    }))
    .sort((a, b) => b.cells - a.cells || a.className.localeCompare(b.className, "ko"));

  const countBy = (s: RecapStatus) => all.filter((e) => e.status === s).length;

  return {
    date,
    totals: {
      slots: slots.length,
      classes: classIds.size,
      cells,
      recorded,
      inputRate: cells > 0 ? Math.round((recorded / cells) * 100) : null,
      present,
      absent: countBy("absent"),
      excused: countBy("excused"),
      late: countBy("late"),
      earlyLeave: countBy("early_leave"),
      makeup: countBy("makeup"),
      unmarkedClasses: unmarkedList.length,
      unmarkedStudents: unmarkedList.reduce((n, c) => n + c.expected, 0),
      absentPending: absences.filter((e) => !e.settled).length,
    },
    absences,
    others,
    unmarked: unmarkedList,
    partial: partialList,
    teachers: [...teachers.values()]
      // 집계용으로 들고 있던 반 Set은 화면·프롬프트로 내보내지 않는다(수는 이미 unmarkedClasses에 있다).
      .map((t) => ({
        teacherName: t.teacherName,
        cells: t.cells,
        recorded: t.recorded,
        unmarkedClasses: t.unmarkedClasses,
        partialCells: t.partialCells,
      }))
      .sort((a, b) => {
        const ra = a.cells === 0 ? 1 : a.recorded / a.cells;
        const rb = b.cells === 0 ? 1 : b.recorded / b.cells;
        return ra - rb || a.teacherName.localeCompare(b.teacherName, "ko");
      }),
  };
}

/** 결석 정렬 — ① 아직 안 매듭진 것 ② 반복 결석이 많은 순 ③ 반·이름. */
function compareAbsence(a: RecapEvent, b: RecapEvent): number {
  const settled = Number(a.settled) - Number(b.settled);
  if (settled !== 0) return settled;
  const repeat = (b.recentAbsences ?? 0) - (a.recentAbsences ?? 0);
  if (repeat !== 0) return repeat;
  return a.className.localeCompare(b.className, "ko") || a.studentName.localeCompare(b.studentName, "ko");
}

/** 교시 목록 표기 — "16:20" / "16:20·17:20". */
export function slotsLabel(slots: readonly string[]): string {
  return slots.join("·");
}

/** 담당 표기 — 교시마다 사람이 다르면 전부("김강사·최강사"). 없으면 빈 문자열. */
export function handlersLabel(names: readonly string[]): string {
  return names.join("·");
}
