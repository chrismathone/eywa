"use server";

/**
 * 영어 강사 시트(수업계획서) **'SRS 단어수 가져오기'** — 그 반 그 날 **JJ 교시** 명단의 누적 암기 단어수를
 * SRS(인재원) 최신값으로 맞춘다(원장 2026-09-28: *"영어수업계획서에 우리 SRS 누적단어 가져와있자나 이거
 * 자동으로 기입되어있고 최신버전으로 srs 업데이트 뭐 해서 가져와서 자동기입되게 하는 기능 추가"*).
 *
 * 🔑 **왜 시트에도 문이 필요한가**: 자동(크론)은 04:20에 한 번 돌고, 그 뒤 학생이 더 외우면 시트 숫자가
 *    낡는다. 게다가 '내용 복사 (지난 수업)'가 이 칸을 **지난 값으로 미리 채워** 두면 종전 규칙("빈 칸만")
 *    으로는 영영 안 고쳐졌다(실측 2026-09-28: 앞날 칸 48·54개가 그런 값이었다). 강사가 보는 자리에서
 *    한 번 누르면 그 날 칸이 지금 값으로 선다.
 * 🔴 **무엇을 덮고 무엇을 지킬지 이 파일이 정하지 않는다** — 판단은 전부
 *    [`fillMemorizedWords`](@/features/ijw/server/memorized-words)이고 자리 출석부 버튼·크론과 **같은 함수**다
 *    (세 길이 다른 숫자를 적으면 안 된다). 메모가 든 칸은 안 건드리고 지난 날은 빈 칸만 채운다.
 * 🔴 게이트는 그 칸을 **손으로 적을 때와 같은 문**(`requireEcsClassAccess({ write: true })`) — 담당 반·메뉴
 *    권한이고, '다른 강사 뷰'는 그 문의 중앙 캡에서 readonly로 떨어져 저절로 막힌다.
 * 🔑 명단은 **서버가 다시 읽는다**(`getPublicSeatDay` + 이 반으로 좁힘) — 클라가 보낸 학생 목록을 믿으면
 *    명단 밖 학생 칸이 만들어진다. 반 필터를 빼면 **남의 반 칸까지** 쓴다(게이트는 이 반 하나만 열었다).
 * ⚠️ 조회는 admin(자리 하루치 공용 경로)이라 `tenantId`를 명시로 넘긴다([[#104]]).
 */

import { revalidatePath } from "next/cache";
import { logAction } from "@/features/audit/server/log";
import { getPublicSeatDay } from "@/features/attendance/seat/server/queries";
import { ijwConfigFor } from "@/features/ijw/server/client";
import { fillMemorizedWords, memorizedFillNotice } from "@/features/ijw/server/memorized-words";
import { requireEcsClassAccess } from "./access";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

/**
 * 실제로 적힌 칸 — 화면이 이 값을 `marks` state에 머지한다.
 * 🔴 `router.refresh()`로는 안 바뀐다(마크는 `useState(data.marks)`라 마운트 1회만 복사된다 —
 *    sheet-client `applyCarried` 각주와 같은 함정).
 */
export type EcsMemorizedWritten = { studentId: string; memorizedWords: string };

export async function pullEcsMemorizedWords(input: {
  classId: string;
  date: string;
  /**
   * 그 교시만 — 버튼이 붙은 **그 카드의 칸**만 맞춘다. 같은 날 JJ가 두 교시인 반이 있어서(carry-marks
   * 각주), 안 좁히면 토스트가 화면에 없는 칸까지 세어 "몇 칸을 건드렸는지"가 안 맞는다.
   */
  slotStart: string;
}): Promise<
  { ok: true; notice: string; written: EcsMemorizedWritten[] } | { ok: false; error: string }
> {
  if (!YMD.test(input.date) || !HHMM.test(input.slotStart)) {
    return { ok: false, error: "잘못된 요청입니다(날짜/교시)" };
  }

  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const { tenantId, user, className } = gate.access;
  if (!ijwConfigFor(tenantId)) return { ok: false, error: "SRS 연동이 설정되지 않았습니다" };

  const day = await getPublicSeatDay(tenantId, "jj", input.date);
  const targets = Object.entries(day.rosterByPeriod)
    // 🔴 이 교시만 — 자리 하루치는 "HH:MM"으로 키를 잡지만 옛 키가 섞여도 앞 5자로 같은 칸을 본다.
    .filter(([slot]) => slot.slice(0, 5) === input.slotStart)
    .flatMap(([slot, classes]) =>
      classes
        // 🔴 이 반만 — 게이트가 연 것은 이 반 하나다(빼면 남의 반 칸까지 쓴다).
        .filter((c) => c.classId === input.classId)
        .flatMap((c) => c.students.map((s) => ({ classId: c.classId, studentId: s.id, slotStart: slot }))),
    );
  if (!targets.length) return { ok: false, error: "그 교시 명단이 없습니다" };

  const res = await fillMemorizedWords({
    tenantId,
    date: input.date,
    targets,
    actorId: user.id,
  });
  if (!res.ok) return { ok: false, error: res.message };

  await logAction({
    action: "ecs_memorized_pull",
    targetType: "class_sheet",
    targetLabel: className,
    metadata: {
      classId: input.classId,
      date: input.date,
      slotStart: input.slotStart,
      mode: res.mode,
      filled: res.filled,
      updated: res.updated,
      same: res.same,
      kept: res.kept,
      unlinked: res.unlinked,
      noData: res.noData,
      targets: res.targets,
    },
  });

  // 🔴 layout 스코프 — 주간 시트·오늘 면·월간이 같은 칸을 그린다(page 스코프면 방금 본 화면만 새로 그린다).
  revalidatePath("/ecs", "layout");
  revalidatePath("/attendance/seat");
  return {
    ok: true,
    notice: memorizedFillNotice(res),
    written: res.written.map((w) => ({ studentId: w.studentId, memorizedWords: w.value })),
  };
}
