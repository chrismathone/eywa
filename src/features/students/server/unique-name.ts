import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { resolveUniqueStudentName } from "../name-suffix";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * 학생 이름 중복 방지 — **모든 학생 생성 경로가 공유하는 단일 진입점**.
 *
 * 왜 공용화하나: 규칙이 수동 등록(createStudent)에만 있어서 상담→학생 전환·엑셀 가져오기로 만든 학생은
 * 접미사 없이 같은 이름으로 들어왔다. 그러면 동명이인 가드가 걸려 **정상 보고서가 조용히 미발송**된다
 * (2026-07-29 김수아 건). 규칙이 한 경로에만 있으면 없는 것과 같다(#77 — 모든 표면이 같은 함수를).
 *
 * 대조 대상은 **테넌트 전체 이름(퇴원 포함)** — 표시 이름을 절대 유일하게 한다. ClassNote 보드명이 이
 * 이름으로 만들어지고 퇴원생 보드도 계속 살아 있기 때문이다.
 * 수백~천 명 수준이라 fetchAllPaged로 전건(무페이징 bare select 금지 — B2).
 *
 * ⚠️ **기존 학생 이름은 절대 바꾸지 않는다** — 이미 발송 중인 학생의 이름을 바꾸면 그 이름으로 만들어진
 * ClassNote 보드를 못 찾아 발송이 끊긴다(학부모는 가입 시 접미사를 안 붙인다). 이 함수는 **생성 시점**에만 쓴다.
 */
export async function resolveUniqueStudentNameFor(
  supabase: ServerClient,
  tenantId: string,
  desiredName: string,
): Promise<{ name: string; suffixed: boolean }> {
  const existing = await fetchAllPaged<{ name: string | null }>((from, to) =>
    supabase.from("students").select("name").eq("tenant_id", tenantId).range(from, to),
  );
  const taken = new Set(existing.map((r) => (r.name ?? "").trim()).filter(Boolean));
  return resolveUniqueStudentName(desiredName, taken);
}
