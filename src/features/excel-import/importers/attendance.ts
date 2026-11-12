import "server-only";
import { kstToday } from "@/lib/date-kst";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { autoUnitsApply, autoUnitsKey, newRowUnits } from "@/features/attendance/auto-units";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { resolveAutoUnits } from "@/features/attendance/server/auto-units";
import { completeMakeupReservations } from "@/features/attendance/server/makeup-reservation-complete";
import { parseSessionUnits } from "@/features/attendance/session-units";
import { IMPORT_META } from "../kinds";
import { duplicateKeyIssues, type ColumnSpec, type ImportPreviewRow, type SheetSpec } from "../spec";
import { ClassIndex, StudentIndex } from "../server/lookups";
import type { ImporterDef } from "../server/types";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * 출결 가져오기 — 체크리스트 12번 "출결·보강"(과거 출결을 옮길 때). 쓰기 모양은 **월별 출석부 반별 입력**(`saveAttendance`)과 같다:
 * 새 칸 = 새 행(교시 칸을 비우면 "그날 전체" = slot_start null) · 이미 찍힌 칸 = 그 행을 제자리에서 고친다(정정 이력은 recorded_at).
 * 🔑 매칭 = 원생 + 반 + 수업일(+ 시작시각을 적었으면 그 교시). 그날 **유효 행**(`effectiveAttendanceRecords`)만 본다.
 * 🔑 수학 자동 시수 — 새 칸 + 시수 칸을 비운 행만(`resolveAutoUnits`·`newRowUnits`, 출석부와 같은 판정). 숫자를 친 건 그대로.
 * 🔴 **보강은 받지 않는다** — 보강은 결석 연결·예약·기한 규칙이 함께 움직여서 화면(보강 추가)에서만. 🔴 오늘 이후 날짜 거절.
 * 🔴 그날 그 반을 **수강 중**(반열림 `[start, end)`, [[#125]])이어야 한다 — 명단 밖 학생의 출결을 밀어 넣지 않는다([[#77]]).
 * ⚠️ 전원 완료 벨(`notifyIfClassAttendanceComplete`)은 울리지 않는다 — 과거 기록을 옮기는 일이라 강사에게 알릴 일이 아니다.
 *    보강 **예약** 이행(`completeMakeupReservations`)은 출석부 저장과 똑같이 태운다(예약이 걸린 날이면 그 예약이 끝나야 한다).
 */
type K = "code" | "name" | "school" | "grade" | "className" | "subject" | "date" | "slot" | "status" | "units" | "note";
const SHEET = "출결";

const STATUS_OPTIONS = [
  { label: "출석", value: "present", aliases: ["o", "○"] },
  { label: "지각", value: "late" },
  { label: "결석", value: "absent", aliases: ["x", "×"] },
  { label: "공결", value: "excused", aliases: ["사유결석", "인정결석"] },
  { label: "조퇴", value: "early_leave" },
] as const;
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, s.label]));

function columns(subjectLabels: readonly string[]): ColumnSpec<K>[] {
  return [
    { key: "code", header: "원생번호", width: 10, aliases: ["학생번호"] },
    { key: "name", header: "이름", width: 10, required: true, aliases: ["원생", "학생명", "성명"] },
    { key: "school", header: "학교", width: 12 },
    { key: "grade", header: "학년", width: 7 },
    { key: "className", header: "반", width: 16, required: true, aliases: ["반이름", "반명", "수업"] },
    { key: "subject", header: "과목", width: 8, options: subjectLabels, hint: "같은 이름 반이 과목별로 있을 때만" },
    { key: "date", header: "수업일", width: 12, required: true, aliases: ["날짜", "출석일", "일자"], hint: "2026-09-01. 오늘 이후는 넣을 수 없습니다." },
    { key: "slot", header: "시작시각", width: 9, aliases: ["교시시작", "시각"], hint: "비우면 그날 전체(월별 출석부 입력과 같음). 적으면 그 반의 그 요일 수업 시작 시각이어야 합니다." },
    { key: "status", header: "출결", width: 8, required: true, aliases: ["상태", "출결상태"], options: STATUS_OPTIONS.map((s) => s.label), strictOptions: true },
    { key: "units", header: "시수", width: 6, hint: "비우면 기본(수학은 그날 수업 길이로 자동). 1.5처럼 소수 한 자리." },
    { key: "note", header: "사유/메모", width: 28, aliases: ["사유", "메모", "비고"] },
  ];
}
function spec(subjectLabels: readonly string[]): SheetSpec<K> {
  return { name: SHEET, columns: columns(subjectLabels), keyHint: IMPORT_META.attendance.keyHint };
}

