import "server-only";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import { IMPORT_META } from "../kinds";
import { duplicateKeyIssues, type ColumnSpec, type ImportPreviewRow, type SheetSpec } from "../spec";
import type { ImporterDef } from "../server/types";

/**
 * 강의실 가져오기 — 체크리스트 2번 "운영 설정"의 강의실·정원. 강의실 CRUD(학원 설정 › 운영 체계 '강의실' 카드,
 * `owner/server/classroom-actions.ts`)와 **같은 게이트 메뉴(owner)** · 같은 표(`classrooms`: 이름 · 정원 · 숨김).
 * 🔑 매칭 = 강의실 이름(공백·대소문자 무시). DB 유니크(tenant_id, name)는 **숨긴 강의실도 포함**이라,
 *    숨긴 강의실과 같은 이름은 새로 만들 수 없다 → 그 행은 오류로 알리고 화면에서 복원하게 한다.
 * 🔑 덮어쓰기 = 정원만 바꾼다(이름이 곧 키라 개명은 화면에서). 빈 정원 칸은 지우지 않는다.
 */
type K = "name" | "capacity";
const SHEET = "강의실";
const COLUMNS: ColumnSpec<K>[] = [
  { key: "name", header: "강의실", width: 16, required: true, aliases: ["강의실명", "교실", "교실명", "이름"], hint: "시간표·반에 적는 이름 그대로(예: 본원 301)." },
  { key: "capacity", header: "정원", width: 8, aliases: ["수용인원", "인원"], hint: "0~9999 숫자. 비우면 정원 없음(덮어쓰기에서는 그대로 둡니다)." },
];
const SPEC: SheetSpec<K> = { name: SHEET, columns: COLUMNS, keyHint: IMPORT_META.classrooms.keyHint };

type Existing = { id: string; name: string; capacity: number | null; archived_at: string | null };
type Plan = { inserts: { name: string; capacity: number | null }[]; updates: { id: string; name: string; capacity: number }[] };
const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

async function load(tenantId: string): Promise<Existing[]> {
  const db = await createClient();
  return fetchAllPaged<Existing>((from, to) =>
    db.from("classrooms").select("id, name, capacity, archived_at").eq("tenant_id", tenantId).order("name").order("id").range(from, to),
  );
}

const def: ImporterDef<Plan> = {
  kind: "classrooms",
  title: IMPORT_META.classrooms.title,
  menu: "operations_settings",
  sheets: [SPEC],
  singleSheet: true,
  modeHelp: IMPORT_META.classrooms.modeHelp,
  guide: [
    "· 한 줄 = 강의실 하나. 주황 칸(*)은 필수입니다.",
    "· 같은 강의실 판단 = 이름(띄어쓰기·대소문자 무시). '덮어쓰기'는 정원만 바꿉니다 — 이름 바꾸기는 학원 설정 › 운영 체계 › 강의실에서.",
    "· 숨긴 강의실과 같은 이름은 새로 만들 수 없습니다 — 화면에서 숨김을 풀어 주세요.",
  ],
  revalidate: ["/owner", "/classes", "/timetable"],

  async template(ctx) {
    const rows = await load(ctx.tenantId);
    return [{ spec: SPEC, rows: rows.filter((r) => !r.archived_at).map((r) => ({ name: r.name, capacity: r.capacity ?? "" })) }];
  },

  async plan({ ctx, mode, sheets, issues }) {
    const sheet = sheets[SHEET];
    const existing = await load(ctx.tenantId);
    const byName = new Map(existing.map((r) => [squash(r.name), r]));
    const plan: Plan = { inserts: [], updates: [] };
    const preview: ImportPreviewRow[] = [];
    const parsed: { rowNum: number; key: string }[] = [];
    let skip = 0;
    for (const row of sheet?.rows ?? []) {
      const name = row.text("name", { required: true, max: 40 });
      const capacity = row.int("capacity", { min: 0, max: 9999 });
      if (!row.ok || !name) continue;
      parsed.push({ rowNum: row.rowNum, key: squash(name) });
      const cur = byName.get(squash(name));
      if (cur?.archived_at) {
        row.fail("name", `'${cur.name}'은(는) 숨긴 강의실입니다 — 학원 설정 › 운영 체계 › 강의실의 '숨긴 강의실'에서 복원해 주세요`);
        continue;
      }
      if (cur) {
        if (mode === "append" || capacity === null || capacity === cur.capacity) {
          skip += 1;
          preview.push({ sheet: SHEET, rowNum: row.rowNum, key: cur.name, action: "skip", summary: mode === "append" ? "이미 있음" : "바뀐 칸 없음" });
          continue;
        }
        plan.updates.push({ id: cur.id, name: cur.name, capacity });
        preview.push({ sheet: SHEET, rowNum: row.rowNum, key: cur.name, action: "update", summary: `정원 ${cur.capacity ?? "없음"} → ${capacity}` });
        continue;
      }
      plan.inserts.push({ name, capacity });
      preview.push({ sheet: SHEET, rowNum: row.rowNum, key: name, action: "insert", summary: capacity === null ? "정원 없음" : `정원 ${capacity}` });
    }
    issues.push(...duplicateKeyIssues(SHEET, parsed, (r) => r.key, "강의실 이름"));
    return {
      counts: [{ label: "강의실", total: sheet?.rows.length ?? 0, insert: plan.inserts.length, update: plan.updates.length, skip }],
      preview,
      plan,
    };
  },

  async apply({ ctx, plan }) {
    const db = await createClient();
    if (plan.inserts.length) {
      const { error } = await db.from("classrooms").insert(plan.inserts.map((r) => ({ tenant_id: ctx.tenantId, name: r.name, capacity: r.capacity })));
      if (error) return { error: error.code === "23505" ? "같은 이름의 강의실이 방금 생겼습니다 — 미리보기를 다시 받아 주세요(아무것도 반영하지 않았습니다)" : `강의실을 추가하지 못했습니다 — ${error.message}` };
    }
    for (const u of plan.updates) {
      const { error } = await db.from("classrooms").update({ capacity: u.capacity }).eq("id", u.id).eq("tenant_id", ctx.tenantId);
      if (error) return { error: `${u.name} 정원을 바꾸지 못했습니다 — ${error.message}${plan.inserts.length ? ` · 새 강의실 ${plan.inserts.length}개는 들어갔습니다` : ""}` };
    }
    return {};
  },
};

export default def;
