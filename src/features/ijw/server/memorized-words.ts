import "server-only";

/**
 * JJ실 **'누적 암기 단어수' 자동 채우기** — SRS(인재원) **지금까지 학습한 단어 수**를 그 날 명단 칸에 적는다
 * (원장 2026-09-21: *"api로 하루에한번이나 수동연계 버튼으로 자동 입력하게해줘"* → *"자동으로 해주고
 * 수동으로 가져와서 입력되게도해줘"* / 2026-09-28: *"최신버전으로 srs 업데이트 뭐 해서 가져와서
 * 자동기입되게 하는 기능 추가"*).
 *
 * 🔑 **무엇을 적나 = 본 단어 `seenWords`**(= 인재원 랭킹 화면의 *"지금까지 학습한 단어 수"*).
 *    🔴 **2026-09-28 원장이 `longTermWords`(장기기억)에서 갈아탔다** — *"지금까지 학습한 단어수로 할꺼임"*.
 *    2026-09-22엔 "손으로 적어 온 값 67명 중 66명이 장기기억에 가깝다"는 실측으로 장기기억을 골랐지만,
 *    그 손 값들이 **9/6에 적힌 뒤 '내용 복사'로 흘러온 낡은 값**이었음이 드러나(짝 없는 학생 53명) 근거가
 *    무너졌고, 원장이 보는 기준 화면은 랭킹이다. **되돌리지 말 것.**
 *    ⚠️ `newWords`(새 단어)는 **기간 지표**(`kpi` 블록 안)라 대상이 아니다. `seenWords`·`longTermWords`만
 *    `kpi` 밖의 **기간 무관 누적값**이고(contract.ts `Study`), 화면도 `장기기억 = 본 단어 N개 중 M%`로
 *    그려서 seenWords가 모수임을 보인다(sheet-model.ts). 그래서 기간을 비워 불러도 '지금까지'가 나온다.
 * 🔴 **무엇을 덮고 무엇을 지킬지는 [`memorized-cell.ts`](../memorized-cell) 한 곳**이 정한다 — 빈 칸은 채우고,
 *    **숫자만 든 칸은 최신값으로 갱신하고, 글자가 섞인 칸은 손대지 않는다**(그 칸엔 `150/200점 - STARTING 2`·
 *    `눈 아파서 조퇴` 같은 다른 기록이 실제로 섞여 있다 — 실측 1,507칸 중 134칸). **모드는 호출부가 고르지
 *    않는다**: 지난 날 칸은 그 날의 기록이라 빈 칸만 채운다(자세한 근거는 그 파일 머리말).
 * 🔴 **지금 값을 DB에서 다시 읽고 판단한다** — 화면이 넘긴 값을 믿으면 그 사이 선생님이 타이핑한 글자를 덮는다.
 * 🔴 짝(`students.ijw_student_id`)이 없으면 건너뛴다 — 이름으로 맞추지 않는다(인재원이 지점별로 갈려 같은
 *    이름·같은 반 이름이 여러 지점에 있다, 설명서 ①-2).
 * ⚠️ 인재원 호출은 **한 번**이다(학생마다 부르지 않는다) — 전교생 요약 한 방(설명서 8번, 실측 1.3초).
 * ⚠️ admin 클라이언트는 RLS를 우회한다 → 모든 조회·쓰기에 `tenant_id`를 건다([[#104]]).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { JJ_MARK_COLUMN, JJ_MARK_ON_CONFLICT } from "@/features/attendance/seat/jj-fields";
import {
  cellText,
  memorizedCellPlan,
  memorizedFillMode,
  type MemorizedFillMode,
} from "../memorized-cell";
import { IJW_SCHEMAS } from "../contract";
import { IJW_PATHS, ijwGet, type IjwFailure } from "./client";

/** 채울 칸 하나 — 그 날 명단(자리 출석부 하루치)이 그대로 준다. */
export type MemorizedTarget = { classId: string; studentId: string; slotStart: string };

