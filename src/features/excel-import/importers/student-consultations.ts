import "server-only";
import { kstLocalToIso } from "@/lib/date-kst";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import { CONSULTATION_AUDIENCE_LABEL, CONSULTATION_CATEGORY_LABEL } from "@/features/consultations/labels";
import { stripPastedMarkup } from "@/features/consultations/paste-cleanup";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps, subjectLabelRecord } from "@/features/owner/subjects";
import { consultationSubject } from "@/features/consultations/subject";
import { IMPORT_META } from "../kinds";
import { duplicateKeyIssues, type ColumnSpec, type ImportPreviewRow, type SheetSpec } from "../spec";
import { StaffIndex, StudentIndex } from "../server/lookups";
import type { ImporterDef } from "../server/types";

/**
 * 원생상담(재원생 상담) 가져오기 — 체크리스트 11번 "재원생 상담". 과거 기록을 옮기는 용도라 서식은 빈 칸.
 * 🔑 원생은 이미 등록돼 있어야 한다(원생번호 → 이름·학교·학년, 퇴원생 포함 — 옛 상담의 주인은 퇴원했을 수 있다).
 *    같은 이름이 여럿이면 **고르지 않고** 오류([[#132]]).
 * 🔑 매칭 = 원생 + 상담일(KST) + 상담 내용 앞 30자(공백 무시).
 * 🔴 AI 분석·케어·외부 발송은 하지 않는다. 신규생 체크 연결(0295a 반자동)도 하지 않는다 — 그건 사람이 상담 화면에서 확정한다.
 * 🔴 상담자는 직원 목록에서 찾는다. 못 찾으면(퇴사) 비워 두고 알린다 — 가져오는 사람 이름을 대신 박으면 사실이 아니다.
 * 본문은 화면 저장과 같은 `stripPastedMarkup`을 거친다(가져오기 경로도 같은 함수 — paste-cleanup 머리주석).
 */
type K = "code" | "name" | "school" | "grade" | "date" | "time" | "counselor" | "audience" | "category" | "subject" | "summary" | "action" | "followUpDate" | "followUpDone";

const SHEET = "상담";
const CATEGORY_OPTIONS = Object.entries(CONSULTATION_CATEGORY_LABEL).map(([value, label]) => ({
  label,
  value,
  aliases: value === "academic" ? ["학습/성적", "성적"] : value === "emotional" ? ["정서/심리", "심리"] : value === "social" ? ["교우관계"] : [],
}));
const AUDIENCE_OPTIONS = Object.entries(CONSULTATION_AUDIENCE_LABEL).map(([value, label]) => ({
  label,
  value,
  aliases: value === "parent" ? ["학부모", "부모", "보호자"] : value === "both" ? ["둘다", "학부모학생", "모두"] : [],
}));

function columns(subjectLabels: readonly string[]): ColumnSpec<K>[] {
  return [
    { key: "code", header: "원생번호", width: 10, aliases: ["학생번호"], hint: "원생목록에 원생번호를 넣었다면 이것으로 찾습니다." },
    { key: "name", header: "이름", width: 10, required: true, aliases: ["원생이름", "학생이름", "성명"] },
    { key: "school", header: "학교", width: 12, hint: "같은 이름 원생이 여럿이면 필요" },
    { key: "grade", header: "학년", width: 8 },
    { key: "date", header: "상담일", width: 12, required: true, aliases: ["상담일자", "일자"] },
    { key: "time", header: "시각", width: 8, aliases: ["상담시각", "시간"], hint: "14:30 (비우면 정오)" },
    { key: "counselor", header: "상담자", width: 10, aliases: ["담당자", "상담사", "선생님"], hint: "직원관리의 이름 또는 로그인 이메일" },
    { key: "audience", header: "대상", width: 10, options: AUDIENCE_OPTIONS.map((o) => o.label), strictOptions: true },
    { key: "category", header: "분류", width: 8, options: CATEGORY_OPTIONS.map((o) => o.label), strictOptions: true },
    { key: "subject", header: "과목", width: 8, options: subjectLabels },
    { key: "summary", header: "상담내용", width: 50, required: true, aliases: ["내용", "요약", "상담 내용"], hint: "5자 이상" },
    { key: "action", header: "조치", width: 24, aliases: ["후속조치", "조치사항"] },
    { key: "followUpDate", header: "후속일", width: 12 },
    { key: "followUpDone", header: "후속완료", width: 8, options: ["예", "아니오"], strictOptions: true },
  ];
}
function spec(subjectLabels: readonly string[]): SheetSpec<K> {
  return { name: SHEET, columns: columns(subjectLabels), keyHint: IMPORT_META["student-consultations"].keyHint };
}

