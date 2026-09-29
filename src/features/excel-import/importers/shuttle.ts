import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import { DIRECTION_LABEL, SEASON_LABEL, SHUTTLE_DAYS, dayLabel, type DayCode, type Direction, type Season } from "@/features/shuttle/types";
import { IMPORT_META } from "../kinds";
import type { RowReader } from "../rows";
import { StudentIndex } from "../server/lookups";
import { duplicateKeyIssues, parseWeekday, splitList, type ColumnSpec, type ImportPreviewRow, type SheetSpec } from "../spec";
import type { ImporterDef } from "../server/types";

/**
 * 셔틀 가져오기 — ① 정류장 마스터(0225a `shuttle_stops` + 0244a 주소·좌표) ② 원생 승하차 배정(`shuttle_riders`, 선택 시트).
 * 🔑 정류장 매칭 = 이름(앞뒤 공백 무시, 접지 않은 정류장 — DB 부분 유니크와 같은 기준).
 * 🔑 승하차 = 원생 + (차량 · 시즌 · 회차 → 회차) + 정류장 + 승차/하차. 🔴 **차량·회차·노선은 만들지 않는다** — 편성(시각·순서)은
 *    셔틀 편성 화면이 정본이라, 그 노선에 이 정류장이 없으면 오류로 알린다(엑셀이 노선을 몰래 늘리면 운행 순서가 틀어진다).
 *    매칭 키 = (그 노선의 정류장 칸, 원생, 승하차) — DB 유니크와 같다. 추가 = 이미 있으면 건너뜀 · 덮어쓰기 = 요일·메모를 파일 값으로.
 * 🔴 학생 레코드·등하원 기록은 건드리지 않는다(셔틀은 배정만 — actions.ts 머리 주석).
 * ⚠️ 쓰기는 service_role 전용(0225a는 읽기 정책만) — admin + tenant_id 명시. 좌표 칸(0244a)이 없는 배포면 주소·좌표 칸을 적은 행만 오류.
 */
type SK = "name" | "address" | "lat" | "lng" | "radius" | "memo";
type RK = "studentName" | "school" | "grade" | "vehicle" | "season" | "runNo" | "stop" | "io" | "weekdays" | "memo";

const STOP_SHEET = "정류장";
const RIDER_SHEET = "승하차";
const SEASON_OPTIONS = (Object.entries(SEASON_LABEL) as [Season, string][]).map(([value, label]) => ({ label, value, aliases: value === "term" ? ["학기"] : ["방학"] }));
const IO_OPTIONS = [
  { label: "승차", value: "in" as Direction, aliases: ["등원", "탑승"] },
  { label: "하차", value: "out" as Direction, aliases: ["하원"] },
];

function stopSpec(): SheetSpec<SK> {
  const columns: ColumnSpec<SK>[] = [
    { key: "name", header: "정류장", width: 22, required: true, aliases: ["정류장이름", "정류장명", "행선지"] },
    { key: "address", header: "주소", width: 36, hint: "사람이 읽는 주소(200자까지)" },
    { key: "lat", header: "위도", width: 11, hint: "위도·경도는 둘 다 적거나 둘 다 비웁니다" },
    { key: "lng", header: "경도", width: 11 },
    { key: "radius", header: "도착반경(m)", width: 10, aliases: ["반경", "도착반경"], hint: "10~500, 비우면 50" },
    { key: "memo", header: "메모", width: 30, aliases: ["비고"] },
  ];
  return { name: STOP_SHEET, columns, keyHint: "정류장 이름" };
}
function riderSpec(vehicles: readonly string[], stops: readonly string[]): SheetSpec<RK> {
  const columns: ColumnSpec<RK>[] = [
    { key: "studentName", header: "원생이름", width: 10, required: true, aliases: ["이름", "원생", "학생"] },
    { key: "school", header: "학교", width: 12, hint: "같은 이름 원생이 둘 이상일 때 채웁니다" },
    { key: "grade", header: "학년", width: 7 },
    { key: "vehicle", header: "차량", width: 12, required: true, options: vehicles, hint: "셔틀 편성의 차량 이름" },
    { key: "season", header: "시즌", width: 8, options: SEASON_OPTIONS.map((s) => s.label), strictOptions: true, hint: "비우면 학기중" },
    { key: "runNo", header: "회차", width: 6, required: true, hint: "그 차량·시즌의 회차 번호(1, 2 …)" },
    { key: "stop", header: "정류장", width: 20, required: true, options: stops, hint: "그 회차 노선에 있는 정류장" },
    { key: "io", header: "승하차", width: 7, required: true, options: IO_OPTIONS.map((o) => o.label), strictOptions: true },
    { key: "weekdays", header: "요일", width: 14, required: true, hint: "월,수,금 또는 월수금" },
    { key: "memo", header: "메모", width: 24, aliases: ["비고"] },
  ];
  return { name: RIDER_SHEET, columns, keyHint: "원생 + 차량·시즌·회차의 정류장 + 승하차", optional: true };
}