type AttRow = { id: string; student_id: string; class_id: string; session_date: string; slot_start: string | null; recorded_at: string; status: string; note: string | null; session_units: number | null };
type Ins = { rowNum: number; studentId: string; classId: string; date: string; slot: string | null; status: string; note: string | null; rawUnits: string; units: number | null };
type Upd = { ids: string[]; studentId: string; classId: string; date: string; status: string; note: string | null; units: number | null; single: boolean; unitsExplicit: boolean };
type Plan = { inserts: Ins[]; updates: Upd[] };

const WEEKDAY_ENUM = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const hhmm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : null);

const def: ImporterDef<Plan> = {
  kind: "attendance",
  title: IMPORT_META.attendance.title,
  menu: "attendance",
  sheets: [spec([])],
  singleSheet: true,
  modeHelp: IMPORT_META.attendance.modeHelp,
  guide: [
    "· 한 줄 = 원생 한 명의 한 수업일 출결. 주황 칸(*)은 필수입니다.",
    "· 원생은 원생번호가 있으면 그 번호, 없으면 이름(+학교·학년)으로 찾습니다. 반은 수업목록의 반 이름 그대로.",
    "· 그날 그 반을 수강 중인 원생만 넣을 수 있습니다(반 배정이 먼저 있어야 합니다).",
    "· '추가' = 이미 출결이 있는 칸은 건너뜀 · '덮어쓰기' = 이미 있는 칸도 파일 값으로 고칩니다(메모 칸을 비우면 메모는 그대로).",
    "· 시작시각을 비우면 그날 전체 한 칸으로 들어갑니다(월별 출석부 입력과 같습니다).",
    "· 보강은 이 파일로 넣지 않습니다 — 결석 연결·보강 예약과 함께 움직여서 출석부의 '보강 추가'로 넣어 주세요.",
    "· 오늘 이후 날짜는 넣을 수 없습니다.",
  ],
  revalidate: ["/attendance", "/ecs", "/onescreen"],

  async template() {
    const settings = await getTenantSettings();
    return [{ spec: spec(buildSubjectMaps(settings.operations.subjects).options.map((o) => o.label)), rows: [] }];
  },

  async plan({ ctx, mode, sheets, issues }) {
    const sheet = sheets[SHEET];
    const [settings, db] = await Promise.all([getTenantSettings(), createClient()]);
    const subjectOptions = buildSubjectMaps(settings.operations.subjects).options.map((o) => ({ label: o.label, value: o.value }));
    const [students, classes] = await Promise.all([
      StudentIndex.load(db, ctx.tenantId, { includeWithdrawn: true }),
      ClassIndex.load(db, ctx.tenantId),
    ]);
    const today = kstToday();

    type Parsed = { rowNum: number; row: NonNullable<typeof sheet>["rows"][number]; studentId: string; studentName: string; classId: string; className: string; date: string; slot: string | null; status: string; note: string | null; rawUnits: string; units: number | null };
    const parsed: Parsed[] = [];
    for (const row of sheet?.rows ?? []) {
      const st = students.resolve(row, { code: "code", name: "name", school: "school", grade: "grade" });
      const subject = row.option("subject", subjectOptions);
      const cls = classes.resolve(row, "className", subject);
      const date = row.date("date", true);
      if (date && date > today) row.fail("date", "오늘 이후 날짜는 넣을 수 없습니다(출결은 수업한 뒤에)");
      const slot = row.time("slot");
      const isMakeup = /^보강$/.test(row.raw("status").trim());
      if (isMakeup) row.fail("status", "보강은 이 파일로 넣지 않습니다 — 출석부의 '보강 추가'로 넣어 주세요(결석 연결·예약과 함께 움직입니다)");
      const status = isMakeup ? null : row.option("status", STATUS_OPTIONS, true);
      const rawUnits = row.raw("units").trim();
      const pu = parseSessionUnits(rawUnits);
      if (!pu.ok) row.fail("units", pu.error);
      const note = row.text("note", { max: 500 });
      if (!row.ok || !st || !cls || !date || !status || !pu.ok) continue;
      parsed.push({ rowNum: row.rowNum, row, studentId: st.id, studentName: st.name, classId: cls.id, className: cls.class_name, date, slot, status, note, rawUnits, units: pu.value });
    }
    issues.push(...duplicateKeyIssues(SHEET, parsed, (p) => `${p.studentId}|${p.classId}|${p.date}|${p.slot ?? ""}`, "원생·반·수업일(·시작시각)"));

    // ── 수강·교시·기존 출결 — 서로 독립(B4). 반 id × 행이 많은 표는 청크 × 페이징(B2·B3). ──
    const classIds = [...new Set(parsed.map((p) => p.classId))];
    const studentIds = [...new Set(parsed.map((p) => p.studentId))];
    const dates = parsed.map((p) => p.date).sort();
    const from = dates[0] ?? today;
    const to = dates[dates.length - 1] ?? today;
    type Enr = { student_id: string; class_id: string; start_date: string; end_date: string | null };
    type Sch = { class_id: string; day_of_week: string; start_time: string; valid_from: string | null; valid_to: string | null };
    const [enrollments, schedules, records] = parsed.length
      ? await Promise.all([
          fetchAllPagedInChunks<Enr>(studentIds, (chunk, f, t) =>
            db
              .from("enrollments")
              .select("student_id, class_id, start_date, end_date")
              .eq("tenant_id", ctx.tenantId)
              .in("student_id", chunk)
              .lte("start_date", to)
              .order("id")
              .range(f, t),
          ),
          parsed.some((p) => p.slot)
            ? fetchAllPagedInChunks<Sch>(classIds, (chunk, f, t) =>
                db
                  .from("class_schedules")
                  .select("class_id, day_of_week, start_time, valid_from, valid_to")
                  .eq("tenant_id", ctx.tenantId)
                  .in("class_id", chunk)
                  .order("id")
                  .range(f, t),
              )
            : Promise.resolve([] as Sch[]),
          fetchAllPagedInChunks<AttRow>(classIds, (chunk, f, t) =>
            db
              .from("attendance_records")
              .select("id, student_id, class_id, session_date, slot_start, recorded_at, status, note, session_units")
              .eq("tenant_id", ctx.tenantId)
              .in("class_id", chunk)
              .gte("session_date", from)
              .lte("session_date", to)
              .order("id")
              .range(f, t),
          ),
        ])
      : [[] as Enr[], [] as Sch[], [] as AttRow[]];

    // 🔴 회차 확정이 끝난 (원생 × 반 × 달)엔 넣지도 고치지도 않는다 — 확정 시수·배분·강사 정산의 근거가 흔들린다.
    //    확정 = `invoice_session_terms.confirmed_sessions`가 있는 행. 달은 그 청구서의 청구월(`invoices.period`).
    //    임베드 대신 두 번 묻는다(FK 이름 모호성 [[#94]]). 청구서 id 목록은 청크(B3).
    const confirmed = new Set<string>();
    if (classIds.length) {
      const terms = await fetchAllPagedInChunks<{ id: string; invoice_id: string; class_id: string }>(classIds, (chunk, f, t) =>
        db
          .from("invoice_session_terms")
          .select("id, invoice_id, class_id")
          .eq("tenant_id", ctx.tenantId)
          .in("class_id", chunk)
          .not("confirmed_sessions", "is", null)
          .order("id")
          .range(f, t),
      );
      const invoiceIds = [...new Set(terms.map((t) => t.invoice_id))];
      const months = new Set(parsed.map((p) => p.date.slice(0, 7)));
      const invs = await fetchAllPagedInChunks<{ id: string; student_id: string; period: string }>(invoiceIds, (chunk, f, t) =>
        db.from("invoices").select("id, student_id, period").eq("tenant_id", ctx.tenantId).in("id", chunk).order("id").range(f, t),
      );
      const invById = new Map(invs.filter((i) => months.has(i.period)).map((i) => [i.id, i]));
      for (const t of terms) {
        const inv = invById.get(t.invoice_id);
        if (inv) confirmed.add(`${inv.student_id}|${t.class_id}|${inv.period}`);
      }
    }

    const effective = effectiveAttendanceRecords(records);
    const dayRows = new Map<string, AttRow[]>();
    for (const r of effective) {
      const k = `${r.student_id}|${r.class_id}|${r.session_date}`;
      (dayRows.get(k) ?? dayRows.set(k, []).get(k)!).push(r);
    }

    const plan: Plan = { inserts: [], updates: [] };
    const preview: ImportPreviewRow[] = [];
    let skip = 0;
    for (const p of parsed) {
      const { row } = p;
      // 그날 수강 중 — 반열림 [start, end)
      const enrolled = enrollments.some(
        (e) => e.student_id === p.studentId && e.class_id === p.classId && e.start_date <= p.date && (!e.end_date || e.end_date > p.date),
      );
      if (confirmed.has(`${p.studentId}|${p.classId}|${p.date.slice(0, 7)}`)) {
        row.fail("date", `${p.date.slice(0, 7)} '${p.className}' 반은 이 원생의 회차 확정이 끝났습니다 — 출결을 바꾸면 확정 시수·정산이 달라집니다(수납관리 › 회차 확정에서 먼저 해제)`);
        continue;
      }
      if (!enrolled) {
        row.fail("className", `${p.date}에 '${p.className}' 반을 수강 중이 아닙니다 — 반 배정(시작·종료일)을 먼저 확인하세요`);
        continue;
      }
      if (p.slot) {
        const wd = WEEKDAY_ENUM[weekdayOf(p.date)];
        const ok = schedules.some(
          (s) =>
            s.class_id === p.classId &&
            s.day_of_week === wd &&
            hhmm(s.start_time) === p.slot &&
            (!s.valid_from || s.valid_from <= p.date) &&
            (!s.valid_to || s.valid_to >= p.date),
        );
        if (!ok) {
          row.fail("slot", `${p.date}(${"일월화수목금토"[weekdayOf(p.date)]}) '${p.className}' 반에 ${p.slot} 시작 수업이 없습니다 — 비우면 그날 전체로 들어갑니다`);
          continue;
        }
      }
      const all = dayRows.get(`${p.studentId}|${p.classId}|${p.date}`) ?? [];
      // 교시를 적었으면 그 교시 행(없으면 그날 전체 행), 안 적었으면 그날 유효 행 전부 — 출석부 저장과 같은 범위.
      const targets = p.slot
        ? (() => {
            const same = all.filter((r) => hhmm(r.slot_start) === p.slot);
            return same.length ? same : all.filter((r) => !r.slot_start);
          })()
        : all;
      const label = `${p.studentName} · ${p.className} · ${p.date}${p.slot ? ` ${p.slot}` : ""}`;
      // 🔴 보강 칸은 파일로 덮지 않는다 — 결석·보강 예약과 이어진 기록이라 출석/결석으로 바꾸면 그 연결이 끊긴다(적대 리뷰 2026-09-29).
      if (targets.length && mode === "overwrite" && targets.some((t) => t.status === "makeup")) {
        row.fail("status", "이 칸은 보강 기록이라 파일로 바꿀 수 없습니다 — 출석부 화면에서 고쳐 주세요");
        continue;
      }
      if (targets.length) {
        if (mode === "append") {
          skip += 1;
          preview.push({ sheet: SHEET, rowNum: p.rowNum, key: p.studentName, action: "skip", summary: `${label} · 이미 ${STATUS_LABEL[targets[0]!.status] ?? "기록"} 있음` });
          continue;
        }
        const same = targets.every((t) => t.status === p.status && (p.note === null || t.note === p.note) && (p.rawUnits === "" || t.session_units === p.units));
        if (same) {
          skip += 1;
          preview.push({ sheet: SHEET, rowNum: p.rowNum, key: p.studentName, action: "skip", summary: `${label} · 바뀐 칸 없음` });
          continue;
        }
        plan.updates.push({ ids: targets.map((t) => t.id), studentId: p.studentId, classId: p.classId, date: p.date, status: p.status, note: p.note, units: p.rawUnits === "" ? null : p.units, single: targets.length === 1 && p.rawUnits !== "", unitsExplicit: p.rawUnits !== "" });
        preview.push({ sheet: SHEET, rowNum: p.rowNum, key: p.studentName, action: "update", summary: `${label} · ${STATUS_LABEL[targets[0]!.status] ?? "—"} → ${STATUS_LABEL[p.status]}` });
        continue;
      }
      plan.inserts.push({ rowNum: p.rowNum, studentId: p.studentId, classId: p.classId, date: p.date, slot: p.slot, status: p.status, note: p.note, rawUnits: p.rawUnits, units: p.units });
      preview.push({ sheet: SHEET, rowNum: p.rowNum, key: p.studentName, action: "insert", summary: `${label} · ${STATUS_LABEL[p.status]}${p.rawUnits ? ` · 시수 ${p.rawUnits}` : ""}` });
    }
    const updatesMulti = plan.updates.filter((u) => u.ids.length > 1).length;
    const notes = updatesMulti
      ? [`그날 교시가 여럿인 칸 ${updatesMulti}건은 모든 교시를 같은 출결로 고치고 시수는 그대로 둡니다(출석부 반별 입력과 같습니다)`]
      : [];
    return {
      counts: [{ label: "출결", total: sheet?.rows.length ?? 0, insert: plan.inserts.length, update: plan.updates.length, skip }],
      preview,
      notes,
      plan,
    };
  },

  async apply({ ctx, plan }) {
    const db = await createClient();
    const userId = ctx.user.id;
    const nowIso = new Date().toISOString();

    // 수학 자동 시수 — 새 칸 + 시수 칸을 비운 행만(출석부와 같은 판정).
    const wantsAuto = (r: Ins) => autoUnitsApply({ rawUnits: r.rawUnits, slotStart: r.slot, status: r.status });
    const auto = plan.inserts.some(wantsAuto)
      ? await resolveAutoUnits(db, plan.inserts.filter(wantsAuto).map((r) => ({ classId: r.classId, date: r.date, slotStart: r.slot })), { tenantId: ctx.tenantId })
      : new Map<string, number>();

    let inserted = 0;
    for (let i = 0; i < plan.inserts.length; i += 300) {
      const chunk = plan.inserts.slice(i, i + 300);
      const { error } = await db.from("attendance_records").insert(
        chunk.map((r) => ({
          tenant_id: ctx.tenantId,
          class_id: r.classId,
          student_id: r.studentId,
          session_date: r.date,
          slot_start: r.slot,
          status: r.status,
          note: r.note,
          session_units: newRowUnits(r.rawUnits, r.units, wantsAuto(r) ? (auto.get(autoUnitsKey(r.classId, r.date, r.slot)) ?? null) : undefined).units,
          recorded_by: userId,
        })),
      );
      if (error) return { error: `${chunk[0]!.rowNum}~${chunk[chunk.length - 1]!.rowNum}행 출결을 넣지 못했습니다 — ${error.message}${inserted ? ` · 그 앞 ${inserted}건은 들어갔습니다` : ""}` };
      inserted += chunk.length;
    }
    let updated = 0;
    for (const u of plan.updates) {
      const patch: Record<string, unknown> = { status: u.status, recorded_by: userId, recorded_at: nowIso };
      if (u.note !== null) patch.note = u.note;
      // 🔴 교시가 여럿이면 시수는 건드리지 않는다 — 한 숫자를 각 교시에 쓰면 교시 수만큼 부풀려진다(saveAttendance와 같은 규칙).
      if (u.single) patch.session_units = u.units;
      const { error } = await db
        .from("attendance_records")
        .update(patch)
        .in("id", u.ids)
        .eq("tenant_id", ctx.tenantId)
        .eq("class_id", u.classId)
        .eq("student_id", u.studentId)
        .eq("session_date", u.date);
      if (error) return { error: `${explainDbError(error, { scope: "excel-import.attendance", fallback: "출결 고치기 중 멈췄습니다 — 잠시 후 다시 시도해 주세요" }).message} (새 칸 ${inserted}건 · 고친 칸 ${updated}건은 반영됐습니다)` };
      updated += 1;
    }

    // 보강 예약 이행(0264a) — 출석부 저장과 같은 호출. 실패해도 출결은 그대로(그 함수가 스스로 삼킨다).
    const created = new Set(plan.inserts.map((r) => `${r.studentId}|${r.classId}|${r.date}`));
    await completeMakeupReservations(
      { tenantId: ctx.tenantId },
      [...plan.inserts, ...plan.updates].map((r) => ({
        studentId: r.studentId,
        classId: r.classId,
        date: r.date,
        status: r.status,
        unitsExplicit: "rawUnits" in r ? r.rawUnits !== "" : r.unitsExplicit,
        created: created.has(`${r.studentId}|${r.classId}|${r.date}`),
      })),
    );
    return {};
  },
};

export default def;