type Existing = {
  id: string; student_id: string; consulted_at: string; summary: string; counselor_id: string | null; category: string | null;
  audience: string | null; subject: string | null; follow_up_action: string | null; follow_up_date: string | null; follow_up_done: boolean;
};
type Row = Record<string, string | boolean | null>;
type Plan = { inserts: Row[]; updates: { id: string; patch: Row }[] };

const squash = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, "");
function kstDate(ts: string): string {
  return new Date(new Date(ts).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
const keyOf = (studentId: string, date: string, summary: string) => `${studentId}|${date}|${squash(summary).slice(0, 30)}`;

const def: ImporterDef<Plan> = {
  kind: "student-consultations",
  title: IMPORT_META["student-consultations"].title,
  menu: "consultations",
  sheets: [spec([])],
  singleSheet: true,
  modeHelp: IMPORT_META["student-consultations"].modeHelp,
  guide: [
    "· 한 줄 = 상담 한 건. 원생은 원생목록에 먼저 있어야 합니다(퇴원생도 됩니다).",
    "· 같은 이름 원생이 여럿이면 학교·학년을 채워 한 명으로 좁혀 주세요(원생번호를 적으면 가장 확실합니다).",
    "· 같은 상담 판단: 원생 + 상담일 + 상담내용 앞 30자. '덮어쓰기'는 분류·대상·과목·조치·후속일·후속완료를 파일 값으로 바꿉니다(빈 칸은 그대로).",
    "· 상담자를 직원 목록에서 못 찾으면(퇴사 등) 상담자 칸을 비워 두고 알려 드립니다.",
    "· AI 분석과 신규생 체크 연결은 하지 않습니다(상담 화면에서).",
  ],
  revalidate: ["/consultations"],

  async template() {
    const settings = await getTenantSettings();
    return [{ spec: spec(buildSubjectMaps(settings.operations.subjects).options.map((o) => o.label)), rows: [] }];
  },

  async plan({ ctx, mode, sheets, issues }) {
    const sheet = sheets[SHEET];
    const [settings, db] = await Promise.all([getTenantSettings(), createClient()]);
    const subjects = buildSubjectMaps(settings.operations.subjects);
    const labelRecord = subjectLabelRecord(settings.operations.subjects);
    const [students, staff, existing] = await Promise.all([
      StudentIndex.load(db, ctx.tenantId, { includeWithdrawn: true }),
      StaffIndex.load(db, ctx.tenantId),
      fetchAllPaged<Existing>((from, to) =>
        db
          .from("student_consultations")
          .select("id, student_id, consulted_at, summary, counselor_id, category, audience, subject, follow_up_action, follow_up_date, follow_up_done")
          .eq("tenant_id", ctx.tenantId)
          .order("id")
          .range(from, to),
      ),
    ]);
    const byKey = new Map<string, Existing>();
    for (const e of existing) {
      const k = keyOf(e.student_id, kstDate(e.consulted_at), e.summary);
      if (!byKey.has(k)) byKey.set(k, e);
    }

    const plan: Plan = { inserts: [], updates: [] };
    const preview: ImportPreviewRow[] = [];
    const notes: string[] = [];
    const parsed: { rowNum: number; key: string }[] = [];
    let skip = 0;
    for (const row of sheet?.rows ?? []) {
      const student = students.resolve(row, { code: "code", name: "name", school: "school", grade: "grade" });
      const date = row.date("date", true);
      const time = row.time("time");
      const summaryRaw = row.text("summary", { required: true, max: 20000 });
      const summary = stripPastedMarkup(summaryRaw);
      if (summaryRaw && (!summary || summary.trim().length < 5)) row.fail("summary", "상담내용을 5자 이상 적어 주세요");
      let counselorId: string | null = null;
      let counselorSubjects: string[] | null = null;
      const counselorLabel = row.text("counselor", { max: 60 });
      if (counselorLabel) {
        const c = staff.match(counselorLabel);
        if (c.length === 1) {
          counselorId = c[0]!.id;
          counselorSubjects = c[0]!.subjects;
        } else if (c.length > 1) row.fail("counselor", `'${counselorLabel}' 이름의 직원이 ${c.length}명입니다 — 로그인 이메일로 적어 주세요`);
        else notes.push(`${row.rowNum}행: 상담자 '${counselorLabel}'을(를) 직원 목록에서 찾지 못해 비워 둡니다`);
      }
      const subjectText = row.text("subject", { max: 40 });
      // 저장값은 한글 라벨(상담 폼과 같다) — 키(math)·라벨을 대소문자·공백 무시로 맞춰 라벨로 바꾼다.
      const squashed = subjectText?.replace(/\s+/g, "").toLowerCase();
      const known = squashed
        ? subjects.options.find((o) => o.value.toLowerCase() === squashed || o.label.replace(/\s+/g, "").toLowerCase() === squashed)
        : undefined;
      const entered = subjectText ? (known?.label ?? subjectText) : null;
      // 과목 칸이 비었으면 **새로 넣는 행만** 상담사 담당 과목(하나일 때)으로 채운다 — 상담 폼과 같은 함수.
      // 이미 있는 행은 빈 칸이 "안 바꿈"이라(아래 patch가 null을 건너뜀) 채우지 않는다.
      const autoSubject = entered ? null : consultationSubject(null, counselorSubjects, labelRecord);
      const fields: Row = {
        category: row.option("category", CATEGORY_OPTIONS),
        audience: row.option("audience", AUDIENCE_OPTIONS),
        subject: entered,
        follow_up_action: row.text("action", { max: 2000 }),
        follow_up_date: row.date("followUpDate"),
        follow_up_done: row.yesNo("followUpDone"),
      };
      if (!row.ok || !student || !date || !summary) continue;
      const key = keyOf(student.id, date, summary);
      parsed.push({ rowNum: row.rowNum, key });
      const who = [student.name, student.school, student.grade].filter(Boolean).join(" ");
      const head = summary.replace(/\s+/g, " ").slice(0, 40);
      const cur = byKey.get(key);
      if (cur) {
        if (mode === "append") {
          skip += 1;
          preview.push({ sheet: SHEET, rowNum: row.rowNum, key: who, action: "skip", summary: `이미 있음 · ${date} · ${head}` });
          continue;
        }
        const patch: Row = {};
        for (const [col, v] of Object.entries(fields)) {
          if (v === null || v === undefined) continue;
          if ((cur as Record<string, unknown>)[col] !== v) patch[col] = v;
        }
        if (counselorId && counselorId !== cur.counselor_id) patch.counselor_id = counselorId;
        if (Object.keys(patch).length === 0) {
          skip += 1;
          preview.push({ sheet: SHEET, rowNum: row.rowNum, key: who, action: "skip", summary: "바뀐 칸 없음" });
        } else {
          plan.updates.push({ id: cur.id, patch: { ...patch, updated_at: new Date().toISOString() } });
          preview.push({ sheet: SHEET, rowNum: row.rowNum, key: who, action: "update", summary: `${Object.keys(patch).length}칸 바꿈 · ${date} · ${head}` });
        }
        continue;
      }
      plan.inserts.push({
        tenant_id: ctx.tenantId,
        student_id: student.id,
        counselor_id: counselorId,
        consulted_at: kstLocalToIso(`${date}T${time ?? "12:00"}`) ?? new Date().toISOString(),
        summary,
        ...fields,
        subject: fields.subject ?? autoSubject,
        follow_up_done: fields.follow_up_done ?? false,
      });
      preview.push({ sheet: SHEET, rowNum: row.rowNum, key: who, action: "insert", summary: `${date} · ${head}` });
    }
    issues.push(...duplicateKeyIssues(SHEET, parsed, (r) => r.key, "상담(원생·상담일·내용 앞부분)"));
    return {
      counts: [{ label: "원생상담", total: sheet?.rows.length ?? 0, insert: plan.inserts.length, update: plan.updates.length, skip }],
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
      const { error } = await db.from("student_consultations").insert(chunk);
      if (error) return { error: `상담을 넣지 못했습니다 — ${error.message}${inserted ? ` · 그 앞 ${inserted}건은 들어갔습니다` : ""}` };
      inserted += chunk.length;
    }
    for (const u of plan.updates) {
      const { error } = await db.from("student_consultations").update(u.patch).eq("id", u.id).eq("tenant_id", ctx.tenantId);
      if (error) return { error: `상담 갱신 중 멈췄습니다 — ${error.message} (새 상담 ${inserted}건은 들어갔습니다)` };
    }
    return {};
  },
};

export default def;