export type MemorizedFill = {
  ok: true;
  /** 이번 실행이 덮어도 되는 실행이었나 — 화면 문구가 "갱신"과 "채움"을 갈라 말한다. */
  mode: MemorizedFillMode;
  /** 비어 있어 **새로 적은** 칸. */
  filled: number;
  /** 숫자가 들어 있었고 **최신값으로 바꾼** 칸. */
  updated: number;
  /** 숫자가 이미 최신이라 쓰지 않은 칸(헛 upsert를 안 만든다). */
  same: number;
  /** 글자가 섞여 있어 **손대지 않은** 칸 + 지난 날이라 그대로 둔 칸(사람이 쓴 값을 덮지 않았다는 사실). */
  kept: number;
  /** 인재원 짝이 없어 건너뛴 학생 수(칸 기준). */
  unlinked: number;
  /** 짝은 있는데 인재원에 그 학생이 없어 건너뛴 칸(테스트 계정·퇴원 등). */
  noData: number;
  /** 그 날 명단 칸 수. */
  targets: number;
  /**
   * 이번에 **실제로 적은 칸**(채움 + 갱신) — 호출부가 화면 state에 그대로 머지한다.
   * 🔴 ECS 시트의 학생 기록은 `useState`라 `router.refresh()`로는 안 바뀐다(sheet-client `applyCarried`
   *    각주) — 이 값을 안 돌려주면 강사는 "눌렀는데 칸이 그대로"로 본다.
   */
  written: readonly { studentId: string; slotStart: string; value: string }[];
};

export type MemorizedFillResult =
  | MemorizedFill
  | IjwFailure
  | { ok: false; kind: "local"; message: string; detail?: string };

const EMPTY: Omit<MemorizedFill, "mode"> = {
  ok: true,
  filled: 0,
  updated: 0,
  same: 0,
  kept: 0,
  unlinked: 0,
  noData: 0,
  targets: 0,
  written: [],
};

type MarkRow = {
  class_id: string;
  student_id: string;
  slot_start: string | null;
  memorized_words: string | null;
};

/** "HH:MM:SS"·"HH:MM" 어느 쪽으로 저장돼 있어도 같은 칸으로 본다(저장은 `hhmm`으로 맞춰 들어온다). */
const cellKey = (classId: string, studentId: string, slot: string) =>
  `${classId}|${studentId}|${slot.slice(0, 5)}`;

