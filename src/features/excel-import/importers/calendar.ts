import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { EVENT_COLOR_LABEL, EVENT_COLORS } from "@/features/calendar/types";
import { IMPORT_META } from "../kinds";
import { blankToNull, duplicateKeyIssues, parseDate, type ColumnSpec, type ImportPreviewRow, type SheetSpec } from "../spec";
import type { ImporterDef } from "../server/types";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * 일정 가져오기 — 캘린더(0218a `calendar_events` + 0224a `calendar_tags`). 연간 일정·휴원·행사를 옮길 때.
 * 🔑 aywa DB가 일정의 단일 진실이다 — 여기서 넣은 일정은 **구글 캘린더로 나가지 않는다**(저장 경로에 바깥 동기화가 없다;
 *    구글 가져오기는 들어오는 방향뿐). 반복 규칙은 받지 않는다(한 줄 = 한 일정 — 반복이면 줄을 여러 개 적는다).
 * 🔑 매칭 = 시작일 + 제목(앞뒤 공백·대소문자 무시). 태그는 이름으로 — 없는 태그는 **새로 만든다**(화면에서도 태그를
 *    그 자리에서 만들 수 있다) · 미리보기 알림에 무엇이 생기는지 적는다.
 * 🔑 검증은 등록 폼(`saveCalendarEvent`)과 같다: 종료일 ≥ 시작일 · 1년 이하 · 종료 시각만은 불가 · 같은 날 종료 > 시작.
 * ⚠️ 쓰기는 service_role 전용(RLS는 읽기만, 0218a) — admin + tenant_id 명시.
 */
type K = "startDate" | "endDate" | "allDay" | "startTime" | "endTime" | "title" | "tag" | "color" | "memo";

const SHEET = "일정";
const MAX_SPAN_DAYS = 366;
const COLOR_OPTIONS = EVENT_COLORS.map((c) => ({ label: EVENT_COLOR_LABEL[c], value: c as string }));

function spec(tags: readonly string[]): SheetSpec<K> {
  const columns: ColumnSpec<K>[] = [
    { key: "startDate", header: "시작일", width: 12, required: true, aliases: ["날짜", "일자"], hint: "2026-09-01" },
    { key: "endDate", header: "종료일", width: 12, hint: "비우면 시작일과 같은 날(하루 일정)" },
    { key: "allDay", header: "종일", width: 7, options: ["예", "아니오"], strictOptions: true, hint: "예 = 시각 없이 하루 종일. 비우면 시각이 적혔는지로 판단." },
    { key: "startTime", header: "시작시각", width: 10, aliases: ["시작시간"], hint: "14:30" },
    { key: "endTime", header: "종료시각", width: 10, aliases: ["종료시간"] },
    { key: "title", header: "제목", width: 30, required: true, aliases: ["일정", "일정명", "내용"] },
    { key: "tag", header: "태그", width: 12, aliases: ["분류", "구분"], options: tags, hint: "캘린더 태그 이름. 없는 이름이면 새 태그가 만들어집니다." },
    { key: "color", header: "색", width: 8, options: COLOR_OPTIONS.map((c) => c.label), strictOptions: true, hint: "태그가 있으면 태그 색이 먼저 보입니다" },
    { key: "memo", header: "메모", width: 36, aliases: ["비고"] },
  ];
  return { name: SHEET, columns, keyHint: IMPORT_META.calendar.keyHint };
}

type Existing = { id: string; title: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null; memo: string | null; color: string; tag_id: string | null };
type Tag = { id: string; name: string };
type Row = { title: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null; memo: string | null; color: string | null; tagName: string | null };
type Plan = { newTags: string[]; inserts: Row[]; updates: { id: string; patch: Partial<Row> }[] };

const keyOf = (start: string, title: string) => `${start}|${title.trim().toLowerCase()}`;
const hm = (t: string | null) => (t ? t.slice(0, 5) : null);
const spanDays = (a: string, b: string) => Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

async function loadTags(tenantId: string): Promise<Tag[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("calendar_tags").select("id, name").eq("tenant_id", tenantId).order("name");
  // 0224a 미적용이면 태그 없이 산다(#95) — 태그 칸을 적은 행만 오류로 알린다.
  if (error) return [];
  return (data ?? []) as Tag[];
}

