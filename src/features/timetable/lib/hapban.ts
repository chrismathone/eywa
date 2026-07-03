import { compareStudentLines } from "./student-sort";

/**
 * 합반(같은 강사·교시·요일에 2개 반+) 통합 명단 — ijw ClassCard 패턴.
 * 반별 카드 적층 대신 카드 1개(헤더 N등분 + 학생 통합 명단 + 학생별 반 인덱스 배지)를 만들기 위한 순수 계산.
 *
 * ⚠️ 순수 모듈 — server-only·클라 컴포넌트 어느 쪽도 런타임 import하지 않는다(구조적 타입만). [[#61]]
 */

/** 입력 학생 — StudentQuick(class-cell)·StudentLine(queries)이 구조적으로 만족하는 최소 형태. */
export type HapbanStudentIn = {
  name: string;
  enrollmentId?: string;
  studentId?: string;
  status?: "active" | "hold" | "withdrawn";
  endDate?: string | null;
  isNew?: boolean;
  isTransferredIn?: boolean;
  attendanceDays?: string[];
};

/** 입력 슬롯 — ClassDetailQuick이 구조적으로 만족하는 최소 형태(mergeSlotsByClass 결과 순서 = 세그먼트 순서). */
export type HapbanSlotIn<S extends HapbanStudentIn = HapbanStudentIn> = {
  id: string; // 스케줄 id(셀/드롭 마커 키)
  classId?: string;
  className: string;
  students: S[];
};

/** 통합 명단 행에 붙는 합반 메타 — 원본 학생 필드(S)는 제네릭으로 보존(StudentQuick 등). */
export type HapbanExtras = {
  /** 반 인덱스 배지("1"·"2"·"1,2") — 최고 status를 가진 반들의 인덱스. */
  label: string;
  /** 채택 enrollment(드래그/Delete/요일편집의 편집 대상)의 소속 — 행 단위 바인딩. */
  ownClassId: string;
  ownClassName: string;
  ownSlotId: string;
  /** 편집용 요일 = 채택 enrollment의 attendanceDays(요일편집 팝오버 currentDays·드래그 no-op 판정). */
  ownAttendanceDays: string[];
  /** 표시용 요일 = 최고 status enrollment들의 합집합(하나라도 []=전 요일이면 []) — 분리등원 렌더 전용.
   * (행의 attendanceDays도 이 합집합으로 덮어씀 — hover 카드가 배치와 모순되게 "월만 등원"으로 오표시하는 것 방지.
   *  편집 경로는 ownAttendanceDays/dayOwners만 쓰므로 무영향.) */
  displayAttendanceDays: string[];
  /** 비퇴원(active+hold) 소속 반 전부 — 드롭 차단용(열린 수강이 있는 반으로의 이동은 저장 시 GiST 실패). */
  blockingClassIds: string[];
  /**
   * 요일 → 그 요일 등원을 실소유한 최고 status enrollment의 바인딩(요일 칸 행의 드래그/편집 대상).
   * 채택 enrollment 고정이면 A=[월]+B=[수] 학생의 '수' 칸 행을 끌 때 A가 편집되는 오류(적대리뷰 확정) —
   * 요일 칸은 dayOwners[day] ?? own으로 바인딩한다. []=전 요일 enrollment도 그 요일 소유로 침.
   */
  dayOwners: Record<
    string,
    { enrollmentId?: string; classId: string; className: string; slotId: string; attendanceDays: string[] }
  >;
};

export type HapbanStudent<S extends HapbanStudentIn = HapbanStudentIn> = S & HapbanExtras;

export type HapbanSegment = {
  index: number; // 1부터
  classId: string;
  slotId: string;
  className: string;
};

export type HapbanRoster<S extends HapbanStudentIn = HapbanStudentIn> = {
  segments: HapbanSegment[];
  active: HapbanStudent<S>[];
  hold: HapbanStudent<S>[];
  withdrawn: HapbanStudent<S>[];
};

const STATUS_RANK = { active: 0, hold: 1, withdrawn: 2 } as const;
const stRank = (s: HapbanStudentIn) => STATUS_RANK[s.status ?? "active"];

