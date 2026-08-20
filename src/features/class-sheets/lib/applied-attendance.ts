/**
 * 상단 출석 스트립이 기록한 칸을 **ECS 화면 두 곳**(오늘 요약 카드 · 주간 시트)의 낙관 상태에 반영하는
 * 순수 함수(Vitest로 잠금).
 *
 * 원장 제보 2026-08-20 — ECS 오늘 면도 원스크린과 **완전히 같은 원인**이다: 두 화면 다 출결을
 * `useState(초기값)`으로 마운트 1회만 복사하고, 스트립의 `router.refresh()`는 클라 state를 보존한다.
 *
 * 재료는 서버 액션 응답의 `applied` — 게이트·기존 기록에 걸려 빠진 칸은 실려 오지 않으므로 여기서
 * "정말 기록됐나"를 다시 판단하지 않는다.
 *
 * 공통 규칙(두 함수 모두):
 *  · 자기 것만 — 카드/시트가 들고 있는 반이 아니면 무시(호출부가 반 집합을 넘긴다).
 *  · `inflight`(저장 중 키)는 **건너뛴다** — 내 낙관 쓰기가 뒤늦은 방송보다 이긴다.
 *  · `status`만 채택하고 `note`·`units`는 **건드리지 않는다**(스트립은 그 둘을 안 보낸다).
 *  · 바뀐 게 없으면 **입력 객체를 그대로 반환**(참조 동일) → 리렌더 0.
 */
import { normalizeSlotTime } from "./week";

export type AppliedCell = { studentId: string; classId: string };

/** 오늘 요약 카드의 낙관 출결 — `${classId}|${studentId}` → 상태·메모(today-board.tsx `AttState`). */
export type BoardAttState = Record<string, { status: string | null; note: string | null }>;

/**
 * 요약 카드 반영 — 카드는 **반×하루** 축이라 교시(`slot`)를 보지 않는다.
 *
 * @param att      현재 낙관 상태.
 * @param cells    서버가 기록한 칸.
 * @param status   기록한 상태.
 * @param classIds 이 보드가 그리는 반(그 밖은 무시 — 스트립은 그 날 내 전 교시를 다룬다).
 * @param inflight 저장 중인 `${classId}|${studentId}` 키.
 */
export function applyAppliedToBoardAtt(
  att: BoardAttState,
  cells: readonly AppliedCell[],
  status: string,
  classIds: ReadonlySet<string>,
  inflight: ReadonlySet<string>,
): BoardAttState {
  let next: BoardAttState | null = null;
  for (const c of cells) {
    if (!c?.studentId || !c?.classId || !classIds.has(c.classId)) continue;
    const key = `${c.classId}|${c.studentId}`;
    if (inflight.has(key)) continue;
    const before = att[key];
    // 아직 로컬에 없는 칸도 반영한다 — 카드가 서버 초기값(`s.attendance`)으로 폴백하므로, 여기 안 넣으면
    // 낡은 서버 값('미입력')이 계속 보인다(그게 바로 이 버그다).
    if (before && before.status === status) continue;
    next ??= { ...att };
    next[key] = { status, note: before?.note ?? null };
  }
  return next ?? att;
}

/** 주간 시트의 낙관 출결 — `${studentId}|${date}|${cell}` → 상태·메모·시수·저장축(queries.ts 규약). */
export type SheetAttState = Record<
  string,
  { status: string; note: string | null; units: number | null; slot: string | null }
>;

/**
 * 주간 시트 반영 — 시트만 **교시 칸**을 가진다.
 *
 * 🔑 칸 키 규칙은 서버(`queries.ts` `attendanceByStudentDate`)와 **글자 그대로 같아야** 한다:
 *    행에 교시가 있으면 그 교시, 없으면(옛 day-level `null`) **그 날의 첫 교시 칸**. 규칙을 새로 지어내면
 *    알약이 엉뚱한 교시 칸에 붙는다.
 * 🔴 값의 `slot`에는 **방송이 실어 온 저장축 그대로**를 넣는다 — 시트의 후속 저장(`setAttendanceCell`)이
 *    이 값을 그대로 되돌려 보내 **제자리 갱신**을 하기 때문이다. 칸 키(첫 교시)를 여기에 넣으면 옛 null
 *    행 옆에 교시 행이 하나 더 생겨 같은 날 시수가 두 번 잡힌다.
 *
 * @param firstSlotByDate 그 날의 첫 교시(`HH:MM`) — 호출부가 `data.grid.days`에서 같은 방식으로 만든다.
 *        🔑 이 표가 곧 **이 시트가 그리는 날짜 목록**이다(그리드의 하루는 반드시 교시가 하나 이상이다) —
 *        없는 날짜는 붙일 칸이 없다는 뜻이라 통째로 건너뛴다(다른 주를 보고 있을 때 오늘 기록이 새는 것 방지).
 * @param inflight 저장 중인 `${studentId}|${date}|${cell}` 키.
 */
export function applyAppliedToSheetAtt(
  attendance: SheetAttState,
  cells: readonly AppliedCell[],
  input: { date: string; status: string; slot: string | null; classId: string },
  firstSlotByDate: Readonly<Record<string, string>>,
  inflight: ReadonlySet<string>,
): SheetAttState {
  const first = firstSlotByDate[input.date];
  if (!first) return attendance; // 이 시트가 그리지 않는 날
  // ⚠️ 저장축도 **정규화해서** 담는다 — 서버가 `slot`을 `normalizeSlotTime(raw)`로 내려주므로 여기서
  //    "16:20:00"을 그대로 담으면 같은 칸인데 값이 갈려 비교(아래 no-op 판정)와 제자리 갱신이 어긋난다.
  const slot = input.slot ? normalizeSlotTime(input.slot) : null;
  const cell = slot ?? first;
  let next: SheetAttState | null = null;
  for (const c of cells) {
    if (!c?.studentId || c.classId !== input.classId) continue;
    const key = `${c.studentId}|${input.date}|${cell}`;
    if (inflight.has(key)) continue;
    const before = attendance[key];
    if (before && before.status === input.status && before.slot === slot) continue;
    next ??= { ...attendance };
    next[key] = {
      status: input.status,
      // 메모·시수는 그대로 — 스트립은 둘 다 안 보낸다(새 행이면 서버에서도 null이다).
      note: before?.note ?? null,
      units: before?.units ?? null,
      slot,
    };
  }
  return next ?? attendance;
}