type Stop = { id: string; name: string; memo: string | null; address?: string | null; lat?: number | null; lng?: number | null; radius_m?: number };
type Vehicle = { id: string; name: string };
type Run = { id: string; vehicle_id: string; season: string; run_no: number; direction: string };
type RunStop = { id: string; run_id: string; stop_id: string | null; kind: string };
type Rider = { id: string; run_stop_id: string; student_id: string; io_kind: string; weekdays: string[]; memo: string | null };

type StopWrite = { name: string; memo: string | null; address: string | null; lat: number | null; lng: number | null; radius_m: number | null };
type Plan = {
  coordsReady: boolean;
  stopInserts: StopWrite[];
  stopUpdates: { id: string; patch: Partial<StopWrite> }[];
  riderInserts: { run_stop_id: string; student_id: string; io_kind: Direction; weekdays: DayCode[]; memo: string | null }[];
  riderUpdates: { id: string; patch: { weekdays?: DayCode[]; memo?: string } }[];
};

const nameKey = (s: string) => s.trim().toLowerCase();

/** 좌표 칸(0244a)까지 읽고, 없는 배포면 이름·메모만 — 화면이 쓰는 폴백과 같은 결(#95). */
async function loadStops(tenantId: string): Promise<{ rows: Stop[]; coordsReady: boolean }> {
  const admin = createAdminClient();
  try {
    const rows = await fetchAllPaged<Stop>((from, to) =>
      admin.from("shuttle_stops").select("id, name, memo, address, lat, lng, radius_m").eq("tenant_id", tenantId).eq("archived", false).order("sort_order").order("id").range(from, to),
    );
    return { rows, coordsReady: true };
  } catch {
    const rows = await fetchAllPaged<Stop>((from, to) =>
      admin.from("shuttle_stops").select("id, name, memo").eq("tenant_id", tenantId).eq("archived", false).order("sort_order").order("id").range(from, to),
    );
    return { rows, coordsReady: false };
  }
}

async function loadRouting(tenantId: string) {
  const admin = createAdminClient();
  const [vehicles, runs, runStops, riders] = await Promise.all([
    fetchAllPaged<Vehicle>((from, to) => admin.from("shuttle_vehicles").select("id, name").eq("tenant_id", tenantId).eq("archived", false).order("sort_order").order("id").range(from, to)),
    fetchAllPaged<Run>((from, to) => admin.from("shuttle_runs").select("id, vehicle_id, season, run_no, direction").eq("tenant_id", tenantId).order("id").range(from, to)),
    fetchAllPaged<RunStop>((from, to) => admin.from("shuttle_run_stops").select("id, run_id, stop_id, kind").eq("tenant_id", tenantId).order("id").range(from, to)),
    fetchAllPaged<Rider>((from, to) => admin.from("shuttle_riders").select("id, run_stop_id, student_id, io_kind, weekdays, memo").eq("tenant_id", tenantId).order("id").range(from, to)),
  ]);
  return { vehicles, runs, runStops, riders };
}

