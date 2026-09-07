import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { getTeacherViewLang } from "./lang";
import type { TeacherEnglishNames } from "../teacher-name";

/**
 * 이 학원 직원의 **표시 이름 → 영어 이름** 표 (원장 2026-09-03 *"선생님 이름도 영어선생님의 경우
 * 영어 이름으로 바뀌고"*).
 *
 * 🔴 **영어 화면일 때만 조회한다** — 한국어 화면에선 쓸 데가 없어 빈 표를 즉시 돌려준다(왕복 0).
 *    강사 미니셸 밖(관리자 풀셸)은 `getTeacherViewLang()`이 항상 `ko`라 여기도 자동으로 0회다.
 * 🔑 `cache()`라 한 요청 안에서 레이아웃·페이지가 **한 번만** 읽는다.
 * 🔑 키가 **이름**인 이유 = 시간표 슬롯이 든 값이 FK가 아니라 라벨 문자열이기 때문이다
 *    ([`teacher-name.ts`](../teacher-name) 주석).
 *
 * ⚠️ RLS 우회(admin)라 `tenant_id`까지 좁힌다.
 * ⚠️ 결과를 표(whitelist)로 쓰므로 **무페이징 select 금지** — `fetchAllPaged`(B2).
 * ⚠️ 조회가 실패해도 화면은 그대로 열린다(표시 취향이라 막을 이유가 없다) — 빈 표면 한국어 이름이 남는다.
 */
export const getTeacherEnglishNames = cache(async (): Promise<TeacherEnglishNames> => {
  const [user, lang] = await Promise.all([getCurrentUser(), getTeacherViewLang()]);
  if (!user || lang !== "en") return {};
  try {
    const rows = await fetchAllPaged<{ display_name: string | null; english_name: string | null }>(
      (from, to) =>
        createAdminClient()
          .from("users")
          .select("display_name, english_name")
          .eq("tenant_id", user.tenantId)
          .not("english_name", "is", null)
          .range(from, to),
    );
    const map: Record<string, string> = {};
    // 🔴 **동명이인이면 그 이름을 통째로 뺀다** — 이름만으론 누구인지 못 가리므로, 담으면 마지막 행이
    //    이겨 **남의 영어 이름**이 그 자리에 뜬다(이름을 키로 쓰는 백필에서 같은 판단을 한 선례:
    //    개명 시 동명이인이면 건너뛴다). 모르면 손대지 않는 것이 정답이다 — 한국어 이름이 남는다.
    const ambiguous = new Set<string>();
    for (const r of rows) {
      const ko = (r.display_name ?? "").trim();
      const en = (r.english_name ?? "").trim();
      // 🔴 같은 글자면 담지 않는다 — 표에 있으나 없으나 결과가 같고, 표만 커진다.
      if (!ko || !en || ko === en) continue;
      if (ambiguous.has(ko)) continue;
      const seen = map[ko];
      if (seen !== undefined && seen !== en) {
        ambiguous.add(ko);
        delete map[ko];
        continue;
      }
      map[ko] = en;
    }
    return map;
  } catch {
    return {};
  }
});