/** 슬롯별 명단 → 통합 명단(dedup + 인덱스 라벨 + 채택 enrollment + 표시용 요일 합집합 + 차단 반 목록). */
export function buildHapbanRoster<S extends HapbanStudentIn>(slots: HapbanSlotIn<S>[]): HapbanRoster<S> {
  const segments: HapbanSegment[] = slots.map((s, i) => ({
    index: i + 1,
    classId: s.classId ?? s.id,
    slotId: s.id,
    className: s.className,
  }));

  // studentId(없으면 enrollmentId 폴백 = dedup 안 됨) → 그 학생의 (세그먼트, 원본 행) 목록.
  type Occ = { seg: HapbanSegment; s: S };
  const byStudent = new Map<string, Occ[]>();
  slots.forEach((slot, i) => {
    const seg = segments[i]!;
    for (const s of slot.students) {
      const key = s.studentId ?? `enr:${s.enrollmentId ?? `${seg.classId}:${s.name}`}`;
      (byStudent.get(key) ?? byStudent.set(key, []).get(key)!).push({ seg, s });
    }
  });

  const active: HapbanStudent<S>[] = [];
  const hold: HapbanStudent<S>[] = [];
  const withdrawn: HapbanStudent<S>[] = [];

  for (const occs of byStudent.values()) {
    // 최고 status(재원>대기>퇴원) 그룹만 표시 대상 — A퇴원+B재원이면 재원 [B]로 1회.
    const best = Math.min(...occs.map((o) => stRank(o.s)));
    const top = occs.filter((o) => stRank(o.s) === best);
    // 채택 enrollment = 최고 status 중 세그먼트 인덱스 최소(결정적 tie-break).
    const chosen = top.reduce((a, b) => (a.seg.index <= b.seg.index ? a : b));
    // 표시용 요일 = 최고 status enrollment들의 합집합. 하나라도 [](전 요일)이면 [].
    const dayUnion = top.some((o) => (o.s.attendanceDays ?? []).length === 0)
      ? []
      : Array.from(new Set(top.flatMap((o) => o.s.attendanceDays ?? [])));
    // 요일별 실소유 enrollment — 그 요일에 등원([]=전 요일 포함)하는 최고 status 중 세그먼트 인덱스 최소.
    const dayOwners: HapbanExtras["dayOwners"] = {};
    for (const day of dayUnion) {
      const owner = top.find((o) => {
        const ad = o.s.attendanceDays ?? [];
        return ad.length === 0 || ad.includes(day);
      });
      if (owner) {
        dayOwners[day] = {
          enrollmentId: owner.s.enrollmentId,
          classId: owner.seg.classId,
          className: owner.seg.className,
          slotId: owner.seg.slotId,
          attendanceDays: owner.s.attendanceDays ?? [],
        };
      }
    }
    // 퇴원 표시는 최신 종료일(endDate max)로.
    const endDate =
      best === STATUS_RANK.withdrawn
        ? (top.map((o) => o.s.endDate ?? "").sort().pop() ?? chosen.s.endDate)
        : chosen.s.endDate;
    const row: HapbanStudent<S> = {
      ...chosen.s,
      // hover 카드(StudentInfoCard)가 읽는 표시 요일도 합집합으로 — 명단 배치(공통/요일 칸)와 일관.
      attendanceDays: dayUnion,
      endDate,
      label: top.map((o) => o.seg.index).sort((a, b) => a - b).join(","),
      ownClassId: chosen.seg.classId,
      ownClassName: chosen.seg.className,
      ownSlotId: chosen.seg.slotId,
      ownAttendanceDays: chosen.s.attendanceDays ?? [],
      displayAttendanceDays: dayUnion,
      blockingClassIds: occs
        .filter((o) => stRank(o.s) !== STATUS_RANK.withdrawn)
        .map((o) => o.seg.classId),
      dayOwners,
    };
    if (best === STATUS_RANK.active) active.push(row);
    else if (best === STATUS_RANK.hold) hold.push(row);
    else withdrawn.push(row);
  }

  active.sort(compareStudentLines);
  hold.sort(compareStudentLines);
  withdrawn.sort(compareStudentLines);
  return { segments, active, hold, withdrawn };
}

/** 드래그 학생의 합반 메타(드래그 data에 실림). */
export type DropActiveData = {
  classId?: string; // 출발 반(채택 enrollment의 반)
  /** 이 학생이 열린 수강(active+hold)을 가진 반 전부 — 소속 반으로의 이동 차단. */
  blockingClassIds?: string[];
};

/** 드롭존 data(기존 DropData 확장). */
export type DropOverData = {
  classId?: string;
  slotId?: string;
  day?: string;
  /** 합반 본문/요일존에만 실림(합반 구성 반들) — 멤버의 카드 내 드롭 = 자기 반 요일편집으로 재해석. */
  memberClassIds?: string[];
};

/**
 * 드롭 의미 해석 — 규칙 순서가 결정적:
 * 1. 멤버 재해석(최우선·통과): 드롭존 memberClassIds에 출발 반이 있으면 자기 반 요일/공통 편집
 *    ({toClassId: fromClassId}) — 절대 no-op 하지 않음(진짜 no-op은 caller의 sameDaySet 판정).
 * 2. 소속 반 이동 차단: 대상 반 ∈ blockingClassIds면 null(이미 열린 수강 → 저장 시 GiST 실패 방지).
 * 3. 기본: 대상 반으로 이동(기존 동작 — 외부 학생·일반 셀).
 * ⚠️ 반환 계약: {toClassId, day}만 — caller는 toSlotId/toClassName을 overData에서 그대로 유지
 *    (합반 본문 드롭의 toSlotId=대표 slot.id가 전입예정 배지 근거).
 */
export function resolveDropTarget(
  active: DropActiveData,
  over: DropOverData,
): { toClassId: string; day?: string } | null {
  const from = active.classId;
  const target = over.classId;
  if (!target) return null;
  if (from && over.memberClassIds?.includes(from)) {
    return { toClassId: from, day: over.day }; // 합반 멤버의 카드 내 드롭 = 자기 반 요일/공통 편집
  }
  // ⚠️ 소속 차단은 **다른 반**으로의 이동에만 — 자기 반(target===from) 드롭은 같은-반 요일편집 경로
  // (caller의 sameDaySet 판정 + updateEnrollmentsAttendanceBatch, GiST 무관)라 통과시켜야 한다.
  // blockingClassIds엔 항상 자기 반이 포함되므로 이 예외가 없으면 합반 행을 자기 반의 다른 셀(일반 셀,
  // memberClassIds 없음)로 끄는 기존 요일편집 제스처가 무음 no-op이 된다(적대리뷰 확정).
  if (target !== from && active.blockingClassIds?.includes(target)) return null;
  return { toClassId: target, day: over.day };
}
