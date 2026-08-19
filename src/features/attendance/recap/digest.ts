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
  teacherName: string; // 이미 폴백된 표시 이름("담당 미지정")
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
  slots: string[];
  /** 그 반에서 통째로 비어 있는 학생 수(교시 중복 제거). */
  expected: number;
};

export type RecapTeacherLine = {
  teacherName: string;
  cells: number;
  recorded: number;
  unmarkedClasses: number;
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
          slots: [],
          expected: 0,
          studentIds: new Set<string>(),
        };
        unmarked.set(slot.classId, entry);
      }
      pushUnique(entry.slots, slot.slotStart);
      pushUnique(entry.teacherNames, handlerOf(slot));
      for (const s of slot.students) entry.studentIds.add(s.studentId);
      // 같은 반의 여러 교시가 다 비어도 강사에겐 "출석부 한 개"다(반 단위로 센다).
      if (!line.classes.has(slot.classId)) {
        line.classes.add(slot.classId);
        line.unmarkedClasses += 1;
      }
    }

    for (const s of slot.students) {
      if (s.status == null) continue;
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
    teachers: [...teachers.values()]
      // 집계용으로 들고 있던 반 Set은 화면·프롬프트로 내보내지 않는다(수는 이미 unmarkedClasses에 있다).
      .map((t) => ({
        teacherName: t.teacherName,
        cells: t.cells,
        recorded: t.recorded,
        unmarkedClasses: t.unmarkedClasses,
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
