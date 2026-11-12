/**
 * 퇴원생 관리 차트 줄 ↔ 에이와 줄 잇기 — 퇴원관리(`sheet-exit-rows.ts`)와 운영실(`sheet-withdrawals.ts`)이 같은 규칙을 쓴다(순수).
 *
 * - **과목마다 시트를 쓰는 달** = 그 과목 줄이 시트에 처음 나온 달 ~ `SHEET_LAST_MONTH`. 그 밖(예: 영어 줄이 없던 1월)은 에이와 줄 그대로.
 * - 잇는 순서(전체 줄에 대해 한 단계씩): 이름 정확·같은 달 → 이름 정확·앞뒤 한 달 → 동명이인 알파벳 뗀 이름·같은 달 → 그 이름·앞뒤 한 달.
 *   🔴 한 줄씩 앞뒤 달까지 바로 잡으면, 8월 시트 줄이 9월에 센 에이와 줄을 가로채 9월 시트 줄이 짝을 잃는다(적대 리뷰 2026-11-11).
 * - 짝을 못 찾은 시트 줄이 '과목만 끊은 것'인지 = 그 학생이 지금 재원·휴원이거나 에이와 퇴원 줄이 다른 달에 있다(`StudentNames`).
 */
import { nameKey, SHEET_LAST_MONTH, type SheetExitRecord } from "./sheet-teachers";

export const monthOf = (d: string | null | undefined) => (d ? d.slice(0, 7) : null);
export const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
export const monthEnd = (ym: string, today: string) => {
  const [y, m] = ym.split("-").map(Number);
  const end = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
  return end > today ? today : end;
};

/** 과목 → 시트를 쓰기 시작한 달. 과목을 모르면(null) 어느 과목이든 시트가 덮는 달인지. */
export function sheetCoverage(records: readonly SheetExitRecord[]): (subject: string | null, month: string | null) => boolean {
  const first = new Map<string, string>();
  for (const r of records) if (!first.has(r.subject) || r.month < first.get(r.subject)!) first.set(r.subject, r.month);
  const earliest = [...first.values()].sort()[0];
  return (subject, month) => {
    if (!month || month > SHEET_LAST_MONTH) return false;
    const from = subject === null ? earliest : first.get(subject);
    return !!from && month >= from;
  };
}

/**
 * 지점 학생 전부의 이름·상태·등록일·퇴원일 — 짝 없는 시트 줄이 '과목만 끊은 것'인지 가린다(`looksLikeSubjectEnd`).
 * 🔴 지금 상태 하나로 가리면 그만뒀다 다시 등록한 학생의 지난 퇴원이 사라진다(적대 리뷰 2026-11-11) — 등록일·퇴원일로 그때를 본다.
 * 화면·기간과 무관한 한 벌이라 퇴원관리·운영실(6개월·긴 창)이 같은 답을 낸다.
 */
export type StudentNames = {
  /** 이름(정확 키) → 그 이름 학생들. */
  exact: ReadonlyMap<string, readonly StudentLife[]>;
  /** 동명이인 알파벳 뗀 키 → 그 학생들(정확한 이름이 없을 때만). */
  loose: ReadonlyMap<string, readonly StudentLife[]>;
};
export type StudentLife = {
  active: boolean;
  enrolledAt: string | null;
  withdrawnAt: string | null;
  /** '재원 복구' 날짜들(감사 로그 `student_restore`) — 복구는 퇴원일을 지우고 처음 등록일은 그대로 둔다. */
  restoredAt: readonly string[];
};

export function studentNamesOf(
  rows: readonly { id?: string; name: string; status: string; enrolled_at: string | null; withdrawn_at: string | null }[],
  restores: ReadonlyMap<string, readonly string[]> = new Map(),
): StudentNames {
  const exact = new Map<string, StudentLife[]>();
  const loose = new Map<string, StudentLife[]>();
  for (const r of rows) {
    const life = {
      active: r.status === "enrolled" || r.status === "on_hold",
      enrolledAt: r.enrolled_at?.slice(0, 10) ?? null,
      withdrawnAt: r.withdrawn_at?.slice(0, 10) ?? null,
      restoredAt: (r.id ? restores.get(r.id) : undefined) ?? [],
    };
    for (const [map, key] of [[exact, nameKey(r.name)], [loose, nameKey(r.name, true)]] as const) map.set(key, [...(map.get(key) ?? []), life]);
  }
  return { exact, loose };
}

export const EMPTY_STUDENT_NAMES: StudentNames = { exact: new Map(), loose: new Map() };

/**
 * 시트 줄마다 짝(에이와 줄 번호) — 없으면 -1. `candidate(row, rec)` = 그 줄이 짝이 될 수 있나(과목·시트 달 · 호출부 규칙).
 * `monthsOf(row)` = 그 줄을 달로 볼 날짜들(센 달 · 실제 날짜의 달). 이름 키는 한 번만 계산해 이름별로 묶는다(매 요청 · 30초 갱신).
 */
export function matchSheet<R>(
  records: readonly SheetExitRecord[],
  rows: readonly R[],
  opts: { nameOf: (r: R) => string; monthsOf: (r: R) => (string | null)[]; candidate: (r: R, rec: SheetExitRecord) => boolean },
): number[] {
  const pick = records.map(() => -1);
  const taken = new Set<number>();
  const byKey = [new Map<string, number[]>(), new Map<string, number[]>()] as const; // [정확, 느슨]
  const months = rows.map((r) => opts.monthsOf(r));
  rows.forEach((r, j) => {
    for (const loose of [0, 1] as const) {
      const k = nameKey(opts.nameOf(r), loose === 1);
      byKey[loose].set(k, [...(byKey[loose].get(k) ?? []), j]);
    }
  });
  const steps: [0 | 1, number[]][] = [[0, [0]], [0, [-1, 1]], [1, [0]], [1, [-1, 1]]];
  for (const [loose, shifts] of steps) {
    records.forEach((rec, i) => {
      if (pick[i] !== -1) return;
      const want = shifts.map((s) => shiftMonth(rec.month, s));
      const at = (byKey[loose].get(nameKey(rec.name, loose === 1)) ?? []).find(
        (j) => !taken.has(j) && months[j]!.some((m) => !!m && want.includes(m)) && opts.candidate(rows[j]!, rec),
      );
      if (at !== undefined) {
        pick[i] = at;
        taken.add(at);
      }
    });
  }
  return pick;
}

/**
 * 짝 없는 시트 줄이 '과목만 끊은 것'인가 — 그 이름 학생(정확한 이름 → 없으면 알파벳 뗀 이름)이 그 달 뒤에도 다녔다:
 * 지금 다니고 그 달 말 전에 등록했거나, 퇴원일이 그 달 다음 달보다 뒤다. 그 이름 학생이 없으면 퇴원으로 본다.
 * 🔴 그 달 뒤에 '재원 복구'된 학생은 그 달에 그만뒀다가 돌아온 것 — 퇴원으로 본다(적대 리뷰 2026-11-11).
 */
export function looksLikeSubjectEnd(rec: SheetExitRecord, names: StudentNames): boolean {
  const lives = names.exact.get(nameKey(rec.name)) ?? names.loose.get(nameKey(rec.name, true)) ?? [];
  const end = monthEnd(rec.month, "9999-12-31");
  const after = shiftMonth(rec.month, 1);
  const start = `${rec.month}-01`;
  return lives.some(
    (l) =>
      !l.restoredAt.some((d) => d >= start) &&
      ((l.active && (!l.enrolledAt || l.enrolledAt <= end)) || (!!l.withdrawnAt && l.withdrawnAt.slice(0, 7) > after)),
  );
}
