import "server-only";

/**
 * JJ실 **'누적 암기 단어수' 자동 채우기** — 인재원 장기기억 단어수를 그 날 명단의 **빈 칸에만** 적는다
 * (원장 2026-09-21: *"api로 하루에한번이나 수동연계 버튼으로 자동 입력하게해줘"* → *"자동으로 해주고
 * 수동으로 가져와서 입력되게도해줘"*).
 *
 * 🔑 **무엇을 적나 = 장기기억 단어수**(`longTermWords` = 복습 간격 15일 이상, 인재원 장기기억 랭킹과 같은 기준).
 *    실측 2026-09-22: 선생님이 손으로 적어 온 값 67명 중 **66명**이 '본 단어(seenWords)'보다 이 값에 가까웠다.
 *    기간과 무관한 **지금** 값이라 언제 불러도 같은 숫자다(설명서 8번).
 * 🔴 **사람이 적어 둔 값은 덮지 않는다.** 그 칸엔 `150/200점 - STARTING 2`·`눈 아파서 조퇴` 같은 다른 기록이
 *    실제로 섞여 있다(실측 1,404행). 덮으면 그게 사라진다 — **빈 칸만** 채운다.
 * 🔴 **지금 값을 DB에서 다시 읽고 판단한다** — 화면이 넘긴 값을 믿으면 그 사이 선생님이 타이핑한 글자를 덮는다.
 * 🔴 짝(`students.ijw_student_id`)이 없으면 건너뛴다 — 이름으로 맞추지 않는다(인재원이 지점별로 갈려 같은
 *    이름·같은 반 이름이 여러 지점에 있다, 설명서 ①-2).
 * ⚠️ 인재원 호출은 **한 번**이다(학생마다 부르지 않는다) — 전교생 요약 한 방(설명서 8번, 실측 1.3초).
 * ⚠️ admin 클라이언트는 RLS를 우회한다 → 모든 조회·쓰기에 `tenant_id`를 건다([[#104]]).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { JJ_MARK_COLUMN, JJ_MARK_ON_CONFLICT } from "@/features/attendance/seat/jj-fields";
import { IJW_SCHEMAS } from "../contract";
import { IJW_PATHS, ijwGet, type IjwFailure } from "./client";

/** 채울 칸 하나 — 그 날 명단(자리 출석부 하루치)이 그대로 준다. */
export type MemorizedTarget = { classId: string; studentId: string; slotStart: string };

export type MemorizedFill = {
  ok: true;
  /** 새로 적은 칸. */
  filled: number;
  /** 이미 적혀 있어 **그대로 둔** 칸(사람이 쓴 값을 덮지 않았다는 사실). */
  kept: number;
  /** 인재원 짝이 없어 건너뛴 학생 수(칸 기준). */
  unlinked: number;
  /** 짝은 있는데 인재원에 그 학생이 없어 건너뛴 칸(테스트 계정·퇴원 등). */
  noData: number;
  /** 그 날 명단 칸 수. */
  targets: number;
};

export type MemorizedFillResult = MemorizedFill | IjwFailure | { ok: false; kind: "local"; message: string; detail?: string };

const EMPTY: MemorizedFill = { ok: true, filled: 0, kept: 0, unlinked: 0, noData: 0, targets: 0 };

type MarkRow = { class_id: string; student_id: string; slot_start: string | null; memorized_words: string | null };

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
  const targets = args.targets.map((t) => ({ ...t, slotStart: t.slotStart.slice(0, 5) }));
  if (!targets.length) return EMPTY;

  const admin = createAdminClient();
  const studentIds = [...new Set(targets.map((t) => t.studentId))];

  // ① 지금 DB에 적힌 값 — 화면이 넘긴 값이 아니라 **여기서 읽은 값**으로 빈 칸을 가린다.
  const marks = await fetchInChunks<MarkRow>(studentIds, async (chunk) => {
    const { data, error } = await admin
      .from("class_sheet_student_marks")
      .select("class_id, student_id, slot_start, memorized_words")
      .eq("tenant_id", args.tenantId)
      .eq("mark_date", args.date)
      .in("student_id", chunk);
    return { data: (data ?? []) as MarkRow[], error };
  });
  const written = new Set(
    marks
      .filter((m) => (m.memorized_words ?? "").trim() !== "" && m.slot_start)
      .map((m) => cellKey(m.class_id, m.student_id, String(m.slot_start))),
  );

  const pending = targets.filter((t) => !written.has(cellKey(t.classId, t.studentId, t.slotStart)));
  const kept = targets.length - pending.length;
  if (!pending.length) return { ...EMPTY, kept, targets: targets.length };

  // ② 짝 — 짝 없는 학생은 인재원에서 찾을 길이 없다.
  const links = await fetchInChunks<{ id: string; ijw_student_id: string | null }>(
    [...new Set(pending.map((t) => t.studentId))],
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

  // ③ 인재원 한 번 — 전교생 요약(장기기억은 기간과 무관한 '지금' 값이라 기간을 비워 둔다).
  const res = await ijwGet(args.tenantId, IJW_PATHS.studySummary(), IJW_SCHEMAS.studySummary);
  if (!res.ok) return res;
  const wordsOf = new Map(res.data.students.map((s) => [s.ijwId, s.longTermWords]));

  const now = new Date().toISOString();
  const col = JJ_MARK_COLUMN.memorizedWords;
  const payload: Record<string, unknown>[] = [];
  let unlinked = 0;
  let noData = 0;
  for (const t of pending) {
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
    payload.push({
      tenant_id: args.tenantId,
      class_id: t.classId,
      student_id: t.studentId,
      mark_date: args.date,
      slot_start: t.slotStart,
      [col]: String(words),
      updated_by: args.actorId,
      updated_at: now,
    });
  }
  if (!payload.length) {
    return { ok: true, filled: 0, kept, unlinked, noData, targets: targets.length };
  }

  // ④ upsert — **보내는 칸만** 바뀐다(태도·듣기·특이사항은 그대로다). 빈 칸만 골라 왔으므로 덮는 값이 없다.
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
  return { ok: true, filled: payload.length, kept, unlinked, noData, targets: targets.length };
}

/** 결과 한 줄(화면 토스트·크론 로그 공용) — 무엇을 했고 무엇을 안 했는지 같은 문장으로 말한다. */
export function memorizedFillNotice(r: MemorizedFill): string {
  const parts = [`${r.filled}칸 채움`];
  if (r.kept) parts.push(`${r.kept}칸은 이미 적혀 있어 그대로`);
  if (r.unlinked) parts.push(`인재원 짝 없음 ${r.unlinked}칸`);
  if (r.noData) parts.push(`인재원에 기록 없음 ${r.noData}칸`);
  return parts.join(" · ");
}
