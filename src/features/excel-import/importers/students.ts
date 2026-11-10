import "server-only";
import { kstToday } from "@/lib/date-kst";
import { seatBlockReason } from "@/lib/license/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { canonicalSchoolName, fillSchoolKind } from "@/features/schools/school-name";
import { loadSchoolKeys } from "@/features/schools/server/complete-kind";
import { naturalKey } from "@/features/students/lib/student-import";
import { resolveUniqueStudentName } from "@/features/students/name-suffix";
import { STUDENT_STATUS_LABEL } from "@/features/students/status/status-labels";
import { planFormWithdrawal } from "@/features/students/withdrawal-plan";
import { formWithdrawalViaReport, SCHEDULE_VIA_REPORT } from "@/features/withdrawals/via-report";
import { canManageStudentStatusNow } from "@/features/students/server/status-access";
import { statusCreationNeedsPermission, STUDENT_STATUS_DENIED } from "@/features/students/status-access";
import { LEGACY_REASON_LABELS, REASON_LABEL, type WithdrawalMetadata, type WithdrawalReason } from "@/features/withdrawals/types";
import { checkReasonInput } from "@/features/withdrawals/reason-detail";
import { IMPORT_META } from "../kinds";
import { duplicateKeyIssues, type ColumnSpec, type ImportPreviewRow, type SheetSpec } from "../spec";
import type { ImporterDef } from "../server/types";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * 원생 가져오기 — 옛 '학생 엑셀 일괄등록'(7칸 · 추가만)을 대신한다. 체크리스트 4번 "원생 명단"의 칸 전부.
 * 🔑 매칭 = 원생번호(적었고 있으면) → 없으면 이름+학교+학년(퇴원 아닌 원생 — DB 자연키와 같은 기준).
 * 🔑 새 원생 이름이 기존 원생과 겹치면 접미사(A·B·C) — 모든 생성 경로와 같은 규칙(`resolveUniqueStudentName`).
 * 🔴 덮어쓰기여도 **상태·이름은 바꾸지 않는다** — 상태(퇴원·휴원)는 반 배정 종료가 함께 움직여야 해서 원생 화면에서만.
 *    빈 칸은 지우지 않는다(원래 값 유지). 퇴원일이 미래면 퇴원 예약(등록 폼과 같은 `planFormWithdrawal`).
 */
type K =
  | "code" | "name" | "englishName" | "school" | "grade" | "gender" | "birthDate" | "status"
  | "studentPhone" | "parentName" | "parentRelation" | "parentPhone" | "address" | "email" | "enrolledAt" | "withdrawnAt"
  | "withdrawalReason" | "withdrawalMemo" | "notes";

const STATUS_OPTIONS = [
  { label: "재원", value: "enrolled" },
  { label: "예비", value: "prospect", aliases: ["상담", "대기"] },
  { label: "상담완료", value: "consulted" },
  { label: "휴원", value: "on_hold" },
  { label: "퇴원", value: "withdrawn" },
] as const;
/**
 * 퇴원 사유 = 퇴원관리와 같은 대분류(라벨 글로 적는다 · 옛 라벨도 받는다). 새로 넣는 원생이 퇴원·퇴원 예약이면 필수, '기타'면
 * 퇴원메모도 필수(원장 2026-10-15 *"기타는 모든 곳을 일치하게"* — 예전엔 사유 없이 '기타'로 들어갔다). 세부 사유는 화면에서 고친다.
 */
const REASON_OPTIONS = (Object.entries(REASON_LABEL) as [WithdrawalReason, string][]).map(([value, label]) => ({
  label,
  value,
  aliases: Object.entries(LEGACY_REASON_LABELS).filter(([, v]) => v === value).map(([old]) => old),
}));
const GENDER_OPTIONS = [
  { label: "남", value: "male", aliases: ["남자", "남성", "m"] },
  { label: "여", value: "female", aliases: ["여자", "여성", "f"] },
] as const;

