"use server";

/**
 * JJ실 자리 출석부 **'인재원에서 단어수 가져오기'**(수동) — 그 날 명단의 **빈** 누적 암기 단어수 칸을 채운다
 * (원장 2026-09-21: *"수동으로 가져와서 입력되게도해줘"*). 자동(하루 한 번)은 크론이 같은 함수를 부른다.
 *
 * 🔴 게이트는 그 칸을 **손으로 적을 때와 같은 문**(`gateSeatWrite`) — 담당·메뉴 권한 또는 PIN, 그리고 오늘만.
 *    다만 **비로그인 PIN 화면에서는 열지 않는다**: 그 문은 "그 자리에서 찍는 것"까지고, 바깥 서비스(인재원)를
 *    부르는 일은 아니다(키오스크에서 외부 호출을 무제한으로 낼 수 있게 두지 않는다).
 * 🔑 명단은 **서버가 다시 읽는다**(`getSeatDay`) — 클라가 보낸 학생 목록을 믿으면 명단 밖 학생 칸이 만들어진다.
 * 🔑 덮어쓰기·짝 판정·인재원 호출은 [`fillMemorizedWords`](@/features/ijw/server/memorized-words) 한 곳이다
 *    (크론과 같은 규칙 — 자동과 수동이 다른 숫자를 적으면 안 된다).
 */

import { revalidatePath } from "next/cache";
import { ijwConfigFor } from "@/features/ijw/server/client";
import { fillMemorizedWords, memorizedFillNotice } from "@/features/ijw/server/memorized-words";
import { seatHasJjFields } from "../jj-fields";
import type { SeatKey } from "../seat";
import { logSeatAction } from "./audit";
import { gateSeatWrite } from "./gate";
import { getSeatDay } from "./queries";

export async function pullSeatMemorizedWords(input: {
  seat: SeatKey;
  date: string;
}): Promise<{ ok: true; notice: string } | { error: string }> {
  if (!seatHasJjFields(input.seat)) return { error: "이 자리에는 기록 칸이 없습니다" };

  const gated = await gateSeatWrite(input.seat, input.date);
  if ("error" in gated) return gated;
  if (gated.via === "pin") return { error: "로그인한 화면에서만 가져올 수 있습니다" };
  if (!ijwConfigFor(gated.tenantId)) return { error: "인재원 연동이 설정되지 않았습니다" };

  const day = await getSeatDay(input.seat, input.date);
  const targets = Object.entries(day.rosterByPeriod).flatMap(([slot, classes]) =>
    classes.flatMap((c) => c.students.map((s) => ({ classId: c.classId, studentId: s.id, slotStart: slot }))),
  );
  if (!targets.length) return { error: "그 날은 이 자리 수업이 없습니다" };

  const res = await fillMemorizedWords({
    tenantId: gated.tenantId,
    date: input.date,
    targets,
    actorId: gated.userId,
  });
  if (!res.ok) return { error: res.message };

  await logSeatAction(gated, input.seat, {
    action: "seat_jj_memorized_pull",
    targetType: "class_sheet",
    metadata: {
      date: input.date,
      filled: res.filled,
      kept: res.kept,
      unlinked: res.unlinked,
      noData: res.noData,
      targets: res.targets,
    },
  });

  revalidatePath("/attendance/seat");
  revalidatePath("/ecs");
  return { ok: true, notice: memorizedFillNotice(res) };
}
