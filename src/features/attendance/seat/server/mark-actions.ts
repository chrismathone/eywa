"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  auditValueChanged,
  clipAuditValue,
  markFieldLabel,
  parseSheetEdits,
  SEAT_JJ_EDIT_KINDS,
} from "@/features/class-sheets/lib/edit-audit";
import { logSeatAction } from "./audit";
import { normalizePlanText } from "@/features/class-sheets/lib/plan-codec";
import {
  JJ_MARK_COLUMN,
  JJ_MARK_MAXLEN,
  JJ_MARK_ON_CONFLICT,
  jjMarkLabel,
  parseJjMarkField,
  seatHasJjFields,
  type JjMarkField,
} from "../jj-fields";
import { hhmm, type SeatKey } from "../seat";
import { gateSeatWrite, rosterKeys } from "./gate";
import { logDbError } from "@/lib/supabase/db-error";

// 충돌 축은 `jj-fields.ts` 한 곳에서 온다 — 이 칸을 쓰는 문이 셋이라(손입력·영어 시트·인재원 자동) 갈리면 행이 쪼개진다.
const ON_CONFLICT = JJ_MARK_ON_CONFLICT;

function isMissingColumn(err: { code?: string; message?: string } | null, column: string): boolean {
  if (!err) return false;
  if (err.code === "PGRST204" || err.code === "42703") return true;
  return (err.message ?? "").includes(column) && /column|컬럼/i.test(err.message ?? "");
}

/**
 * JJ실 전용 칸 한 개 저장. 출결 행은 건드리지 않고, 자리 시수도 안 박는다.
 *
 * 기록은 영어 시트 JJ 칸과 같은 `class_sheet_student_marks`. 랩실(칸이 없는 자리)에서는 거부.
 * 🔴 듣기·단어를 동시에 적으면 둘 다 "새 행"으로 보이므로 **upsert**(select+insert는 unique 충돌).
 *
 * 🔵 **공개 PIN(비로그인)도 쓴다**(2026-08-19) — 로그인 없이 그 칸을 적는 게 `/seat/jj` 화면의 목적이다.
 *    화면이 그리는 칸을 서버가 거절하면 "되는 것처럼 보이는데 저장이 안 되는 칸"이 남는다. 보호는 출결
 *    쓰기와 **똑같이** 붙는다: 같은 PIN 쿠키(`gateSeatWrite`) · 오늘만 · 그날 그 교시 **명단 화이트리스트**.
 *    작성자는 키오스크와 같은 정직함으로 `updated_by = null`(로그인 없이 찍었다는 사실을 지어내지 않는다).
 */
