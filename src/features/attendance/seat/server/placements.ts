import { isMissingRelation } from "@/lib/supabase/db-error";
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hhmm, type SeatKey } from "../seat";
import type { SeatPlacement } from "../placement";

/**
 * 자리 **배치**(드래그로 옮겨 둔 자리) 조회 — 0254a `seat_placements`. 배치를 새로 만드는 드래그는 원장 2026-09-11로
 * 없앴다(드래그의 뜻은 다른 시간 하나) — 이미 있는 줄의 표시·[초기화]를 위해 계속 읽는다.
 *
 * 🔴 **admin 클라이언트 + 명시 `tenant_id` 필터**로만 읽는다 — 이 표는 RLS 정책이 0개라 세션
 *    클라이언트로 읽으면 **에러 없이 0행**이 온다([[#104]]). 비로그인 PIN 화면도 같은 함수를 쓴다
 *    (배치를 안 보여 주면 두 화면이 서로 다른 자리를 말한다 — 출결 귀속은 어느 쪽이든 같지만
 *    "누가 어디 앉아 있나"가 갈리면 당번이 엉뚱한 카드를 찾는다).
 * 🔴 **fail-soft**([[#95]]) — 0254a가 아직 안 돌았어도 이 화면은 매일 도는 자리 출석부다. 표가 없으면
 *    배치 0줄(= 지금까지의 화면 그대로)로 떨어지고 [초기화]만 잠긴다(교시 이동 드래그는 다른 표라 산다). throw 금지.
 */
export type SeatPlacementLoad = {
  rows: SeatPlacement[];
  /** 배치를 쓸 수 있나 — false면 [초기화]를 잠그고 배너가 사실을 말한다. */
  ready: boolean;
  /** 왜 못 쓰는가(한글). 표가 없는 것과 그냥 실패한 것은 다른 문구다. */
  reason: string | null;
};

const NOT_READY = (reason: string): SeatPlacementLoad => ({ rows: [], ready: false, reason });

/** 표가 아직 없다(SQL 미적용)와 그냥 실패를 가른다 — 원인을 단정하지 않기 위해서다. */
function missingTable(err: { code?: string; message?: string }): boolean {
  return isMissingRelation(err, "seat_placements"); // 이름 + 없음 코드(공용 판정, P1-E)
}

/**
 * **하루치 한 번에** — 교시별로 갈라 돌려준다.
 * 🔑 '전체' 보기(원장 2026-09-10 ⑨ *"한번에 오늘 전체 볼 수 있게"*)가 교시 수만큼 왕복을 늘리지
 *    않도록, 조회는 언제나 하루 한 번이고 교시는 화면에서 나눈다(B6 — 창마다 그 비용이 곱해진다).
 *    하루 배치 줄은 많아야 수십 개라 통째로 받아도 절단 걱정이 없다.
 */
export type SeatPlacementDayLoad = {
  bySlot: Record<string, SeatPlacement[]>;
  ready: boolean;
  reason: string | null;
};

export async function getSeatPlacementsForDay(
  tenantId: string,
  seat: SeatKey,
  date: string,
): Promise<SeatPlacementDayLoad> {
  const { data, error } = await createAdminClient()
    .from("seat_placements")
    .select("slot_start, student_id, from_class_id, to_class_id")
    .eq("tenant_id", tenantId)
    .eq("seat", seat)
    .eq("session_date", date)
    // 🔑 정렬을 못박아 **서버 렌더와 클라 첫 렌더가 같은 순서**를 그린다(옮겨 온 학생은 명단 끝에
    //    `applied` 순으로 붙으므로, 순서가 흔들리면 하이드레이션이 갈린다).
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    return {
      bySlot: {},
      ready: false,
      reason: missingTable(error)
        ? "자리 배치 기능이 아직 켜지지 않았습니다 — 관리자에게 문의하세요(0254a 미적용)."
        : "자리 배치를 불러오지 못했습니다 — 옮겨 둔 자리의 [초기화]만 잠시 잠깁니다.",
    };
  }
  const bySlot: Record<string, SeatPlacement[]> = {};
  for (const r of data ?? []) {
    const slot = hhmm(r.slot_start as string);
    (bySlot[slot] ??= []).push({
      studentId: r.student_id as string,
      fromClassId: r.from_class_id as string,
      toClassId: r.to_class_id as string,
    });
  }
  return { bySlot, ready: true, reason: null };
}

/** 교시 하나치 — 위 하루치를 그 교시로 좁힌 것(왕복은 같다). */
export async function getSeatPlacements(
  tenantId: string,
  seat: SeatKey,
  date: string,
  slotStart: string,
): Promise<SeatPlacementLoad> {
  const day = await getSeatPlacementsForDay(tenantId, seat, date);
  if (!day.ready) return NOT_READY(day.reason ?? "자리 배치를 불러오지 못했습니다");
  return { rows: day.bySlot[hhmm(slotStart)] ?? [], ready: true, reason: null };
}