function columns(gradeLevels: readonly string[]): ColumnSpec<K>[] {
  return [
    { key: "code", header: "원생번호", width: 12, aliases: ["학생번호", "원번", "기존번호"], hint: "기존 시스템의 원생 고유번호. 있으면 이 번호로 같은 원생을 찾습니다." },
    { key: "name", header: "이름", width: 10, required: true, aliases: ["성명", "학생명", "원생명"] },
    { key: "englishName", header: "영문이름", width: 12, aliases: ["영어이름"] },
    { key: "school", header: "학교", width: 14 },
    { key: "grade", header: "학년", width: 8, options: gradeLevels, hint: "학원 설정의 학년 표기(예: 중1)" },
    { key: "gender", header: "성별", width: 6, options: ["남", "여"], strictOptions: true },
    { key: "birthDate", header: "생년월일", width: 12, hint: "2012-03-05" },
    { key: "status", header: "상태", width: 9, options: STATUS_OPTIONS.map((s) => s.label), strictOptions: true, hint: "비우면 재원. 덮어쓰기에서도 기존 원생의 상태는 바꾸지 않습니다(원생 화면에서)." },
    { key: "studentPhone", header: "원생연락처", width: 14, aliases: ["학생연락처", "학생전화"] },
    { key: "parentName", header: "보호자명", width: 10, aliases: ["학부모명", "보호자"] },
    { key: "parentRelation", header: "보호자관계", width: 9, aliases: ["관계"], options: ["모", "부", "조부모", "기타"] },
    { key: "parentPhone", header: "보호자연락처", width: 14, aliases: ["학부모연락처", "학부모전화", "연락처", "부모연락처"] },
    { key: "address", header: "주소", width: 28 },
    { key: "email", header: "이메일", width: 20 },
    { key: "enrolledAt", header: "등록일", width: 12, aliases: ["입학일", "입원일"] },
    { key: "withdrawnAt", header: "퇴원일", width: 12, hint: "상태가 퇴원이면 필수(오늘까지의 날짜). 퇴원 예약(오늘 이후 날짜)은 가져오지 않습니다 — 퇴원보고서로." },
    { key: "withdrawalReason", header: "퇴원사유", width: 14, options: REASON_OPTIONS.map((o) => o.label), strictOptions: true, hint: "새로 넣는 원생이 퇴원이면 필수. '기타'면 퇴원메모도 적어 주세요." },
    { key: "withdrawalMemo", header: "퇴원메모", width: 24, aliases: ["퇴원 메모", "퇴원사유 메모"], hint: "실제 사유('기타'는 필수)." },
    { key: "notes", header: "메모", width: 30, aliases: ["비고", "특이사항"] },
  ];
}
const SHEET = "원생";
function spec(gradeLevels: readonly string[]): SheetSpec<K> {
  return { name: SHEET, columns: columns(gradeLevels), keyHint: IMPORT_META.students.keyHint };
}

type Existing = {
  id: string; name: string; school: string | null; grade: string | null; status: string; student_code: string | null;
  english_name: string | null; gender: string | null; birth_date: string | null; student_phone: string | null; parent_name: string | null;
  parent_relation: string | null; parent_phone: string | null; address: string | null; email: string | null; enrolled_at: string | null;
  withdrawn_at: string | null; notes: string | null;
};
type Fields = Partial<Record<Exclude<K, "code" | "name" | "status" | "withdrawalReason" | "withdrawalMemo">, string | null>>;
type Insert = {
  rowNum: number; name: string; code: string | null; status: string; withdrawnAt: string | null; scheduled: boolean; fields: Fields;
  /** 퇴원·퇴원 예약으로 넣는 줄의 사유(그 밖엔 null). */
  withdrawal: WithdrawalMetadata | null;
};
type Update = { id: string; patch: Record<string, string | null> };
type Plan = { inserts: Insert[]; updates: Update[] };

const FIELD_COL: Record<keyof Fields, string> = {
  englishName: "english_name", school: "school", grade: "grade", gender: "gender", birthDate: "birth_date", studentPhone: "student_phone",
  parentName: "parent_name", parentRelation: "parent_relation", parentPhone: "parent_phone", address: "address", email: "email",
  enrolledAt: "enrolled_at", withdrawnAt: "withdrawn_at", notes: "notes",
};

