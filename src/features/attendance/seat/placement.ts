/**
 * 자리(랩실) 출석부의 **배치(placement)** — 순수 규칙(IO 없음, Vitest).
 *
 * 원장 2026-09-10: *"드래그로 학생 이동할수 있게 /seat/lab 에서. 대신 이것도 감사로그에 남아야함.
 * 클릭으로 출결되는거랑 중복액션되지않게 잘 분리해서"* → *"'초기화' 기능으로 원상태로 돌아갈 수 있게
 * 드래그한것을"* → *"반별 '초기화' 단체 '초기화'"*.
 *
 * ⚠️ 2026-09-11 원장 *"LAB실에서 내가 드래그하고 싶은건, '다른 시간대'의 수업임. 같은 시간대의 수업으로 옮기고 싶은게
 *    아니야."* — 배치를 **새로 만드는** 드래그는 없앴다. 이 모듈에 남은 것은 이미 있는 줄의 표시·[초기화] 규칙과, 교시
 *    이동 드래그가 함께 쓰는 문턱(`SEAT_DRAG_THRESHOLD_PX`·`isSeatDragGesture`)·찍힌 카드 차단(`seatMoveBlockReason`)이다.
 *
 * 🔴🔴 **배치는 출결 귀속이 아니다.** 이 화면은 한 방(랩실 603호)에 여러 반이 같은 시각에 들어오는
 *    자리라, 아이가 제 반 묶음이 아닌 옆 묶음에 앉는 일이 생긴다. 드래그가 바꾸는 것은 **그 자리·그 날짜·
 *    그 교시에 카드가 어느 반 묶음에 놓이는가**뿐이고, `attendance_records.class_id`(= 그 학생의 수강 반)는
 *    한 글자도 바뀌지 않는다. 그래서:
 *      · 시수·급여·회차·월별 출석부·반별 출석부가 **전부 그대로**다(돈 축을 건드리지 않는다).
 *      · 옮긴 카드에도 **원래 반 표식**을 달아 화면이 거짓말을 하지 않는다(`movedFromClassId`).
 *      · 초기화 = 그 배치 줄을 지우는 것 = 원래 반(수강·시간표가 정한 반)으로 자동 복귀. 되돌릴 값을
 *        따로 저장해 두지 않으므로 "근거 없는 복원"이 원리적으로 불가능하다.
 * 🔴 **수강(enrollments) 반이동이 아니다** — `move_enrollments_batch`·적용일·GiST 제약은 이 파일과 무관하다.
 *    자리 화면은 출결 전용이라는 상위 결정(2026-08-19) 그대로다.
 * 🔴 **명단 밖 학생은 대상이 아니다** — 옮길 학생도, 놓을 반도 **그 교시 명단 안**에 있어야 한다(보강처럼
 *    학원 전체에서 학생을 끌어오는 경로를 자리 화면에 만들지 않는다).
 */

/** 배치 한 줄 — (자리·날짜·교시·학생) 하나에 최대 한 줄(DB 유니크와 같은 grain). */
export type SeatPlacement = {
  studentId: string;
  /** 원래 반 = 수강·시간표가 정한 반. **출결은 언제나 이 반으로 저장된다.** */
  fromClassId: string;
  /** 지금 카드가 놓인 반 묶음. */
  toClassId: string;
};

/** 배치를 얹기 전의 명단 한 묶음 — 이 모듈은 `classId`와 학생 `id`만 본다. */
export type PlacementRoster<S> = { classId: string; students: readonly S[] };

/** 배치를 얹은 뒤의 학생 — 어디서 왔는지를 카드가 스스로 안다. */
export type PlacedStudent<S> = S & {
  /**
   * 출결을 저장할 반(= 원래 반). 옮기지 않은 학생은 그 묶음의 `classId`와 같다.
   * 🔴 화면·저장은 묶음의 `classId`가 아니라 **이 값**을 써야 한다 — 안 그러면 옮긴 학생의 출결이
   *    남의 반으로 가고, 낙관 오버레이 키도 갈려 체크가 화면에서 사라진다.
   */
  homeClassId: string;
  /** 옮겨 온 학생이면 원래 반 id, 아니면 null(표식·초기화 대상 판정). */
  movedFromClassId: string | null;
};