export async function setSeatJjField(input: {
  seat: SeatKey;
  date: string;
  slotStart: string;
  classId: string;
  studentId: string;
  field: string;
  value: string | null;
}): Promise<{ ok: true } | { error: string }> {
  if (!seatHasJjFields(input.seat)) {
    return { error: "이 자리에는 기록 칸이 없습니다" };
  }
  const field = parseJjMarkField(input.field);
  if (!field) return { error: "잘못된 칸입니다" };

  const g = await gateSeatWrite(input.seat, input.date);
  if ("error" in g) return g;

  const slot = hhmm(input.slotStart);
  // 공개 PIN 경로는 세션이 없어 RLS로 명단을 못 읽는다 → admin + 쿠키의 tenantId(출결 쓰기와 같은 규약).
  const roster = await rosterKeys(input.seat, input.date, slot, g.via === "pin" ? g.tenantId : null, g.tenantId);
  if (!roster) return { error: "그 시각에는 이 자리 수업이 없습니다" };
  if (!roster.keys.has(`${input.classId}|${input.studentId}`)) {
    return { error: "이 교시 명단에 없는 학생입니다" };
  }

  const value = normalizePlanText(input.value);
  const maxLen = JJ_MARK_MAXLEN[field];
  if ((value?.length ?? 0) > maxLen) {
    return { error: `${jjMarkLabel(field)}은(는) ${maxLen}자 이내로 입력하세요` };
  }

  const admin = createAdminClient();
  const col = JJ_MARK_COLUMN[field];
  const { data: existing, error: readErr } = await admin
    .from("class_sheet_student_marks")
    .select("id, status, progress_note, score, listening_level, memorized_words")
    .eq("tenant_id", g.tenantId)
    .eq("class_id", input.classId)
    .eq("student_id", input.studentId)
    .eq("mark_date", input.date)
    .eq("slot_start", slot)
    .maybeSingle();
  if (readErr) {
    logDbError(readErr, "attendance.seat.setSeatJjField");
    return { error: "저장에 실패했습니다" };
  }
  if (!existing && value === null) return { ok: true };

  const now = new Date().toISOString();
  const { error } = await admin.from("class_sheet_student_marks").upsert(
    {
      tenant_id: g.tenantId,
      class_id: input.classId,
      student_id: input.studentId,
      mark_date: input.date,
      slot_start: slot,
      [col]: value,
      // 로그인 없이 적었으면 null — "누가 적었나"를 지어내지 않는다(키오스크·자리 출결과 같은 규약).
      updated_by: g.userId,
      updated_at: now,
    },
    { onConflict: ON_CONFLICT },
  );
  if (error) {
    if (isMissingColumn(error, col)) {
      return { error: `'${jjMarkLabel(field)}' 칸은 아직 준비 중입니다` };
    }
    return { error: "저장에 실패했습니다" };
  }

  // 이 저장 뒤의 행 모습 — **전부 비었을 때만** 행을 지운다(다른 칸이 남아 있으면 그대로 둔다).
  // ⚠️ `score`는 이 화면에 없는 칸이지만 **판정에는 넣는다**: 영어 시트에서 적어 둔 시험 점수가
  //    남아 있는데 여기서 듣기 칸을 비웠다고 행을 지우면 그 점수가 함께 사라진다.
  const colOf = (f: JjMarkField): string | null =>
    field === f ? value : ((existing as Record<string, string | null> | null)?.[JJ_MARK_COLUMN[f]] ?? null);
  const next = {
    status: colOf("attitude"),
    progress_note: colOf("progressNote"),
    score: existing?.score ?? null,
    listening_level: colOf("listeningLevel"),
    memorized_words: colOf("memorizedWords"),
  };
  if (Object.values(next).every((v) => v == null) && existing?.id) {
    await admin
      .from("class_sheet_student_marks")
      .delete()
      .eq("id", existing.id)
      .eq("tenant_id", g.tenantId);
  }

  revalidatePath("/attendance/seat");
  revalidatePath("/seat");
  revalidatePath("/ecs");
  return { ok: true };
}

/**
 * 자리 출석부 **JJ 칸 감사로그** — 칸을 떠날 때 한 줄(원장 결정 2026-09-14, 범위 확대).
 * 저장(`setSeatJjField`)은 타이핑 디바운스마다 불려 거기서 남기면 한 칸이 수십 줄이 된다 — 그래서 저장은 그대로
 * 두고, 칸을 떠나면 여기로 온다. 규약(모양 검증·변동 판정·자르기)은 강사 시트와 한 벌(`class-sheets/lib/edit-audit.ts`).
 *
 * 🔴 게이트는 저장과 **같은 문**(`gateSeatWrite` — 담당·메뉴 권한 또는 PIN 쿠키 · 오늘만)이고, 칸마다 그날 그 교시
 *    **명단 화이트리스트**를 다시 본다(`rosterKeys`). 모든 칸이 요청의 날짜·교시와 같아야 한다(게이트가 본 것과
 *    기록하는 것이 갈리지 않게).
 * 🔴 비로그인 PIN 문은 `logSeatAction` → `logActionAtDoor`(로그인된 기기면 그 계정, 아니면 `JJ실 PIN(비로그인)`).
 * 🔑 새 값은 DB에서 다시 읽는다(로그의 새 값이 DB와 어긋나지 않게) · 이전 값은 화면이 보던 값이다.
 * 반환은 "받았다"뿐 — 읽기·기록은 응답 뒤(`after`).
 */
