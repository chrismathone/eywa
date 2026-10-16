/**
 * **배정 교재 줄의 미루기·당기기** — 순수(Vitest).
 *
 * 원장 2026-10-16(중등E_중1 SKY 제보 *"계획을 미루고 당기면 상태가 이상함"* → *"1번으로 작업해줘"*):
 * 같은 요일·교시끼리 한 주씩 옮기는 규칙([`planLessonShift`](./lesson-shift-chain.ts))은 **한 요일에만** 나가는
 * 교재에서만 맞다. 화 1·2차수 + 금 1차수처럼 요일을 번갈아 나가면 화요일 칸만 움직여 **차수 순서가 꼬이고**,
 * 당김을 두 번 누르면 차수가 지워지고, 월간계획(표식으로 다시 계산한 일정)과 실제 칸이 서로 다른 차수를 말한다.
 *
 * 🔑 **배정 교재 줄은 옮기지 않고 다시 깐다** — 표식을 반영한 일정(`expandPlans`)이 정본이고, 실제 칸은
 *    그 일정을 누른 칸부터 다시 따른다. 그래서 월간계획과 실제가 언제나 같은 순서를 말한다.
 * 🔑 **"배정 교재 줄"은 내용으로 알아본다** — 구분·교재명이 그 교재와 같고 진도·과제가 그 교재의 차수 문구
 *    (또는 한 교시에 이은 `A / B`)로만 이루어진 줄. 선생님이 손으로 고쳐 쓴 줄은 여기 안 걸려 **그 칸에 그대로
 *    남는다**(다시 깔지도, 요일 이동으로 옮기지도 않는다 — `isBookLine`).
 * 🔑 다시 까는 범위 = 누른 칸 ~ 그 교재 줄이 실제로 있는 마지막 날. 그 뒤는 아직 안 가져온 칸이라 손대지 않는다
 *    (밀려난 차수는 월간계획에 남아 있어 다음 [가져오기]에 들어온다).
 * 🔴 **지우는 건 옛 일정이 그 교재를 놓았던 칸뿐이다**(2026-10-16 실데이터 점검) — `Listening (NTA)`처럼 차수
 *    문구가 전부 `10개`인 교재는 교재가 끝난 뒤 칸에도 같은 문구를 선생님이 복사해 둔다. 새 일정에 그 칸이
 *    없다고 지우면 선생님이 적은 줄이 사라진다(실측: 브릿지 C 10/29). 옛 일정에 없던 칸의 줄은 새 일정이 그
 *    칸을 쓸 때만 고친다.
 * · 미룸: 누른 칸은 **그대로 둔다**(2026-10-15 결정 — 실제 한 수업으로 고쳐 적는 자리).
 * · 당김: 누른 칸도 새 일정으로 바뀐다.
 */
import { LESSON_JOIN } from "./plan-compare";

/** 실제 계획 줄 한 줄(평시). */
export type RelayLine = {
  id: string;
  date: string;
  /** `"HH:MM"` */
  slot: string;
  skillArea: string;
  lineNo: number;
  textbook: string | null;
  progress: string | null;
  homework: string | null;
};

/** 배정 교재 하나 — 줄을 알아볼 재료. */
export type RelayBook = {
  skillArea: string;
  title: string;
  /** 그 교재 차수들의 진도 문구(trim). */
  progressTexts: ReadonlySet<string>;
  homeworkTexts: ReadonlySet<string>;
};

/** 새 일정 한 칸(한 교시에 차수가 둘이면 이미 한 줄로 이은 값 — `mergeSameCellLessons`). */
export type RelayTarget = { date: string; slot: string; progress: string | null; homework: string | null };

export type RelayOp =
  | { op: "update"; id: string; progress: string | null; homework: string | null }
  | { op: "delete"; id: string }
  /** 빈 칸에 새로 쓴다 — 서버는 가져오기와 같은 RPC(빈 칸만 채움)로 쓴다. */
  | { op: "insert"; date: string; slot: string; progress: string | null; homework: string | null };

const cellKey = (date: string, slot: string) => `${date}|${slot}`;
const norm = (v: string | null | undefined) => String(v ?? "").trim().toLowerCase();
const clean = (v: string | null | undefined) => {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
};

/**
 * 값이 차수 문구들을 `LESSON_JOIN`으로 이은 것뿐인가(빈 값도 참). 차수 문구 자체에 `/`가 들어 있을 수 있어
 * 쪼개지 않고 **앞에서부터 맞춰 나간다**.
 */
export function composedOfLessons(value: string | null | undefined, known: ReadonlySet<string>): boolean {
  const v = String(value ?? "").trim();
  if (v === "") return true;
  const sep = LESSON_JOIN.trim();
  const walk = (rest: string): boolean => {
    if (rest === "") return true;
    for (const k of known) {
      if (k === "" || !rest.startsWith(k)) continue;
      const after = rest.slice(k.length).trimStart();
      if (after === "") return true;
      if (after.startsWith(sep) && walk(after.slice(sep.length).trimStart())) return true;
    }
    return false;
  };
  return walk(v);
}