/**
 * **출결이 찍힌 카드는 못 옮긴다** — 원장 2026-09-10 *"출결이 찍힌 학생은 드래그 절대 불가"*.
 *
 * 🔴 이유는 화면이 아니라 **기록**이다. 교시 간 이동([`period-choice.ts`](./period-choice.ts))은 그 학생을
 *    앞 교시에서 지우고 뒤 교시에 세우는데, 이미 찍힌 출결은 `slot_start`가 앞 교시로 박혀 있어 **아무도
 *    안 보는 칸에 고아로 남는다**(자리 시수는 그 행에서 나온다 = 조용한 시수 오차).
 * 🔴 **한 문장이다** — 교시 이동의 손잡이(화면)·놓을 곳 판정(`seatDropVerdict`)·서버 거절이 이 함수를 같이 쓴다
 *    (배치를 새로 만드는 드래그는 2026-09-11로 없어졌다).
 * 🔑 **빠져나갈 문은 남는다** — [초기화]는 드래그가 아니라 버튼이고 출결을 한 줄도 안 건드린다
 *    (출결은 애초에 `homeClassId`에 저장돼 있어 카드가 되돌아가도 그대로다). 체크를 지우면 다시 잡힌다.
 */
export const SEAT_MOVE_MARKED_ERROR =
  "출결이 찍힌 학생은 옮길 수 없습니다 — 체크를 지운 뒤 옮기세요";

/** 이 카드를 못 옮기는 이유(없으면 null) — 화면(비활성·툴팁)과 서버(거절)가 같은 문장을 쓴다. */
export function seatMoveBlockReason(status: string | null | undefined): string | null {
  return status ? SEAT_MOVE_MARKED_ERROR : null;
}

/** 드래그로 칠 최소 이동 거리(px) — 이보다 덜 움직이면 **클릭(출결 토글)**이다. */
export const SEAT_DRAG_THRESHOLD_PX = 5;

/**
 * 이 포인터 움직임을 드래그로 볼 것인가 — 문턱 **초과**만 드래그다(원장 *"클릭으로 출결되는거랑
 * 중복액션되지않게"*).
 *
 * 🔑 dnd-kit `PointerSensor`의 `activationConstraint: { distance }`와 **같은 기하**(유클리드 거리, 초과)로
 *    맞춘다 — 한쪽이 축별 비교(|dx|≥T)면 대각선으로 살짝 끈 동작에서 "드래그는 시작됐는데 클릭도
 *    함께 나가는" 이중 액션이 생긴다(dx=4,dy=4는 유클리드 5.66).
 */
export function isSeatDragGesture(dx: number, dy: number, threshold = SEAT_DRAG_THRESHOLD_PX): boolean {
  return dx * dx + dy * dy > threshold * threshold;
}

/**
 * 그 교시 명단에서 이 학생의 **원래 반** — 없거나(명단 밖) 둘 이상이면 null.
 * 🔴 둘 이상은 "모른다"로 친다 — 같은 교시에 두 반으로 잡힌 학생을 옮기면 어느 반의 출결인지 갈린다.
 */
export function seatHomeClassOf<S extends { id: string }>(
  rosters: readonly PlacementRoster<S>[],
  studentId: string,
): string | null {
  const hit = rosters.filter((r) => r.students.some((s) => s.id === studentId));
  return hit.length === 1 ? hit[0]!.classId : null;
}

/**
 * 배치를 명단에 얹는다 — **서버(판정)와 화면(표시)이 같은 함수를 쓴다**.
 *
 * 반영되지 않는 줄(`stale`): 원래 반이 그 교시 명단과 안 맞거나(수강이 그새 바뀜), 놓을 반이 이 교시에
 * 없거나, 같은 반으로의 이동. 🔴 **조용히 버리는 게 아니라 갈라서 돌려준다** — 초기화 건수는 실제로
 * 반영된 것(`applied`)만 세야 버튼의 "N명"이 서버가 지우는 수와 맞는다.
 */