export async function commitSeatJjEdits(input: {
  seat: SeatKey;
  date: string;
  slotStart: string;
  edits: unknown;
}): Promise<{ ok: true } | { error: string }> {
  if (!seatHasJjFields(input.seat)) return { error: "이 자리에는 기록 칸이 없습니다" };
  const edits = parseSheetEdits(input.edits, SEAT_JJ_EDIT_KINDS);
  if (!edits) return { error: "잘못된 요청입니다(편집 기록)" };
  const slot = hhmm(input.slotStart);
  const cells = edits.flatMap((e) => (e.cell.kind === "seatJj" ? [{ cell: e.cell, before: e.before }] : []));
  if (cells.some(({ cell }) => cell.date !== input.date || cell.slotStart !== slot)) {
    return { error: "잘못된 요청입니다(날짜·교시)" };
  }
  const gated = await gateSeatWrite(input.seat, input.date);
  if ("error" in gated) return gated;
  const g = gated;
  const seat = input.seat;
  const date = input.date;
  /** 감사 칸 이름 → 컬럼(학생 기록과 같은 행) — 화면의 태도(attitude)는 `status`로 들어온다. */
  const column = {
    status: "status",
    listeningLevel: "listening_level",
    memorizedWords: "memorized_words",
    progressNote: "progress_note",
  } as const;
  after(async () => {
    try {
      const roster = await rosterKeys(seat, date, slot, g.via === "pin" ? g.tenantId : null, g.tenantId);
      if (!roster) return;
      const admin = createAdminClient();
      await Promise.all(
        cells.map(async ({ cell, before }) => {
          if (!roster.keys.has(`${cell.classId}|${cell.studentId}`)) return;
          const { data, error } = await admin
            .from("class_sheet_student_marks")
            .select("*")
            .eq("tenant_id", g.tenantId)
            .eq("class_id", cell.classId)
            .eq("student_id", cell.studentId)
            .eq("mark_date", date)
            .eq("slot_start", slot)
            .maybeSingle();
          if (error) return;
          const row = data as Record<string, unknown> | null;
          // 🔴 이 문이 마지막으로 쓴 행만(계획 칸 `plan-edit-audit.ts`와 같은 규칙) — 저장(`setSeatJjField`)이 쓰는 작성자
          //    값과 같은지(`g.userId`, PIN 문이면 null)로 본다. 안 보면 그 사이 남(영어 시트 등)이 고친 값이 이 사람(문)
          //    이름으로 남는다. `select("*")`에 updated_by가 들어 있다(칸 부재 마이그레이션 내성 때문에 `*` 유지).
          //    ⚠️ 행이 없으면(칸을 전부 비워 저장이 행을 지웠다) 비교할 작성자가 없어 넘긴다 — 비운 것도 변동이다.
          if (row) {
            const writer = typeof row.updated_by === "string" ? row.updated_by : null;
            if (writer !== (g.userId ?? null)) return;
          }
          const raw = row?.[column[cell.field]];
          const nextValue = typeof raw === "string" ? raw : null;
          if (!auditValueChanged(before, nextValue)) return;
          await logSeatAction(g, seat, {
            action: "seat_jj_mark_edit",
            targetType: "class_sheet",
            metadata: {
              classId: cell.classId,
              studentId: cell.studentId,
              date,
              slotStart: slot,
              field: cell.field,
              fieldLabel: markFieldLabel(cell.field),
              before: clipAuditValue(before),
              after: clipAuditValue(nextValue),
              ...(g.via === "pin" ? { viaPin: true } : {}),
            },
          });
        }),
      );
    } catch {
      // 감사 기록 실패는 편집을 막지 않는다(best-effort).
    }
  });
  return { ok: true };
}