/**
 * 이 줄이 그 교재의 줄인가(구분·교재명만) — 고쳐 쓴 줄도 포함한다. 이 줄들은 **요일 이동에서도 빠진다**:
 * 교재 진도는 교재 순서의 일이라, 고쳐 쓴 줄을 같은 요일끼리 옮기면 순서 꼬임이 그 줄에서 되살아난다.
 */
export function isBookLine(line: Pick<RelayLine, "skillArea" | "textbook">, book: RelayBook): boolean {
  return line.skillArea === book.skillArea && norm(line.textbook) === norm(book.title);
}

/** 이 줄이 그 교재의 **손대지 않은** 배정 줄인가(위 🔑) — 다시 깔리는 줄. */
export function isAssignedLine(line: RelayLine, book: RelayBook): boolean {
  return (
    isBookLine(line, book) &&
    composedOfLessons(line.progress, book.progressTexts) &&
    composedOfLessons(line.homework, book.homeworkTexts)
  );
}

/**
 * 한 교재의 실제 줄을 새 일정에 맞춘다.
 * @param lines   그 교재의 배정 줄(`isAssignedLine`) — 어느 날짜든 넘겨도 된다(누른 칸 앞은 안 본다).
 * @param targets 표식을 반영한 새 일정(이 교재만).
 */
export function planRelay(input: {
  kind: "skip" | "advance";
  date: string;
  slot: string;
  lines: readonly RelayLine[];
  targets: readonly RelayTarget[];
  /** 누르기 **전** 일정(같은 교재) — 지워도 되는 칸을 가른다(위 🔴). */
  previous: readonly Pick<RelayTarget, "date" | "slot">[];
}): { ops: RelayOp[]; end: string | null } {
  const pressed = cellKey(input.date, input.slot);
  const after = (k: string) => k >= pressed && !(input.kind === "skip" && k === pressed);
  const lines = input.lines.filter((l) => cellKey(l.date, l.slot) >= pressed);
  if (lines.length === 0) return { ops: [], end: null };
  const end = lines.map((l) => l.date).sort().at(-1)!;

  const linesByCell = new Map<string, RelayLine[]>();
  for (const l of lines) {
    const k = cellKey(l.date, l.slot);
    if (!after(k)) continue;
    linesByCell.set(k, [...(linesByCell.get(k) ?? []), l]);
  }
  const targetByCell = new Map<string, RelayTarget>();
  for (const t of input.targets) {
    const k = cellKey(t.date, t.slot);
    if (after(k) && t.date <= end) targetByCell.set(k, t);
  }

  const placedBefore = new Set(input.previous.map((t) => cellKey(t.date, t.slot)));
  const ops: RelayOp[] = [];
  const inserts: RelayOp[] = [];
  for (const k of [...new Set([...linesByCell.keys(), ...targetByCell.keys()])].sort()) {
    const have = [...(linesByCell.get(k) ?? [])].sort((a, b) => a.lineNo - b.lineNo);
    const want = targetByCell.get(k);
    if (!want) {
      if (placedBefore.has(k)) for (const l of have) ops.push({ op: "delete", id: l.id });
      continue;
    }
    const progress = clean(want.progress);
    const homework = clean(want.homework);
    const [first, ...rest] = have;
    if (!first) {
      inserts.push({ op: "insert", date: want.date, slot: want.slot, progress, homework });
      continue;
    }
    if (clean(first.progress) !== progress || clean(first.homework) !== homework) {
      ops.push({ op: "update", id: first.id, progress, homework });
    }
    for (const l of rest) ops.push({ op: "delete", id: l.id });
  }
  // 새로 쓰는 칸은 맨 뒤 — 지우고 고친 다음에 채워야 같은 칸의 옛 줄과 안 겹친다.
  return { ops: [...ops, ...inserts], end };
}

/**
 * 미룸·당김 표식을 어느 칸에 둘까 — **순(net) 횟수**만 맞으면 된다(`setLessonShift`의 규약 그대로).
 * · 누른 칸에 반대 표식이 있으면 그걸 지운다(미룸 뒤 당김 = 원래대로).
 * · 아니면 누른 칸부터 그 교재가 지나가는 칸(`sequence`) 중 **표식이 없는 첫 칸**에 둔다 — 같은 칸을 두 번
 *   누르면 다음 칸(화·금 교재면 이번 주 금요일)에 쌓여 두 칸만큼 밀린다.
 */
export function placeShiftMarker(input: {
  kind: "skip" | "advance";
  pressedKey: string;
  /** 누른 칸 이후 그 교재가 지나가는 칸 키(오름차순, 누른 칸 포함). */
  sequence: readonly string[];
  shifts: Readonly<Record<string, "skip" | "advance">>;
}): { op: "delete"; key: string } | { op: "set"; key: string } | null {
  const opposite = input.kind === "skip" ? "advance" : "skip";
  if (input.shifts[input.pressedKey] === opposite) return { op: "delete", key: input.pressedKey };
  const keys = [input.pressedKey, ...input.sequence.filter((k) => k > input.pressedKey)];
  const free = keys.find((k) => !input.shifts[k]);
  return free ? { op: "set", key: free } : null;
}