const def: ImporterDef<Plan> = {
  kind: "students",
  title: IMPORT_META.students.title,
  menu: "students",
  sheets: [spec([])],
  singleSheet: true,
  modeHelp: IMPORT_META.students.modeHelp,
  guide: [
    "· 한 줄 = 원생 한 명. 열 순서는 바꿔도 됩니다(제목으로 찾습니다). 주황 칸(*)은 필수입니다.",
    "· 원생목록의 '엑셀 내보내기'로 받은 파일을 고쳐 올려도 됩니다(수강 과목·담당 강사 열은 읽지 않습니다).",
    "· '추가' = 이미 있는 원생은 건너뜀 · '덮어쓰기' = 있는 원생의 칸을 파일 값으로(빈 칸은 그대로 둡니다).",
    "· 같은 원생 판단: 원생번호가 있으면 원생번호, 없으면 이름 + 학교 + 학년.",
    "· 새 원생 이름이 기존 원생과 같으면 이름 뒤에 A·B·C가 붙습니다(동명이인 구분).",
    "· 상태(퇴원·휴원)는 덮어쓰기로 바꾸지 않습니다 — 반 배정이 함께 정리돼야 해서 원생 화면에서 바꿉니다.",
    "· 날짜는 2026-09-01, 전화는 010-1234-5678 모양. 주민등록번호·카드번호는 적지 마세요.",
  ],
  revalidate: ["/students"],

  async template(ctx) {
    const [settings, db] = await Promise.all([getTenantSettings(), createClient()]);
    const rows = await fetchAllPaged<Existing>((from, to) =>
      db.from("students").select(SELECT).eq("tenant_id", ctx.tenantId).neq("status", "withdrawn").order("name").order("id").range(from, to),
    );
    return [
      {
        spec: spec(settings.operations.gradeLevels),
        rows: rows.map((s) => ({
          code: s.student_code ?? "", name: s.name, englishName: s.english_name ?? "", school: s.school ?? "", grade: s.grade ?? "",
          gender: s.gender === "male" ? "남" : s.gender === "female" ? "여" : "", birthDate: s.birth_date ?? "",
          status: STUDENT_STATUS_LABEL[s.status] ?? "", studentPhone: s.student_phone ?? "", parentName: s.parent_name ?? "",
          parentRelation: s.parent_relation ?? "", parentPhone: s.parent_phone ?? "", address: s.address ?? "", email: s.email ?? "",
          enrolledAt: s.enrolled_at?.slice(0, 10) ?? "", withdrawnAt: s.withdrawn_at?.slice(0, 10) ?? "", notes: s.notes ?? "",
        })),
      },
    ];
  },

  async plan({ ctx, mode, sheets, issues }) {
    const sheet = sheets[SHEET];
    const [settings, db] = await Promise.all([getTenantSettings(), createClient()]);
    const aliases = settings.operations.schoolSaveAliases;
    const [existing, schoolKeys] = await Promise.all([
      fetchAllPaged<Existing>((from, to) =>
        db.from("students").select(SELECT).eq("tenant_id", ctx.tenantId).order("id").range(from, to),
      ),
      loadSchoolKeys(db, ctx.tenantId),
    ]);
    const byCode = new Map(existing.filter((s) => s.student_code).map((s) => [s.student_code!.trim(), s]));
    const byNatural = new Map(existing.filter((s) => s.status !== "withdrawn").map((s) => [naturalKey(s.name, s.school, s.grade), s]));
    // 퇴원생 — 상태 칸이 '퇴원'인 줄(원생목록을 퇴원 필터로 내보낸 파일)만 이쪽에서 찾는다(적대 리뷰 2026-09-29).
    //    같은 이름·학교·학년 퇴원생이 둘 이상이면 고르지 않는다(원생번호로).
    const withdrawnByNatural = new Map<string, Existing | null>();
    for (const s of existing.filter((x) => x.status === "withdrawn")) {
      const k = naturalKey(s.name, s.school, s.grade);
      withdrawnByNatural.set(k, withdrawnByNatural.has(k) ? null : s);
    }
    const taken = new Set(existing.map((s) => s.name.trim()));
    const today = kstToday();

    const plan: Plan = { inserts: [], updates: [] };
    const preview: ImportPreviewRow[] = [];
    let skip = 0;
    const notes: string[] = [];
    const parsed: { rowNum: number; key: string }[] = [];
    for (const row of sheet?.rows ?? []) {
      const name = row.text("name", { required: true, max: 40 });
      const code = row.text("code", { max: 40 });
      const grade = row.text("grade", { max: 24 });
      // 학교급이 빠진 학교(`칠성`)는 학년으로 채운다 — 화면 저장과 같은 판정(학교알리미에 있는 학교만).
      const school = fillSchoolKind(canonicalSchoolName(row.text("school", { max: 40 }), aliases), grade, schoolKeys, aliases);
      const status = row.option("status", STATUS_OPTIONS) ?? "enrolled";
      const fields: Fields = {
        englishName: row.text("englishName", { max: 60 }),
        school,
        grade,
        gender: row.option("gender", GENDER_OPTIONS),
        birthDate: row.date("birthDate"),
        studentPhone: row.phone("studentPhone"),
        parentName: row.text("parentName", { max: 40 }),
        parentRelation: row.text("parentRelation", { max: 20 }),
        parentPhone: row.phone("parentPhone"),
        address: row.text("address", { max: 200 }),
        email: row.text("email", { max: 120 }),
        enrolledAt: row.date("enrolledAt"),
        withdrawnAt: row.date("withdrawnAt"),
        notes: row.text("notes", { max: 2000 }),
      };
      if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) row.fail("email", "이메일 모양이 아닙니다");
      if (!row.ok || !name) continue;
      parsed.push({ rowNum: row.rowNum, key: code ? `#${code}` : naturalKey(name, school, grade) });

      const byCodeHit = code ? byCode.get(code) : undefined;
      const nk = naturalKey(name, school, grade);
      const wantsWithdrawn = status === "withdrawn";
      if (!byCodeHit && wantsWithdrawn && withdrawnByNatural.get(nk) === null) {
        row.fail("name", "이름·학교·학년이 같은 퇴원생이 여럿입니다 — 원생번호 칸을 채워 한 명으로 좁혀 주세요");
        continue;
      }
      // 🔴 상태는 여전히 바꾸지 않는다 — 퇴원생 줄은 칸(연락처·메모 등)만 방식대로 다룬다.
      // 🔴 '퇴원'으로 적힌 줄이 **지금 다니는** 같은 이름·학교·학년 원생에게 붙지 않게 — 그 아이의 빈 칸을 퇴원생 값으로
      //    채울 수 있다(재리뷰 2026-09-29). 퇴원생이 없고 재원생만 있으면 멈추고 알린다.
      if (!byCodeHit && wantsWithdrawn && !withdrawnByNatural.get(nk) && byNatural.get(nk)) {
        row.fail("status", "상태가 퇴원인데 같은 이름·학교·학년의 원생이 지금 다니고 있습니다 — 같은 아이면 원생 화면에서 퇴원 처리하고, 다른 아이면 원생번호를 적어 주세요");
        continue;
      }
      const cur = byCodeHit ?? (wantsWithdrawn ? withdrawnByNatural.get(nk) : byNatural.get(nk));
      const summary = [school, grade, fields.parentPhone].filter(Boolean).join(" · ") || "—";
      // 🔴 이름·학교·학년만 같고 **보호자 연락처가 다르면 다른 아이다**(0258a 김근우 건과 같은 증거) — 건너뛰지도 덮지도 않고 멈춘다.
      //    덮으면 남의 보호자 번호로 바뀌고 상담 자동 연결까지 딸려 간다(적대 리뷰 2026-09-29, [[#132]]).
      const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
      if (cur && !byCodeHit && fields.parentPhone && cur.parent_phone && digits(fields.parentPhone) !== digits(cur.parent_phone)) {
        row.fail(
          "parentPhone",
          `이름·학교·학년이 같은 원생(${cur.name})이 있는데 보호자 연락처가 다릅니다 — 다른 아이라면 이름을 구분해(예: ${name}A — 동명이인 표기) 적고, 같은 아이(연락처가 바뀜)라면 원생번호를 적거나 원생 화면에서 연락처를 먼저 고쳐 주세요`,
        );
        continue;
      }
      if (cur) {
        if (mode === "append") {
          skip += 1;
          preview.push({ sheet: SHEET, rowNum: row.rowNum, key: name, action: "skip", summary: `이미 있음 · ${summary}` });
          continue;
        }
        const patch: Record<string, string | null> = {};
        for (const [k, col] of Object.entries(FIELD_COL) as [keyof Fields, string][]) {
          const v = fields[k];
          if (v === null || v === undefined || k === "withdrawnAt") continue;
          if ((cur as Record<string, unknown>)[col] !== v) patch[col] = v;
        }
        if (code && cur.student_code !== code) patch.student_code = code;
        if (row.has("status") && row.raw("status") && status !== cur.status) {
          notes.push(`${row.rowNum}행 ${name}: 상태는 바꾸지 않았습니다(지금 ${STUDENT_STATUS_LABEL[cur.status] ?? "—"}) — 원생 화면에서 바꿔 주세요`);
        }
        const changed = Object.keys(patch);
        if (changed.length === 0) {
          skip += 1;
          preview.push({ sheet: SHEET, rowNum: row.rowNum, key: name, action: "skip", summary: "바뀐 칸 없음" });
        } else {
          plan.updates.push({ id: cur.id, patch });
          preview.push({ sheet: SHEET, rowNum: row.rowNum, key: name, action: "update", summary: `${changed.length}칸 바꿈 · ${summary}` });
        }
        continue;
      }
      const w = planFormWithdrawal({ prevStatus: null, status, withdrawnAt: fields.withdrawnAt ?? null, today });
      if (w.error) {
        row.fail("withdrawnAt", w.error);
        continue;
      }
      // 새 원생에 퇴원 예약(오늘 이후 퇴원일)은 걸지 않는다 — 퇴원은 퇴원보고서로만(원장 2026-10-23). 지난 퇴원(옛 기록)은 그대로 넣는다.
      const viaReport = formWithdrawalViaReport({ prevStatus: null, kind: w.kind, withdrawnAt: w.withdrawnAt });
      if (viaReport) {
        row.fail("withdrawnAt", "오늘 이후 퇴원일(퇴원 예약)은 가져오지 않습니다 — 원생을 등록한 뒤 원생 화면의 '퇴원보고서'에서 퇴원일을 정해 주세요.");
        continue;
      }
      if (status === "withdrawn" && !fields.withdrawnAt) {
        row.fail("withdrawnAt", "상태가 퇴원이면 퇴원일을 적어 주세요");
        continue;
      }
      let withdrawal: WithdrawalMetadata | null = null;
      if (w.kind !== "none") {
        const reason = row.option("withdrawalReason", REASON_OPTIONS);
        const memo = row.text("withdrawalMemo", { max: 2000 });
        if (!row.ok) continue;
        if (!reason) {
          row.fail(
            "withdrawalReason",
            row.has("withdrawalReason")
              ? "퇴원(또는 퇴원 예약)이면 퇴원사유를 골라 주세요"
              // 2026-10-15 전에 받은 서식엔 이 칸이 없다 — 없는 칸을 고르라고 하면 길이 안 보인다.
              : "퇴원(또는 퇴원 예약)이면 퇴원사유가 필요합니다 — 서식을 새로 내려받아 '퇴원사유' 칸을 채워 주세요",
          );
          continue;
        }
        const checked = checkReasonInput({ reason, detail: null, memo });
        if (checked.error !== undefined) {
          row.fail("withdrawalMemo", checked.error);
          continue;
        }
        withdrawal = {
          reason,
          memo,
          consultation: { adminCalledParent: false, teacherCalledParent: false, talkedWithStudent: false },
        };
      }
      const unique = resolveUniqueStudentName(name, taken);
      taken.add(unique.name);
      plan.inserts.push({ rowNum: row.rowNum, name: unique.name, code, status: w.status, withdrawnAt: w.withdrawnAt, scheduled: w.kind === "schedule", fields, withdrawal });
      preview.push({
        sheet: SHEET,
        rowNum: row.rowNum,
        key: unique.name,
        action: "insert",
        summary: `${STUDENT_STATUS_LABEL[w.status] ?? ""}${w.kind === "schedule" ? `(퇴원 예약 ${w.withdrawnAt})` : ""} · ${summary}${unique.suffixed ? ` · 동명이인이라 '${unique.name}'(으)로` : ""}`,
      });
    }
    issues.push(...duplicateKeyIssues(SHEET, parsed, (r) => r.key, "원생(원생번호 또는 이름·학교·학년)"));
    // 재원생 좌석 한도 — 미리보기에서 먼저 알린다(반영 때 처음 막히면 "미리보기는 괜찮다더니"가 된다). 반영 때도 다시 본다.
    const seat = await seatBlockReason(ctx.tenantId, plan.inserts.filter((r) => r.status === "enrolled").length);
    if (seat) issues.push({ sheet: SHEET, row: null, col: null, header: null, value: null, message: seat });
    const total = sheet?.rows.length ?? 0;
    return {
      counts: [{ label: "원생", total, insert: plan.inserts.length, update: plan.updates.length, skip }],
      preview,
      notes,
      plan,
    };
  },

  async apply({ ctx, plan }) {
    if (plan.inserts.some((r) => statusCreationNeedsPermission(r.status, r.withdrawnAt)) && !(await canManageStudentStatusNow())) {
      return { error: STUDENT_STATUS_DENIED };
    }
    // 계획 단계가 이미 거른다 — 적용 직전에 한 번 더(퇴원 예약은 퇴원보고서로만, 원장 2026-10-23).
    if (plan.inserts.some((r) => r.scheduled)) return { error: SCHEDULE_VIA_REPORT };
    const adding = plan.inserts.filter((r) => r.status === "enrolled").length;
    const seat = await seatBlockReason(ctx.tenantId, adding);
    if (seat) return { error: seat };
    const db = await createClient();
    let inserted = 0;
    for (let i = 0; i < plan.inserts.length; i += 200) {
      const chunk = plan.inserts.slice(i, i + 200);
      const { error } = await db.from("students").insert(
        chunk.map((r) => ({
          tenant_id: ctx.tenantId,
          name: r.name,
          student_code: r.code,
          english_name: r.fields.englishName ?? null,
          school: r.fields.school ?? null,
          grade: r.fields.grade ?? null,
          gender: r.fields.gender ?? null,
          birth_date: r.fields.birthDate ?? null,
          student_phone: r.fields.studentPhone ?? null,
          parent_name: r.fields.parentName ?? null,
          parent_relation: r.fields.parentRelation ?? null,
          parent_phone: r.fields.parentPhone ?? null,
          address: r.fields.address ?? null,
          email: r.fields.email ?? null,
          enrolled_at: r.fields.enrolledAt ?? null,
          status: r.status,
          withdrawn_at: r.withdrawnAt,
          withdrawal_metadata: r.withdrawnAt ? r.withdrawal : null,
          notes: r.fields.notes ?? null,
        })),
      );
      if (error) {
        const dup = /duplicate key|natural_key/i.test(error.message);
        return {
          error: `${chunk[0]!.rowNum}~${chunk[chunk.length - 1]!.rowNum}행을 넣지 못했습니다 — ${dup ? "같은 이름·학교·학년 원생이 방금 생겼습니다(미리보기를 다시 받아 주세요)" : error.message}${inserted ? ` · 그 앞 ${inserted}명은 들어갔습니다` : ""}`,
        };
      }
      inserted += chunk.length;
    }
    for (const u of plan.updates) {
      const { error } = await db.from("students").update(u.patch).eq("id", u.id).eq("tenant_id", ctx.tenantId);
      if (error) return { error: `${explainDbError(error, { scope: "excel-import.students", fallback: "원생 갱신 중 멈췄습니다 — 잠시 후 다시 시도해 주세요" }).message} (새 원생 ${inserted}명은 들어갔습니다)` };
    }
    return {};
  },
};

const SELECT =
  "id, name, school, grade, status, student_code, english_name, gender, birth_date, student_phone, parent_name, parent_relation, parent_phone, address, email, enrolled_at, withdrawn_at, notes";

export default def;