/** 요일 칸 → DayCode[](정본 순서). `월,수,금`·`월 수 금`·`월수금` 모두. 모르는 글자가 있으면 undefined. */
function parseDays(raw: string): DayCode[] | undefined {
  const tokens = splitList(raw).flatMap((t) => (parseWeekday(t) === undefined && /^[월화수목금토일]+$/.test(t) ? t.split("") : [t]));
  const set = new Set<DayCode>();
  for (const t of tokens) {
    const idx = parseWeekday(t);
    if (idx === undefined || idx === null) return undefined;
    set.add((["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[idx]);
  }
  return SHUTTLE_DAYS.filter((d) => set.has(d));
}

function parseCoord(row: RowReader<string>, key: SK, limit: number): number | null {
  return row.num(key, { min: -limit, max: limit });
}

const def: ImporterDef<Plan> = {
  kind: "shuttle",
  title: IMPORT_META.shuttle.title,
  menu: "shuttle",
  sheets: [stopSpec(), riderSpec([], [])],
  modeHelp: IMPORT_META.shuttle.modeHelp,
  guide: [
    "· '정류장' 시트 한 줄 = 정류장 한 곳. '승하차' 시트(선택) 한 줄 = 원생 한 명이 어느 차량·회차의 어느 정류장에서 타고 내리는지.",
    "· 같은 정류장 판단: 이름(앞뒤 공백 무시). '추가' = 이미 있으면 건너뜀 · '덮어쓰기' = 주소·좌표·메모를 파일 값으로(빈 칸은 그대로).",
    "· 차량·회차·노선(정류장 순서·시각)은 이 파일로 만들지 않습니다 — 셔틀 편성 화면에서 먼저 만들고, 승하차 시트는 그 노선에 있는 정류장만 적습니다.",
    "· 승하차의 같은 배정 판단: 원생 + 그 회차의 정류장 + 승차/하차. 덮어쓰기면 요일·메모를 파일 값으로 바꿉니다.",
    "· 요일은 '월,수,금' 또는 '월수금'. 등하원 기록(탔다/안 탔다)은 이 파일로 넣지 않습니다.",
  ],
  revalidate: ["/shuttle", "/shuttle/today", "/shuttle/live"],

  async template(ctx) {
    const [stops, routing, db] = await Promise.all([loadStops(ctx.tenantId), loadRouting(ctx.tenantId).catch(() => null), createClient()]);
    const students = routing?.riders.length ? await StudentIndex.load(db, ctx.tenantId, { includeWithdrawn: true }) : new StudentIndex([]);
    const stopById = new Map(stops.rows.map((s) => [s.id, s]));
    const vehicleById = new Map((routing?.vehicles ?? []).map((v) => [v.id, v]));
    const runById = new Map((routing?.runs ?? []).map((r) => [r.id, r]));
    const runStopById = new Map((routing?.runStops ?? []).map((r) => [r.id, r]));
    const studentById = new Map(students.rows.map((s) => [s.id, s]));
    const riderRows = (routing?.riders ?? []).flatMap((r) => {
      const rs = runStopById.get(r.run_stop_id);
      const run = rs ? runById.get(rs.run_id) : undefined;
      const vehicle = run ? vehicleById.get(run.vehicle_id) : undefined;
      const stop = rs?.stop_id ? stopById.get(rs.stop_id) : undefined;
      const st = studentById.get(r.student_id);
      if (!rs || !run || !vehicle || !stop || !st || st.status === "withdrawn") return [];
      return [
        {
          studentName: st.name,
          school: st.school ?? "",
          grade: st.grade ?? "",
          vehicle: vehicle.name,
          season: SEASON_LABEL[run.season as Season] ?? "",
          runNo: run.run_no,
          stop: stop.name,
          io: r.io_kind === "in" ? "승차" : "하차",
          weekdays: SHUTTLE_DAYS.filter((d) => r.weekdays.includes(d)).map(dayLabel).join(","),
          memo: r.memo ?? "",
        },
      ];
    });
    return [
      {
        spec: stopSpec(),
        rows: stops.rows.map((s) => ({
          name: s.name,
          address: s.address ?? "",
          lat: s.lat ?? "",
          lng: s.lng ?? "",
          radius: s.radius_m ?? "",
          memo: s.memo ?? "",
        })),
      },
      { spec: riderSpec((routing?.vehicles ?? []).map((v) => v.name), stops.rows.map((s) => s.name)), rows: riderRows },
    ];
  },

  async plan({ ctx, mode, sheets, issues }) {
    const [stops, routing, db] = await Promise.all([loadStops(ctx.tenantId), loadRouting(ctx.tenantId), createClient()]);
    const riderSheet = sheets[RIDER_SHEET];
    const students = riderSheet?.rows.length ? await StudentIndex.load(db, ctx.tenantId) : new StudentIndex([]);
    // 🔴 이름이 겹치는 정류장(대소문자만 다른 것 등)이 여럿일 수 있다 — 마지막 것이 이기는 Map이면 아무거나 고친다.
    const stopsByName = new Map<string, Stop[]>();
    for (const s of stops.rows) stopsByName.set(nameKey(s.name), [...(stopsByName.get(nameKey(s.name)) ?? []), s]);

    const plan: Plan = { coordsReady: stops.coordsReady, stopInserts: [], stopUpdates: [], riderInserts: [], riderUpdates: [] };
    const preview: ImportPreviewRow[] = [];
    const notes: string[] = [];
    let stopSkip = 0;
    const fileStopNames = new Set<string>();
    const parsedStops: { rowNum: number; key: string }[] = [];

    for (const row of sheets[STOP_SHEET]?.rows ?? []) {
      const name = row.text("name", { required: true, max: 80 });
      const address = row.text("address", { max: 200 });
      const lat = parseCoord(row, "lat", 90);
      const lng = parseCoord(row, "lng", 180);
      const radius = row.int("radius", { min: 10, max: 500 });
      const memo = row.text("memo", { max: 300 });
      if ((lat === null) !== (lng === null) && row.ok) row.fail(lat === null ? "lat" : "lng", "위도와 경도는 함께 적어야 합니다(한쪽만 있으면 지도에 못 찍습니다)");
      if (!stops.coordsReady && (address || lat !== null || radius !== null)) {
        row.fail(address ? "address" : lat !== null ? "lat" : "radius", "정류장 주소·좌표 기능이 아직 준비되지 않았습니다(마이그레이션 0244a 필요) — 이 칸을 비워 주세요");
      }
      if (!row.ok || !name) continue;
      const key = nameKey(name);
      parsedStops.push({ rowNum: row.rowNum, key });
      fileStopNames.add(key);
      const summary = [address, lat !== null ? `좌표 ${lat}, ${lng}` : null, memo].filter(Boolean).join(" · ") || "—";
      const cands = stopsByName.get(key) ?? [];
      if (cands.length > 1) {
        if (mode === "append") {
          stopSkip += 1;
          preview.push({ sheet: STOP_SHEET, rowNum: row.rowNum, key: name, action: "skip", summary: `이미 있음(${cands.length}곳) · ${summary}` });
        } else {
          row.fail("name", `같은 이름 정류장이 ${cands.length}곳이라 어느 것을 고칠지 모릅니다 — 화면에서 고쳐 주세요`);
        }
        continue;
      }
      const cur = cands[0];
      if (!cur) {
        plan.stopInserts.push({ name, memo, address, lat, lng, radius_m: radius });
        preview.push({ sheet: STOP_SHEET, rowNum: row.rowNum, key: name, action: "insert", summary });
        continue;
      }
      if (mode === "append") {
        stopSkip += 1;
        preview.push({ sheet: STOP_SHEET, rowNum: row.rowNum, key: name, action: "skip", summary: `이미 있음 · ${summary}` });
        continue;
      }
      const patch: Partial<StopWrite> = {};
      if (memo !== null && memo !== cur.memo) patch.memo = memo;
      if (address !== null && address !== (cur.address ?? null)) patch.address = address;
      if (lat !== null && lng !== null && (lat !== cur.lat || lng !== cur.lng)) {
        patch.lat = lat;
        patch.lng = lng;
      }
      if (radius !== null && radius !== cur.radius_m) patch.radius_m = radius;
      if (Object.keys(patch).length === 0) {
        stopSkip += 1;
        preview.push({ sheet: STOP_SHEET, rowNum: row.rowNum, key: name, action: "skip", summary: "바뀐 칸 없음" });
      } else {
        plan.stopUpdates.push({ id: cur.id, patch });
        preview.push({ sheet: STOP_SHEET, rowNum: row.rowNum, key: name, action: "update", summary: `${Object.keys(patch).length}칸 바꿈 · ${summary}` });
      }
    }
    issues.push(...duplicateKeyIssues(STOP_SHEET, parsedStops, (r) => r.key, "정류장 이름"));

    // ── 승하차 ───────────────────────────────────────────────────────────────────────
    const vehicleByName = new Map<string, Vehicle[]>();
    for (const v of routing.vehicles) vehicleByName.set(nameKey(v.name), [...(vehicleByName.get(nameKey(v.name)) ?? []), v]);
    const runByKey = new Map(routing.runs.map((r) => [`${r.vehicle_id}|${r.season}|${r.run_no}`, r]));
    const runStopByKey = new Map(routing.runStops.filter((r) => r.kind === "stop" && r.stop_id).map((r) => [`${r.run_id}|${r.stop_id}`, r]));
    const riderByKey = new Map(routing.riders.map((r) => [`${r.run_stop_id}|${r.student_id}|${r.io_kind}`, r]));
    let riderSkip = 0;
    let riderUpdate = 0;
    const parsedRiders: { rowNum: number; key: string }[] = [];

    for (const row of riderSheet?.rows ?? []) {
      const student = students.resolve(row, { name: "studentName", school: "school", grade: "grade" });
      const vehicleName = row.text("vehicle", { required: true, max: 40 });
      const season = row.option("season", SEASON_OPTIONS) ?? "term";
      const runNo = row.int("runNo", { required: true, min: 1, max: 30 });
      const stopName = row.text("stop", { required: true, max: 80 });
      const io = row.option("io", IO_OPTIONS, true);
      const daysRaw = row.text("weekdays", { required: true });
      const memo = row.text("memo", { max: 200 });
      let days: DayCode[] | null = null;
      if (daysRaw) {
        const d = parseDays(daysRaw);
        if (!d || d.length === 0) row.fail("weekdays", "요일로 읽을 수 없습니다 — '월,수,금' 또는 '월수금'처럼 적어 주세요");
        else days = d;
      }
      if (!row.ok || !student || !vehicleName || runNo === null || !stopName || !io || !days) continue;
      const vs = vehicleByName.get(nameKey(vehicleName)) ?? [];
      if (vs.length !== 1) {
        row.fail("vehicle", vs.length === 0 ? `'${vehicleName}' 차량이 없습니다 — 셔틀 편성의 차량 이름 그대로 적어 주세요` : `'${vehicleName}' 이름의 차량이 ${vs.length}대입니다 — 편성에서 이름을 구분해 주세요`);
        continue;
      }
      const run = runByKey.get(`${vs[0]!.id}|${season}|${runNo}`);
      if (!run) {
        row.fail("runNo", `${vehicleName} ${SEASON_LABEL[season]} ${runNo}회차가 없습니다 — 셔틀 편성에서 회차를 먼저 만들어 주세요`);
        continue;
      }
      const stopCands = stopsByName.get(nameKey(stopName)) ?? [];
      if (stopCands.length === 0) {
        row.fail("stop", fileStopNames.has(nameKey(stopName)) ? "새로 넣는 정류장은 아직 노선에 없습니다 — 반영한 뒤 셔틀 편성에서 노선에 넣고 승하차를 다시 올려 주세요" : `'${stopName}' 정류장이 없습니다`);
        continue;
      }
      // 같은 이름이 여럿이면 **그 회차 노선에 있는 것**이 하나일 때만 고른다.
      const onRoute = stopCands.filter((s) => runStopByKey.has(`${run.id}|${s.id}`));
      if (stopCands.length > 1 && onRoute.length !== 1) {
        row.fail("stop", `같은 이름 정류장이 ${stopCands.length}곳이라 어느 것인지 모릅니다 — 셔틀 편성에서 이름을 구분해 주세요`);
        continue;
      }
      const stop = onRoute[0] ?? stopCands[0]!;
      const rs = runStopByKey.get(`${run.id}|${stop.id}`);
      if (!rs) {
        row.fail("stop", `${vehicleName} ${runNo}회차 노선에 '${stop.name}' 정류장이 없습니다 — 셔틀 편성에서 노선에 먼저 넣어 주세요`);
        continue;
      }
      const key = `${rs.id}|${student.id}|${io}`;
      parsedRiders.push({ rowNum: row.rowNum, key });
      const label = student.name;
      const summary = `${vehicleName} ${SEASON_LABEL[season]} ${runNo}회차 · ${stop.name} · ${IO_OPTIONS.find((o) => o.value === io)!.label} · ${days.map(dayLabel).join("")}`;
      if (run.direction !== io) notes.push(`${row.rowNum}행 ${label}: ${DIRECTION_LABEL[run.direction as Direction] ?? ""} 회차에 ${io === "in" ? "승차" : "하차"}로 배정합니다(한 회차에 섞일 수 있습니다 — 의도가 맞는지 확인하세요)`);
      const cur = riderByKey.get(key);
      if (!cur) {
        plan.riderInserts.push({ run_stop_id: rs.id, student_id: student.id, io_kind: io, weekdays: days, memo });
        preview.push({ sheet: RIDER_SHEET, rowNum: row.rowNum, key: label, action: "insert", summary });
        continue;
      }
      if (mode === "append") {
        riderSkip += 1;
        preview.push({ sheet: RIDER_SHEET, rowNum: row.rowNum, key: label, action: "skip", summary: `이미 배정됨 · ${summary}` });
        continue;
      }
      const patch: { weekdays?: DayCode[]; memo?: string } = {};
      const curDays = SHUTTLE_DAYS.filter((d) => cur.weekdays.includes(d));
      if (curDays.join(",") !== days.join(",")) patch.weekdays = days;
      if (memo !== null && memo !== cur.memo) patch.memo = memo;
      if (Object.keys(patch).length === 0) {
        riderSkip += 1;
        preview.push({ sheet: RIDER_SHEET, rowNum: row.rowNum, key: label, action: "skip", summary: "바뀐 칸 없음" });
      } else {
        plan.riderUpdates.push({ id: cur.id, patch });
        riderUpdate += 1;
        preview.push({ sheet: RIDER_SHEET, rowNum: row.rowNum, key: label, action: "update", summary });
      }
    }
    issues.push(...duplicateKeyIssues(RIDER_SHEET, parsedRiders, (r) => r.key, "승하차 배정(원생·정류장·승하차)"));

    return {
      counts: [
        { label: "정류장", total: sheets[STOP_SHEET]?.rows.length ?? 0, insert: plan.stopInserts.length, update: plan.stopUpdates.length, skip: stopSkip },
        { label: "승하차", total: riderSheet?.rows.length ?? 0, insert: plan.riderInserts.length, update: riderUpdate, skip: riderSkip },
      ],
      preview,
      notes,
      plan,
    };
  },

  async apply({ ctx, plan }) {
    const admin = createAdminClient();
    const friendly = (e: { code?: string; message: string }, what: string) =>
      e.code === "23505" ? `${what} — 같은 이름이 방금 생겼습니다(미리보기를 다시 받아 주세요)` : `${what} — ${e.message}`;
    if (plan.stopInserts.length) {
      const { error } = await admin.from("shuttle_stops").insert(
        plan.stopInserts.map((s) => ({
          tenant_id: ctx.tenantId,
          name: s.name,
          memo: s.memo,
          // 좌표 칸이 없는 배포면 키를 아예 안 보낸다(#95).
          ...(plan.coordsReady ? { address: s.address, lat: s.lat, lng: s.lng, ...(s.radius_m !== null ? { radius_m: s.radius_m } : {}) } : {}),
        })),
      );
      if (error) return { error: friendly(error, "정류장을 넣지 못했습니다") };
    }
    for (const u of plan.stopUpdates) {
      const { error } = await admin.from("shuttle_stops").update(u.patch).eq("tenant_id", ctx.tenantId).eq("id", u.id);
      if (error) return { error: friendly(error, "정류장 갱신 중 멈췄습니다(새 정류장은 들어갔습니다)") };
    }
    if (plan.riderInserts.length) {
      const { error } = await admin.from("shuttle_riders").insert(plan.riderInserts.map((r) => ({ tenant_id: ctx.tenantId, ...r })));
      if (error) return { error: friendly(error, "승하차 배정을 넣지 못했습니다(정류장은 반영됐습니다)") };
    }
    for (const u of plan.riderUpdates) {
      const { error } = await admin.from("shuttle_riders").update(u.patch).eq("tenant_id", ctx.tenantId).eq("id", u.id);
      if (error) return { error: friendly(error, "승하차 배정 갱신 중 멈췄습니다") };
    }
    return {};
  },
};

export default def;