const def: ImporterDef<Plan> = {
  kind: "calendar",
  title: IMPORT_META.calendar.title,
  menu: "calendar",
  sheets: [spec([])],
  singleSheet: true,
  modeHelp: IMPORT_META.calendar.modeHelp,
  guide: [
    "· 한 줄 = 일정 한 건. 여러 날 일정은 시작일·종료일로, 반복 일정은 줄을 여러 개 적습니다.",
    "· 같은 일정 판단: 시작일 + 제목. '추가' = 이미 있으면 건너뜀 · '덮어쓰기' = 종료일·시각·태그·색·메모를 파일 값으로(빈 칸은 그대로).",
    "· 종일이면 시각을 비웁니다. 종료 시각만 적을 수는 없습니다. 한 일정은 1년까지입니다.",
    "· 태그는 캘린더 태그 이름. 없는 이름이면 새 태그가 만들어집니다(오타가 새 태그가 되지 않게 미리보기를 확인하세요).",
    "· 여기서 넣은 일정은 에이와 캘린더에만 들어갑니다(구글 캘린더로 보내지 않습니다).",
  ],
  revalidate: ["/calendar"],

  async template(ctx) {
    const tags = await loadTags(ctx.tenantId);
    return [{ spec: spec(tags.map((t) => t.name)), rows: [] }];
  },

  async plan({ ctx, mode, sheets, issues }) {
    const admin = createAdminClient();
    const [tags, existing] = await Promise.all([
      loadTags(ctx.tenantId),
      fetchAllPaged<Existing>((from, to) =>
        admin
          .from("calendar_events")
          .select("id, title, start_date, end_date, start_time, end_time, memo, color, tag_id")
          .eq("tenant_id", ctx.tenantId)
          .order("id")
          .range(from, to),
      ),
    ]);
    const tagByName = new Map(tags.map((t) => [t.name.trim().toLowerCase(), t]));
    // 🔴 같은 시작일·제목 일정이 여럿일 수 있다(오전·오후 반복 등) — 마지막 것이 이기는 Map이면 덮어쓰기가 아무거나 고친다.
    const byKey = new Map<string, Existing[]>();
    for (const e of existing) byKey.set(keyOf(e.start_date, e.title), [...(byKey.get(keyOf(e.start_date, e.title)) ?? []), e]);
    // 파일 안 같은 시작일·제목 줄 수 — 시각이 다른 반복만 허용한다(그때는 시각으로 짝을 찾는다).
    const fileGroup = new Map<string, number>();
    for (const r of sheets[SHEET]?.rows ?? []) {
      const d = parseDate(r.raw("startDate"));
      const t = blankToNull(r.raw("title"));
      if (d && t) fileGroup.set(keyOf(d, t), (fileGroup.get(keyOf(d, t)) ?? 0) + 1);
    }
    const usedIds = new Set<string>();

    const plan: Plan = { newTags: [], inserts: [], updates: [] };
    const preview: ImportPreviewRow[] = [];
    const notes: string[] = [];
    const newTagSet = new Map<string, string>();
    let skip = 0;
    const parsed: { rowNum: number; key: string }[] = [];

    for (const row of sheets[SHEET]?.rows ?? []) {
      const startDate = row.date("startDate", true);
      const endDateRaw = row.date("endDate");
      const allDay = row.yesNo("allDay");
      const startTimeRaw = row.time("startTime");
      const endTimeRaw = row.time("endTime");
      const title = row.text("title", { required: true, max: 120 });
      const tagName = row.text("tag", { max: 30 });
      const color = row.option("color", COLOR_OPTIONS);
      const memo = row.text("memo", { max: 2000 });
      if (!row.ok || !startDate || !title) continue;
      const endDate = endDateRaw ?? startDate;
      if (endDate < startDate) {
        row.fail("endDate", "종료일이 시작일보다 앞섭니다");
        continue;
      }
      if (spanDays(startDate, endDate) > MAX_SPAN_DAYS) {
        row.fail("endDate", "한 일정은 최대 1년까지입니다 — 나눠서 적어 주세요");
        continue;
      }
      const startTime = allDay === true ? null : startTimeRaw;
      const endTime = allDay === true ? null : endTimeRaw;
      if (allDay === true && (startTimeRaw || endTimeRaw)) notes.push(`${row.rowNum}행 ${title}: 종일이라 시각은 버렸습니다`);
      if (allDay === false && !startTime) {
        row.fail("startTime", "종일이 '아니오'면 시작 시각을 적어 주세요");
        continue;
      }
      if (endTime && !startTime) {
        row.fail("endTime", "종료 시각만 있을 수 없습니다 — 시작 시각을 적어 주세요");
        continue;
      }
      if (startTime && endTime && startDate === endDate && endTime <= startTime) {
        row.fail("endTime", "종료 시각이 시작 시각보다 빠릅니다");
        continue;
      }
      if (tagName && !tagByName.has(tagName.toLowerCase())) {
        if (!newTagSet.has(tagName.toLowerCase())) newTagSet.set(tagName.toLowerCase(), tagName);
      }
      const key = keyOf(startDate, title);
      // 파일 안 중복 판정은 시각까지 — 같은 날 같은 제목이라도 시각이 다르면 다른 일정(반복)이다.
      parsed.push({ rowNum: row.rowNum, key: `${key}|${startTime ?? "종일"}` });
      const when = `${startDate}${endDate !== startDate ? `~${endDate}` : ""}${startTime ? ` ${startTime}${endTime ? `~${endTime}` : ""}` : " 종일"}`;
      const summary = [when, tagName ? `태그 ${tagName}` : null, memo ? memo.slice(0, 30) : null].filter(Boolean).join(" · ");
      const next: Row = { title, start_date: startDate, end_date: endDate, start_time: startTime, end_time: endTime, memo, color, tagName };
      // 기존과 짝 찾기 — 같은 시작일·제목 후보 중 시각까지 같은 것이 우선. 후보가 하나뿐이고 파일에도 그 줄 하나뿐이면
      // 시각이 달라도 그 일정(시각 수정). 시각이 다른 반복을 파일에 적었는데 기존에 그 시각이 없으면 새 일정.
      const cands = byKey.get(key) ?? [];
      const sameTime = cands.filter((e) => (hm(e.start_time) ?? null) === (startTime ?? null));
      const matches = sameTime.length > 0 ? sameTime : cands.length === 1 && (fileGroup.get(key) ?? 1) === 1 ? cands : [];
      if (matches.length > 1) {
        if (mode === "append") {
          skip += 1;
          preview.push({ sheet: SHEET, rowNum: row.rowNum, key: title, action: "skip", summary: `이미 있음(${matches.length}건) · ${summary}` });
        } else {
          row.fail("title", `같은 일정이 여러 건(${matches.length}건)이라 어느 것을 고칠지 모릅니다 — 화면에서 고쳐 주세요`);
        }
        continue;
      }
      const cur = matches[0];
      if (cur && mode === "overwrite" && usedIds.has(cur.id)) {
        row.fail("title", "앞 줄과 같은 기존 일정을 가리킵니다 — 시각을 적어 어느 일정인지 구분해 주세요");
        continue;
      }
      if (cur) usedIds.add(cur.id);
      if (!cur) {
        plan.inserts.push(next);
        preview.push({ sheet: SHEET, rowNum: row.rowNum, key: title, action: "insert", summary });
        continue;
      }
      if (mode === "append") {
        skip += 1;
        preview.push({ sheet: SHEET, rowNum: row.rowNum, key: title, action: "skip", summary: `이미 있음 · ${summary}` });
        continue;
      }
      // 덮어쓰기 — 빈 칸은 그대로. 종일 '예'는 시각을 지우는 것이 뜻이라 반영한다.
      const patch: Partial<Row> = {};
      if (endDateRaw && endDateRaw !== cur.end_date) patch.end_date = endDateRaw;
      if (allDay === true && (cur.start_time || cur.end_time)) {
        patch.start_time = null;
        patch.end_time = null;
      } else {
        if (startTime && startTime !== hm(cur.start_time)) patch.start_time = startTime;
        if (endTime && endTime !== hm(cur.end_time)) patch.end_time = endTime;
      }
      if (memo !== null && memo !== cur.memo) patch.memo = memo;
      if (color !== null && color !== cur.color) patch.color = color;
      const curTagName = tags.find((t) => t.id === cur.tag_id)?.name ?? null;
      if (tagName && tagName.toLowerCase() !== curTagName?.toLowerCase()) patch.tagName = tagName;
      // 결과 시각이 뒤집히면 안 된다(시작만 바꿔 기존 종료보다 늦어지는 등).
      const s = patch.start_time !== undefined ? patch.start_time : hm(cur.start_time);
      const e = patch.end_time !== undefined ? patch.end_time : hm(cur.end_time);
      const ed = patch.end_date ?? cur.end_date;
      if (s && e && startDate === ed && e <= s) {
        row.fail("endTime", `바꾼 뒤 종료 시각(${e})이 시작 시각(${s})보다 빠릅니다 — 두 칸을 함께 적어 주세요`);
        continue;
      }
      if (Object.keys(patch).length === 0) {
        skip += 1;
        preview.push({ sheet: SHEET, rowNum: row.rowNum, key: title, action: "skip", summary: "바뀐 칸 없음" });
      } else {
        plan.updates.push({ id: cur.id, patch });
        preview.push({ sheet: SHEET, rowNum: row.rowNum, key: title, action: "update", summary: `${Object.keys(patch).length}칸 바꿈 · ${summary}` });
      }
    }
    issues.push(...duplicateKeyIssues(SHEET, parsed, (r) => r.key, "일정(시작일·제목)"));
    plan.newTags = [...newTagSet.values()];
    // 새 태그는 **실제로 쓰일 행**의 것만 만든다(추가 방식에서 건너뛰는 행의 오타가 태그를 만들면 안 된다).
    const used = new Set([...plan.inserts.map((r) => r.tagName), ...plan.updates.map((u) => u.patch.tagName)].filter(Boolean).map((t) => t!.toLowerCase()));
    plan.newTags = plan.newTags.filter((t) => used.has(t.toLowerCase()));
    if (plan.newTags.length) notes.push(`새 태그 ${plan.newTags.length}개가 만들어집니다: ${plan.newTags.join(" · ")} — 오타라면 파일을 고쳐 다시 올려 주세요`);
    return {
      counts: [{ label: "일정", total: sheets[SHEET]?.rows.length ?? 0, insert: plan.inserts.length, update: plan.updates.length, skip }],
      preview,
      notes,
      plan,
    };
  },

  async apply({ ctx, plan }) {
    const admin = createAdminClient();
    const tagIdByName = new Map<string, string>();
    if (plan.newTags.length) {
      const { error } = await admin.from("calendar_tags").insert(plan.newTags.map((name) => ({ tenant_id: ctx.tenantId, name, color: "primary" })));
      if (error) {
        const missing = /does not exist|Could not find the table|PGRST205/i.test(error.message);
        return { error: missing ? "태그 표가 아직 준비되지 않았습니다(마이그레이션 0224a 적용 필요) — 태그 칸을 비우고 다시 올려 주세요" : /duplicate key|name_unique/i.test(error.message) ? "같은 이름의 태그가 방금 생겼습니다 — 미리보기를 다시 받아 주세요" : `태그를 만들지 못했습니다 — ${error.message}` };
      }
    }
    const needsTags = plan.inserts.some((r) => r.tagName) || plan.updates.some((u) => u.patch.tagName);
    if (needsTags) for (const t of await loadTags(ctx.tenantId)) tagIdByName.set(t.name.trim().toLowerCase(), t.id);
    const tagIdOf = (name: string | null | undefined) => (name ? (tagIdByName.get(name.toLowerCase()) ?? null) : null);

    let inserted = 0;
    for (let i = 0; i < plan.inserts.length; i += 200) {
      const chunk = plan.inserts.slice(i, i + 200);
      const { error } = await admin.from("calendar_events").insert(
        chunk.map((r) => ({
          tenant_id: ctx.tenantId,
          title: r.title,
          start_date: r.start_date,
          end_date: r.end_date,
          start_time: r.start_time,
          end_time: r.end_time,
          memo: r.memo,
          color: r.color ?? "primary",
          created_by: ctx.user.id,
          // 태그 칸을 안 적은 행은 tag_id 키를 아예 안 보낸다(0224a 전에도 살게, #95).
          ...(r.tagName ? { tag_id: tagIdOf(r.tagName) } : {}),
        })),
      );
      if (error) {
        const missing = /does not exist|Could not find the table|PGRST205/i.test(error.message);
        return { error: missing ? "캘린더 표가 아직 준비되지 않았습니다(마이그레이션 0218a 적용 필요)" : `일정을 넣지 못했습니다 — ${error.message}${inserted ? ` · 그 앞 ${inserted}건은 들어갔습니다` : ""}` };
      }
      inserted += chunk.length;
    }
    for (const u of plan.updates) {
      const { tagName, ...rest } = u.patch;
      const { error } = await admin
        .from("calendar_events")
        .update({ ...rest, ...(tagName ? { tag_id: tagIdOf(tagName) } : {}) })
        .eq("tenant_id", ctx.tenantId)
        .eq("id", u.id);
      if (error) return { error: `${explainDbError(error, { scope: "excel-import.calendar", fallback: "일정 갱신 중 멈췄습니다 — 잠시 후 다시 시도해 주세요" }).message} (새 일정 ${inserted}건은 들어갔습니다)` };
    }
    return {};
  },
};

export default def;