export function applySeatPlacements<R extends PlacementRoster<{ id: string }>>(
  rosters: readonly R[],
  placements: readonly SeatPlacement[],
): {
  rosters: Array<Omit<R, "students"> & { students: PlacedStudent<R["students"][number]>[] }>;
  applied: SeatPlacement[];
  stale: SeatPlacement[];
} {
  type S = R["students"][number];
  const classIds = new Set(rosters.map((r) => r.classId));
  const applied: SeatPlacement[] = [];
  const stale: SeatPlacement[] = [];
  const seen = new Set<string>();
  for (const p of placements) {
    const home = seatHomeClassOf(rosters, p.studentId);
    const ok =
      !seen.has(p.studentId) &&
      home !== null &&
      home === p.fromClassId &&
      classIds.has(p.toClassId) &&
      p.fromClassId !== p.toClassId;
    if (ok) {
      seen.add(p.studentId);
      applied.push(p);
    } else {
      stale.push(p);
    }
  }

  const movedOut = new Map<string, SeatPlacement>(applied.map((p) => [p.studentId, p]));
  const incoming = new Map<string, SeatPlacement[]>();
  for (const p of applied) incoming.set(p.toClassId, [...(incoming.get(p.toClassId) ?? []), p]);

  const byStudent = new Map<string, S>();
  for (const r of rosters) for (const s of r.students) if (!byStudent.has(s.id)) byStudent.set(s.id, s);

  const next = rosters.map((r) => {
    const stay = r.students
      .filter((s) => !movedOut.has(s.id))
      .map((s) => ({ ...s, homeClassId: r.classId, movedFromClassId: null }) as PlacedStudent<S>);
    // 🔑 옮겨 온 학생은 **명단 끝에** 붙인다 — 원래 순서(학년·이름) 안에 섞어 넣으면 "이 아이가 손님"이
    //    라는 사실이 사라진다. 순서는 `applied` 순(= DB 정렬)이라 서버·화면이 같은 화면을 그린다.
    const guests = (incoming.get(r.classId) ?? []).flatMap((p) => {
      const s = byStudent.get(p.studentId);
      return s ? [{ ...s, homeClassId: p.fromClassId, movedFromClassId: p.fromClassId } as PlacedStudent<S>] : [];
    });
    return { ...r, students: [...stay, ...guests] };
  });

  return { rosters: next, applied, stale };
}

/**
 * 초기화 대상 — `classId`를 주면 **그 묶음으로 옮겨 온 학생만**, 없으면 그 교시 전체.
 * 🔴 반별과 전체가 **같은 함수·같은 목록**을 본다(두 벌로 만들면 언젠가 한쪽만 고쳐진다). 그래서
 *    반별 건수의 합은 항상 전체 건수와 같다(가드가 잠근다).
 */
export function seatResetTargets(applied: readonly SeatPlacement[], classId?: string): SeatPlacement[] {
  return classId ? applied.filter((p) => p.toClassId === classId) : [...applied];
}

/** 묶음별 초기화 건수 — 머리줄 버튼 라벨(`초기화 2명`)이 그대로 쓴다. 0이면 키가 없다(버튼 없음). */
export function seatResetCounts(applied: readonly SeatPlacement[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of applied) out[p.toClassId] = (out[p.toClassId] ?? 0) + 1;
  return out;
}

/*
 * ⚠️ 배치를 **새로 만드는** 판정(옛 `validateSeatMove`)과 그 쓰기(옛 `moveSeatStudent`)는 없앴다 — 원장 2026-09-11
 *    *"LAB실에서 내가 드래그하고 싶은건, '다른 시간대'의 수업임. 같은 시간대의 수업으로 옮기고 싶은게 아니야."*
 *    드래그의 뜻은 다른 시간 하나다([`drop-verdict.ts`](./drop-verdict.ts)). 이미 있는 줄의 표시·[초기화]는 남는다
 *    (지우면 이미 옮겨 둔 자리가 고아가 된다).
 */

/**
 * 서버가 준 배치 줄 + 화면의 낙관 오버레이를 합친다 — 화면이 보는 배치의 **단일 소스**.
 * 오버레이 값이 `null`이면 "배치 없음"(= 원래 반)이라, 초기화도 이 한 함수로 표현된다.
 */
export function mergeSeatPlacements<S extends { id: string }>(
  rosters: readonly PlacementRoster<S>[],
  serverRows: readonly SeatPlacement[],
  overlay: Readonly<Record<string, string | null>>,
): SeatPlacement[] {
  const out = serverRows.filter((p) => !(p.studentId in overlay));
  for (const [studentId, toClassId] of Object.entries(overlay)) {
    if (toClassId === null) continue;
    const home = seatHomeClassOf(rosters, studentId);
    if (home === null || home === toClassId) continue;
    out.push({ studentId, fromClassId: home, toClassId });
  }
  return out;
}
