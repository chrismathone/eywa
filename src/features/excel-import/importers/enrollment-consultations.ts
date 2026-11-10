import "server-only";
import { kstLocalToIso } from "@/lib/date-kst";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import { CONSULTATION_PATHS, REGISTRATION_STATUSES } from "@/features/enrollment/form-config";
import { OUTCOME_PILL } from "@/features/enrollment/outcome-meta";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { canonicalSchoolName, fillSchoolKind } from "@/features/schools/school-name";
import { loadSchoolKeys } from "@/features/schools/server/complete-kind";
import { IMPORT_META } from "../kinds";
import { duplicateKeyIssues, type ColumnSpec, type ImportPreviewRow, type SheetSpec } from "../spec";
import { StaffIndex } from "../server/lookups";
import type { ImporterDef } from "../server/types";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * 콜&상담(등록상담) 가져오기 — 체크리스트 10번 "신규 문의·등록상담". 과거 상담 기록을 옮기는 용도라 서식은 빈 칸.
 * 🔑 매칭 = 상담일 + 학생 이름(공백·대소문자 무시) + 보호자 연락처(숫자만). 기존 행의 상담일이 비었으면 `consulted_at`의 KST 날짜.
 * 🔴 **AI 분석·전사·외부 발송을 하지 않는다** — 텍스트 행만 넣는다(processing_status 기본 idle).
 * 🔑 원생 연결은 앱이 직접 하지 않는다(student_id를 안 채운다) — DB 트리거(0107a·0258a)가 화면 등록과 같은 규칙(유일 매칭 + 보호자 연락처 모순 없음)으로만 잇는다([[#132]]).
 *    등록된 원생과의 연결은 상담 화면의 '원생 연결/전환'으로.
 * 🔴 상담 경로는 새로 만들 때 화면에선 필수지만 여기선 비워도 된다 — 옛 기록에 없는 경로를 지어내면 미기재보다 나쁘다.
 * 🔴 덮어쓰기여도 '재원생 등록 완료'인 상담의 진행 상태는 되돌리지 않는다(`ENROLLED_REVERT_BLOCKED`와 같은 결).
 *    빈 칸은 지우지 않는다(원래 값 유지).
 */
type K =
  | "date" | "time" | "name" | "school" | "grade" | "englishName" | "gender" | "studentPhone" | "parentName" | "parentRelation"
  | "parentPhone" | "path" | "subject" | "consultant" | "content" | "outcome" | "registration" | "nonRegReason"
  | "followUpDate" | "followUpContent" | "paymentAmount" | "paymentDate" | "receivedDate";

const SHEET = "상담";
/** 'AI 완료'는 시스템이 붙이는 상태라 파일로 고르지 않는다. */
const OUTCOME_OPTIONS = Object.entries(OUTCOME_PILL)
  .filter(([v]) => v !== "ai_done")
  .map(([value, m]) => ({ label: m.label, value, aliases: value === "enrolled" ? ["재원생 등록", "등록완료", "등록"] : value === "declined" ? ["미등록"] : [] }));
const GENDER_OPTIONS = [
  { label: "남", value: "male", aliases: ["남자", "남성", "m"] },
  { label: "여", value: "female", aliases: ["여자", "여성", "f"] },
];

function columns(subjectLabels: readonly string[]): ColumnSpec<K>[] {
  return [
    { key: "date", header: "상담일", width: 12, required: true, aliases: ["상담일자", "문의일"], hint: "2026-09-01" },
    { key: "time", header: "시각", width: 8, aliases: ["상담시각", "시간"], hint: "14:30 (비우면 정오로 정렬)" },
    { key: "name", header: "학생이름", width: 10, required: true, aliases: ["이름", "학생명", "성명", "원생명"] },
    { key: "school", header: "학교", width: 14 },
    { key: "grade", header: "학년", width: 8 },
    { key: "englishName", header: "영문이름", width: 12, aliases: ["영어이름"] },
    { key: "gender", header: "성별", width: 6, options: ["남", "여"], strictOptions: true },
    { key: "studentPhone", header: "학생연락처", width: 14, aliases: ["원생연락처"] },
    { key: "parentName", header: "보호자명", width: 10, aliases: ["학부모명", "보호자", "문의자"] },
    { key: "parentRelation", header: "보호자관계", width: 9, aliases: ["관계"], options: ["모", "부", "조부", "조모", "기타"] },
    { key: "parentPhone", header: "보호자연락처", width: 14, aliases: ["학부모연락처", "연락처", "문의자연락처"] },
    { key: "path", header: "상담경로", width: 12, aliases: ["유입경로", "문의경로"], options: [...CONSULTATION_PATHS] },
    { key: "subject", header: "과목", width: 8, aliases: ["희망과목"], options: subjectLabels, strictOptions: true, hint: "학원 설정의 과목 이름" },
    { key: "consultant", header: "담당자", width: 10, aliases: ["상담자", "상담사"], hint: "직원관리의 이름 또는 로그인 이메일. 없는(퇴사한) 직원이면 이름만 기록합니다." },
    { key: "content", header: "상담내용", width: 40, aliases: ["내용", "요청사항", "상담 내용"] },
    { key: "outcome", header: "진행상태", width: 14, aliases: ["상태", "결과"], options: OUTCOME_OPTIONS.map((o) => o.label), strictOptions: true, hint: "비우면 상담완료" },
    { key: "registration", header: "등록여부", width: 14, aliases: ["등록상태"], options: [...REGISTRATION_STATUSES] },
    { key: "nonRegReason", header: "미등록사유", width: 20 },
    { key: "followUpDate", header: "후속일", width: 12, aliases: ["다음연락일"] },
    { key: "followUpContent", header: "후속내용", width: 24 },
    { key: "paymentAmount", header: "결제금액", width: 10 },
    { key: "paymentDate", header: "결제일", width: 12 },
    { key: "receivedDate", header: "접수일", width: 12 },
  ];
}
function spec(subjectLabels: readonly string[]): SheetSpec<K> {
  return { name: SHEET, columns: columns(subjectLabels), keyHint: IMPORT_META["enrollment-consultations"].keyHint };
}

type Existing = {
  id: string; prospect_name: string; parent_phone: string | null; consultation_date: string | null; consulted_at: string; outcome: string;
  prospect_school: string | null; prospect_grade: string | null; english_name: string | null; gender: string | null; student_phone: string | null;
  parent_name: string | null; parent_relation: string | null; consultation_path: string | null; subject: string | null; consultant_id: string | null;
  counselor: string | null; parent_request: string | null; registration_status: string | null; non_registration_reason: string | null;
  follow_up_date: string | null; follow_up_content: string | null; payment_amount: string | number | null; payment_date: string | null; received_date: string | null;
};
const SELECT =
  "id, prospect_name, parent_phone, consultation_date, consulted_at, outcome, prospect_school, prospect_grade, english_name, gender, student_phone, parent_name, parent_relation, consultation_path, subject, consultant_id, counselor, parent_request, registration_status, non_registration_reason, follow_up_date, follow_up_content, payment_amount, payment_date, received_date";

type Row = Record<string, string | number | null>;
type Plan = { inserts: Row[]; updates: { id: string; patch: Row }[] };

const squash = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, "");
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
/** KST 날짜 — timestamptz 문자열을 서울 날짜로. */
function kstDate(ts: string): string {
  return new Date(new Date(ts).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
const keyOf = (date: string, name: string, phone: string | null) => `${date}|${squash(name)}|${digits(phone)}`;

const def: ImporterDef<Plan> = {
  kind: "enrollment-consultations",
  title: IMPORT_META["enrollment-consultations"].title,
  menu: "enrollment",
  sheets: [spec([])],
  singleSheet: true,
  modeHelp: IMPORT_META["enrollment-consultations"].modeHelp,
  guide: [
    "· 한 줄 = 상담 한 건. 열 순서는 바꿔도 됩니다(제목으로 찾습니다). 주황 칸(*)은 필수입니다.",
    "· 같은 상담 판단: 상담일 + 학생이름 + 보호자연락처. '추가'는 같은 상담을 건너뛰고, '덮어쓰기'는 적힌 칸만 바꿉니다(빈 칸은 그대로).",
    "· 원생 연결은 화면에서 상담을 등록할 때와 같습니다 — 이름·학교·학년이 한 명과만 맞고 보호자 연락처가 어긋나지 않을 때만 자동으로 이어지고, 애매하면 잇지 않습니다(상담 화면에서 연결).",
    "· AI 분석·녹음 전사·문자 발송은 하지 않습니다. 녹음 파일은 상담 화면에서 따로 붙입니다.",
    "· 담당자는 직원관리의 이름 그대로. 퇴사해서 없는 직원은 이름만 남깁니다.",
    "· 날짜는 2026-09-01, 전화는 010-1234-5678 모양. 주민등록번호·카드번호는 적지 마세요.",
  ],
  revalidate: ["/enrollment"],

  async template() {
    const settings = await getTenantSettings();
    const subjects = buildSubjectMaps(settings.operations.subjects);
    return [{ spec: spec(subjects.options.map((o) => o.label)), rows: [] }];
  },

  async plan({ ctx, mode, sheets, issues }) {
    const sheet = sheets[SHEET];
    const [settings, db] = await Promise.all([getTenantSettings(), createClient()]);
    const aliases = settings.operations.schoolSaveAliases;
    const subjectTable = buildSubjectMaps(settings.operations.subjects).options.map((o) => ({ label: o.label, value: o.value }));
    const [existing, staff, schoolKeys] = await Promise.all([
      fetchAllPaged<Existing>((from, to) =>
        db.from("enrollment_consultations").select(SELECT).eq("tenant_id", ctx.tenantId).order("id").range(from, to),
      ),
      StaffIndex.load(db, ctx.tenantId),
      loadSchoolKeys(db, ctx.tenantId),
    ]);
    const byKey = new Map<string, Existing>();
    for (const e of existing) {
      const k = keyOf(e.consultation_date ?? kstDate(e.consulted_at), e.prospect_name, e.parent_phone);
      if (!byKey.has(k)) byKey.set(k, e);
    }

    const plan: Plan = { inserts: [], updates: [] };
    const preview: ImportPreviewRow[] = [];
    const notes: string[] = [];
    const parsed: { rowNum: number; key: string }[] = [];
    let skip = 0;
    for (const row of sheet?.rows ?? []) {
      const date = row.date("date", true);
      const time = row.time("time");
      const name = row.text("name", { required: true, max: 40 });
      const parentPhone = row.phone("parentPhone");
      const outcome = row.option("outcome", OUTCOME_OPTIONS);
      const subject = row.option("subject", subjectTable);
      // 담당자 — 찾으면 id, 없으면(퇴사 등) 이름만 기록. 같은 이름이 여럿이면 오류(고르지 않는다).
      let consultantId: string | null = null;
      let counselorText: string | null = null;
      const consultantLabel = row.text("consultant", { max: 40 });
      if (consultantLabel) {
        const c = staff.match(consultantLabel);
        if (c.length === 1) consultantId = c[0]!.id;
        else if (c.length > 1) row.fail("consultant", `'${consultantLabel}' 이름의 직원이 ${c.length}명입니다 — 로그인 이메일로 적어 주세요`);
        else counselorText = consultantLabel;
      }
      const payment = row.int("paymentAmount", { min: 0 });
      // 학교급이 빠진 학교(`칠성`)는 학년으로 채운다 — 화면 저장과 같은 판정(학교알리미에 있는 학교만).
      const grade = row.text("grade", { max: 24 });
      const fields: Row = {
        prospect_school: fillSchoolKind(canonicalSchoolName(row.text("school", { max: 40 }), aliases), grade, schoolKeys, aliases),
        prospect_grade: grade,
        english_name: row.text("englishName", { max: 60 }),
        gender: row.option("gender", GENDER_OPTIONS),
        student_phone: row.phone("studentPhone"),
        parent_name: row.text("parentName", { max: 40 }),
        parent_relation: row.text("parentRelation", { max: 20 }),
        parent_phone: parentPhone,
        consultation_path: row.text("path", { max: 40 }),
        subject,
        consultant_id: consultantId,
        counselor: counselorText,
        parent_request: row.text("content", { max: 20000 }),
        registration_status: row.text("registration", { max: 40 }),
        non_registration_reason: row.text("nonRegReason", { max: 2000 }),
        follow_up_date: row.date("followUpDate"),
        follow_up_content: row.text("followUpContent", { max: 2000 }),
        payment_amount: payment,
        payment_date: row.date("paymentDate"),
        received_date: row.date("receivedDate"),
      };
      if (!row.ok || !date || !name) continue;
      const key = keyOf(date, name, parentPhone);
      parsed.push({ rowNum: row.rowNum, key });
      const summary = [date, fields.prospect_school, fields.prospect_grade, parentPhone].filter(Boolean).join(" · ");
      const cur = byKey.get(key);
      if (cur) {
        if (mode === "append") {
          skip += 1;
          preview.push({ sheet: SHEET, rowNum: row.rowNum, key: name, action: "skip", summary: `이미 있음 · ${summary}` });
          continue;
        }
        const patch: Row = {};
        for (const [col, v] of Object.entries(fields)) {
          if (v === null || v === undefined) continue;
          const now = (cur as Record<string, unknown>)[col];
          if (col === "payment_amount" ? Number(now) !== v : now !== v) patch[col] = v;
        }
        if (outcome && outcome !== cur.outcome) {
          if (cur.outcome === "enrolled") notes.push(`${row.rowNum}행 ${name}: 이미 '재원생 등록 완료'라 진행상태는 바꾸지 않았습니다`);
          else patch.outcome = outcome;
        }
        if (!cur.consultation_date) patch.consultation_date = date;
        if (Object.keys(patch).length === 0) {
          skip += 1;
          preview.push({ sheet: SHEET, rowNum: row.rowNum, key: name, action: "skip", summary: "바뀐 칸 없음" });
        } else {
          plan.updates.push({ id: cur.id, patch: { ...patch, updated_at: new Date().toISOString() } });
          preview.push({ sheet: SHEET, rowNum: row.rowNum, key: name, action: "update", summary: `${Object.keys(patch).length}칸 바꿈 · ${summary}` });
        }
        continue;
      }
      plan.inserts.push({
        tenant_id: ctx.tenantId,
        prospect_name: name,
        ...fields,
        outcome: outcome ?? "consulted",
        consultation_date: date,
        consulted_at: kstLocalToIso(`${date}T${time ?? "12:00"}`) ?? new Date().toISOString(),
      });
      preview.push({
        sheet: SHEET,
        rowNum: row.rowNum,
        key: name,
        action: "insert",
        summary: `${OUTCOME_PILL[outcome ?? "consulted"]?.label ?? ""} · ${summary}${counselorText ? ` · 담당 ${counselorText}(직원 목록에 없음 — 이름만)` : ""}`,
      });
    }
    issues.push(...duplicateKeyIssues(SHEET, parsed, (r) => r.key, "상담(상담일·학생이름·보호자연락처)"));
    return {
      counts: [{ label: "신규 콜&상담", total: sheet?.rows.length ?? 0, insert: plan.inserts.length, update: plan.updates.length, skip }],
      preview,
      notes,
      plan,
    };
  },

  async apply({ ctx, plan }) {
    const db = await createClient();
    let inserted = 0;
    for (let i = 0; i < plan.inserts.length; i += 200) {
      const chunk = plan.inserts.slice(i, i + 200);
      const { error } = await db.from("enrollment_consultations").insert(chunk);
      if (error) return { error: `${explainDbError(error, { scope: "excel-import.enrollment-consultations", fallback: "상담을 넣지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message}${inserted ? ` · 그 앞 ${inserted}건은 들어갔습니다` : ""}` };
      inserted += chunk.length;
    }
    for (const u of plan.updates) {
      const { error } = await db.from("enrollment_consultations").update(u.patch).eq("id", u.id).eq("tenant_id", ctx.tenantId);
      if (error) return { error: `${explainDbError(error, { scope: "excel-import.enrollment-consultations", fallback: "상담 갱신 중 멈췄습니다 — 잠시 후 다시 시도해 주세요" }).message} (새 상담 ${inserted}건은 들어갔습니다)` };
    }
    return {};
  },
};

export default def;