export async function fillMemorizedWords(args: {
  tenantId: string;
  date: string;
  targets: readonly MemorizedTarget[];
  /** 누가 적었나 — 수동은 누른 사람, 자동(크론)은 null(사람이 적었다고 지어내지 않는다). */
  actorId: string | null;
}): Promise<MemorizedFillResult> {
  // 🔴 같은 칸이 두 번 들어오면 한 upsert 문에 같은 충돌 키가 둘이 되어 Postgres가 **문장 전체를 거부**한다
  //    ("cannot affect row a second time") = 그 날 가져오기가 통째로 실패한다(carry-marks와 같은 함정).
  const byCell = new Map<string, MemorizedTarget>();
  for (const t of args.targets) {
    const slotStart = t.slotStart.slice(0, 5);
    byCell.set(cellKey(t.classId, t.studentId, slotStart), { ...t, slotStart });
  }
  const targets = [...byCell.values()];
  // 🔴 모드는 **서버가 날짜로 정한다** — 클라·크론이 고르면 자동과 수동이 다른 규칙을 쓴다.
  const mode = memorizedFillMode(args.date, kstToday());
  if (!targets.length) return { ...EMPTY, mode };

  const admin = createAdminClient();
  const studentIds = [...new Set(targets.map((t) => t.studentId))];

  // ① 지금 DB에 적힌 값 — 화면이 넘긴 값이 아니라 **여기서 읽은 값**으로 무엇을 지킬지 가린다.
  const marks = await fetchInChunks<MarkRow>(studentIds, async (chunk) => {
    const { data, error } = await admin
      .from("class_sheet_student_marks")
      .select("class_id, student_id, slot_start, memorized_words")
      .eq("tenant_id", args.tenantId)
      .eq("mark_date", args.date)
      .in("student_id", chunk);
    return { data: (data ?? []) as MarkRow[], error };
  });
  const currentOf = new Map<string, string>();
  for (const m of marks) {
    if (!m.slot_start) continue;
    currentOf.set(cellKey(m.class_id, m.student_id, String(m.slot_start)), cellText(m.memorized_words));
  }

  // ② 칸마다 무엇을 할지 — 판정은 순수 모듈 한 곳이고 `keep`은 여기서 끝난다(쓰기 후보에 아예 안 든다).
  const pending: { target: MemorizedTarget; plan: "fill" | "refresh"; current: string }[] = [];
  let kept = 0;
  for (const t of targets) {
    const current = currentOf.get(cellKey(t.classId, t.studentId, t.slotStart)) ?? "";
    const plan = memorizedCellPlan(current, mode);
    if (plan === "keep") kept += 1;
    else pending.push({ target: t, plan, current });
  }
  if (!pending.length) return { ...EMPTY, mode, kept, targets: targets.length };

  // ③ 짝 — 짝 없는 학생은 인재원에서 찾을 길이 없다.
  const links = await fetchInChunks<{ id: string; ijw_student_id: string | null }>(
    [...new Set(pending.map((p) => p.target.studentId))],
    async (chunk) => {
      const { data, error } = await admin
        .from("students")
        .select("id, ijw_student_id")
        .eq("tenant_id", args.tenantId)
        .in("id", chunk);
      return { data: (data ?? []) as { id: string; ijw_student_id: string | null }[], error };
    },
  );
  const ijwIdOf = new Map(links.map((r) => [r.id, (r.ijw_student_id ?? "").trim()]));

  // ④ 인재원 한 번 — 전교생 요약(본 단어는 기간과 무관한 '지금까지' 누적값이라 기간을 비워 둔다).
  const res = await ijwGet(args.tenantId, IJW_PATHS.studySummary(), IJW_SCHEMAS.studySummary);
  if (!res.ok) return res;
  const wordsOf = new Map(res.data.students.map((s) => [s.ijwId, s.seenWords]));

  const now = new Date().toISOString();
  const col = JJ_MARK_COLUMN.memorizedWords;
  const payload: Record<string, unknown>[] = [];
  const written: { studentId: string; slotStart: string; value: string }[] = [];
  let filled = 0;
  let updated = 0;
  let same = 0;
  let unlinked = 0;
  let noData = 0;
  for (const { target: t, plan, current } of pending) {
    const ijwId = ijwIdOf.get(t.studentId);
    if (!ijwId) {
      unlinked += 1;
      continue;
    }
    const words = wordsOf.get(ijwId);
    if (words == null) {
      noData += 1;
      continue;
    }
    const value = String(words);
    // 이미 최신이면 **쓰지 않는다** — 헛 upsert는 `updated_by`·`updated_at`만 흔들어 "누가 언제 고쳤나"를
    // 거짓으로 만든다(동시편집·감사 흐름이 그 값을 읽는다).
    if (plan === "refresh" && current === value) {
      same += 1;
      continue;
    }
    if (plan === "refresh") updated += 1;
    else filled += 1;
    written.push({ studentId: t.studentId, slotStart: t.slotStart, value });
    payload.push({
      tenant_id: args.tenantId,
      class_id: t.classId,
      student_id: t.studentId,
      mark_date: args.date,
      slot_start: t.slotStart,
      [col]: value,
      updated_by: args.actorId,
      updated_at: now,
    });
  }
  if (!payload.length) {
    return { ...EMPTY, mode, same, kept, unlinked, noData, targets: targets.length };
  }

  // ⑤ upsert — **보내는 칸만** 바뀐다(태도·듣기·특이사항은 그대로다).
  const { error } = await admin
    .from("class_sheet_student_marks")
    .upsert(payload, { onConflict: JJ_MARK_ON_CONFLICT });
  if (error) {
    return {
      ok: false,
      kind: "local",
      message: "단어수를 저장하지 못했습니다",
      detail: error.message,
    };
  }
  return { ok: true, mode, filled, updated, same, kept, unlinked, noData, targets: targets.length, written };
}

/**
 * 결과 한 줄(화면 토스트·크론 로그·감사로그 공용) — 무엇을 했고 **무엇을 안 했는지**까지 같은 문장으로 말한다.
 * ⚠️ "눌렀는데 아무 일도 없다"로 보이지 않게 채움 몫은 0칸이어도 항상 적는다.
 */
export function memorizedFillNotice(r: MemorizedFill): string {
  const parts = [`${r.filled}칸 채움`];
  if (r.updated) parts.push(`${r.updated}칸 갱신`);
  if (r.same) parts.push(`${r.same}칸은 이미 최신`);
  if (r.kept) parts.push(`${r.kept}칸은 그대로(메모·지난 날)`);
  if (r.unlinked) parts.push(`SRS 짝 없음 ${r.unlinked}칸`);
  if (r.noData) parts.push(`SRS에 기록 없음 ${r.noData}칸`);
  return parts.join(" · ");
}
