import "server-only";
import { kstMonth } from "@/lib/date-kst";
import { fetchInChunks } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isManualInvoiceShape, PAYMENT_METHOD_LABEL } from "@/features/billing/invoice-lines";
import { resolveDueDate } from "@/features/billing/tuition-calc";
import { IMPORT_META } from "../kinds";
import { duplicateKeyIssues, parseOption, type ColumnSpec, type ImportPreviewRow, type SheetSpec } from "../spec";
import { StudentIndex } from "../server/lookups";
import type { ImporterDef } from "../server/types";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * 수납 가져오기 — 체크리스트 9번 "전환일 수납 현황"(원생별 청구월·청구액·납부액). 청구서 모양은 **수동 청구(`createInvoice`)와 같다**
 * (line_items 한 줄 `{kind, description, amount}` · 마감일 비우면 학원 설정 납부일). 상태는 금액에서 판정한다:
 * 실청구(청구 − 할인) ≤ 납부 → 완납 · 납부 > 0 → 부분납 · 그 밖 → 미납. 🔴 돈 산식은 새로 만들지 않는다 — 미수는 화면의
 * `invoiceOutstanding`이 이 세 값으로 계산한다(가져오기는 값을 옮길 뿐이다).
 * 🔑 매칭 = 원생 + 청구월(DB 유니크 `(tenant, student, period)`).
 * 🔴 덮어쓰기여도 고치지 않는 청구서: ⓪ 지난 달(청구월 < 이번 달 — 정산이 끝났을 수 있다) ① 메이크에듀에서 동기화된 청구서(다음 동기화가 덮는다 — 진실은 메이크에듀)
 *    ② 회차 확정·수납 배분이 걸린 청구서(급여 분배의 근거가 흔들린다) ③ 취소·환불된 청구서. 셋 다 건너뛰고 이유를 적는다.
 */
type K =
  | "code" | "name" | "school" | "grade" | "period" | "category" | "total" | "discount" | "paid" | "paidAt" | "method" | "dueDate" | "notes"
  // ↓ 수납관리 **엑셀 내보내기** 파일에만 있는 열(원장 2026-09-29 *"전부다 맞추기도 맞출것"*) — 서식엔 안 싣는다.
  | "description" | "points" | "unpaid" | "cardCompany" | "status" | "discountReason" | "billedOn";
const SHEET = "수납";

const CATEGORY_OPTIONS = [
  // '수업'은 내보내기 파일의 구분 글자(invoiceKindLabel: tuition → 수업).
  { label: "수강료", value: "tuition", aliases: ["수업료", "교육비", "수업"] },
  { label: "교재", value: "material", aliases: ["교재비"] },
  { label: "시험", value: "exam", aliases: ["시험비", "모의고사"] },
  { label: "기타", value: "other" },
] as const;
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORY_OPTIONS.map((c) => [c.value, c.label]));
const METHOD_OPTIONS = Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({
  label,
  value,
  aliases: value === "card" ? ["카드결제", "신용카드"] : value === "transfer" ? ["이체", "무통장", "계좌"] : [],
}));

const COLUMNS: ColumnSpec<K>[] = [
  { key: "code", header: "원생번호", width: 10, aliases: ["학생번호"] },
  { key: "name", header: "이름", width: 10, required: true, aliases: ["원생", "학생명", "성명"] },
  { key: "school", header: "학교", width: 12 },
  { key: "grade", header: "학년", width: 7 },
  { key: "period", header: "청구월", width: 10, required: true, aliases: ["청구년월", "월"], hint: "2026-09 · 2026.9 · 202609" },
  { key: "category", header: "구분", width: 8, options: CATEGORY_OPTIONS.map((c) => c.label), strictOptions: true, hint: "비우면 수강료" },
  { key: "total", header: "청구액", width: 12, required: true, aliases: ["청구금액", "금액"] },
  { key: "discount", header: "할인", width: 10, aliases: ["할인액"] },
  { key: "paid", header: "납부액", width: 12, aliases: ["수납액", "입금액", "실제낸금액"] },
  { key: "paidAt", header: "납부일", width: 12, aliases: ["수납일", "입금일"] },
  { key: "method", header: "결제수단", width: 9, options: Object.values(PAYMENT_METHOD_LABEL), strictOptions: true },
  { key: "dueDate", header: "납부기한", width: 12, aliases: ["마감일"], hint: "비우면 학원 설정의 납부일" },
  { key: "notes", header: "메모", width: 28, aliases: ["비고"] },
  // 내보내기 파일 전용 — 수납명은 청구 줄 설명으로 쓰고(한 청구서 여러 줄을 다시 한 장으로 묶는다), 나머지는 읽기 전용 표시라 무시.
  { key: "description", header: "수납명", exportOnly: true },
  { key: "points", header: "적립금", exportOnly: true },
  { key: "unpaid", header: "미납금액", exportOnly: true },
  { key: "cardCompany", header: "카드사", exportOnly: true },
  { key: "status", header: "상태", exportOnly: true },
  { key: "discountReason", header: "할인 사유", exportOnly: true },
  { key: "billedOn", header: "청구일", exportOnly: true },
];
const SPEC: SheetSpec<K> = { name: SHEET, columns: COLUMNS, keyHint: IMPORT_META.invoices.keyHint };

/** `2026-09` · `2026.9` · `2026/09` · `202609` · `2026년 9월` → `YYYY-MM`. */
function parsePeriod(raw: string): string | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d{4})\s*[-./년]?\s*(\d{1,2})\s*월?(?:[-./]\d{1,2}일?)?$/.exec(s);
  if (!m) return undefined;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return undefined;
  return `${m[1]}-${String(mo).padStart(2, "0")}`;
}

/** 저장된 청구 줄과 파일의 줄이 같은가(종류·설명·금액, 순서대로). 모양이 다르면 다르다고 본다. */
function sameLines(stored: unknown, lines: readonly Line[]): boolean {
  if (!Array.isArray(stored) || stored.length !== lines.length) return false;
  return stored.every((li, i) => {
    const o = (li ?? {}) as Record<string, unknown>;
    const l = lines[i]!;
    return String(o.kind ?? "") === l.kind && String(o.description ?? "") === l.description && Number(o.amount ?? NaN) === l.amount;
  });
}

/** timestamptz → KST 날짜(YYYY-MM-DD). */
function kstDay(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : t.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function statusOf(total: number, discount: number, paid: number): "paid" | "partial" | "unpaid" {
  const net = Math.max(0, total - discount);
  if (paid > 0 && paid >= net) return "paid";
  if (paid > 0) return "partial";
  return net === 0 ? "paid" : "unpaid";
}
const STATUS_LABEL = { paid: "완납", partial: "부분납", unpaid: "미납" } as const;

type Existing = {
  id: string; student_id: string; period: string; status: string; line_items: unknown; amount_total: number; amount_discount: number; amount_paid: number;
  payment_method: string | null; paid_at: string | null; notes: string | null; category: string | null;
};
type Line = { kind: string; description: string; amount: number };
type Fields = {
  category: string; total: number; discount: number; paid: number; paidAt: string | null; method: string | null;
  /** 넣을 때 쓸 마감일(비었으면 학원 설정 납부일). `dueGiven` = 파일에 실제로 적혔나 — 고칠 때는 적힌 것만 바꾼다. */
  dueDate: string | null; dueGiven: boolean; notes: string | null; lines: Line[];
};
type Ins = { rowNum: number; studentId: string; period: string; f: Fields };
type Upd = { id: string; f: Fields; patchNotes: boolean; curCategory: string | null };
type Plan = { inserts: Ins[]; updates: Upd[] };

const def: ImporterDef<Plan> = {
  kind: "invoices",
  title: IMPORT_META.invoices.title,
  menu: "billing",
  sheets: [SPEC],
  singleSheet: true,
  modeHelp: IMPORT_META.invoices.modeHelp,
  guide: [
    "· 한 줄 = 원생 한 명의 한 달 청구서. 주황 칸(*)은 필수입니다. 한 원생의 같은 달은 한 줄만.",
    "· 수납관리의 '엑셀 내보내기'로 받은 파일을 고쳐 올려도 됩니다 — 그 파일은 청구 줄 단위라 같은 원생·같은 달 줄을 한 청구서로 묶습니다(적립금·미납금액·카드사·상태 열은 읽지 않습니다).",
    "· 원생은 원생번호가 있으면 그 번호, 없으면 이름(+학교·학년)으로 찾습니다. 원생목록에 먼저 있어야 합니다.",
    "· 상태는 금액으로 정해집니다: 납부액 ≥ 청구액 − 할인 → 완납 · 납부액 > 0 → 부분납 · 그 밖 → 미납.",
    "· '추가' = 그 달 청구서가 이미 있으면 건너뜀 · '덮어쓰기' = 그 달 청구서의 금액·납부를 파일 값으로 바꿉니다.",
    "· 덮어쓰기여도 지난 달 청구서(그 달 정산이 끝났을 수 있음), 메이크에듀에서 동기화된 청구서, 회차 확정·수납 배분이 걸린 청구서, 취소·환불된 청구서는 바꾸지 않습니다.",
    "· 금액은 숫자만(쉼표·'원'은 괜찮습니다). 카드번호는 적지 마세요.",
  ],
  revalidate: ["/billing"],

  async template() {
    return [{ spec: SPEC, rows: [] }];
  },

  async plan({ ctx, mode, sheets, issues }) {
    const sheet = sheets[SHEET];
    /** 수납관리 '엑셀 내보내기' 파일인가 — 그 파일에만 있는 '수납명' 열로 가린다(줄 단위 → 청구서로 묶기). */
    const exportFile = !!sheet?.map.has("description");
    const db = await createClient();
    const [settings, students] = await Promise.all([getTenantSettings(), StudentIndex.load(db, ctx.tenantId, { includeWithdrawn: true })]);

    type Parsed = { rowNum: number; row: NonNullable<typeof sheet>["rows"][number]; studentId: string; studentName: string; period: string; f: Fields };
    const parsed: Parsed[] = [];
    for (const row of sheet?.rows ?? []) {
      const st = students.resolve(row, { code: "code", name: "name", school: "school", grade: "grade" });
      const period = parsePeriod(row.raw("period"));
      if (period === undefined) row.fail("period", "청구월로 읽을 수 없습니다 — 2026-09 모양으로 적어 주세요");
      else if (period === null) row.fail("period", "청구월을 적어 주세요(필수)");
      // 내보내기 파일의 구분은 메이크에듀 청구 줄 글자(예: 특강비)일 수도 있다 — 거절하지 않고 그 글자를 줄 종류로 둔다.
      const rawCategory = row.raw("category");
      const known = exportFile ? parseOption(rawCategory, CATEGORY_OPTIONS) : row.option("category", CATEGORY_OPTIONS);
      const category = known ?? (exportFile && rawCategory.trim() ? "other" : "tuition");
      // 🔴 줄 kind는 **항상 영문 분류 키**(tuition/material/exam/other) — 한글 kind는 메이크에듀 모양으로 판정돼
      //    (isManualInvoiceShape) 수정 불가가 되고 동기화 정리가 취소할 수 있다(적대 리뷰 2026-09-29). 모르는 글자는 other + 설명에 남긴다.
      const lineKind = category;
      // 내보내기 파일은 **줄 단위**라 0원 줄(무상 교재 등)이 있다 — 그 파일에선 0원도 받는다.
      const total = row.int("total", { required: true, min: exportFile ? 0 : 1 });
      const discount = row.int("discount", { min: 0 }) ?? 0;
      const paid = row.int("paid", { min: 0 }) ?? 0;
      if (total !== null && discount > total) row.fail("discount", "할인이 청구액보다 클 수 없습니다");
      const paidAt = row.date("paidAt");
      const method = row.option("method", METHOD_OPTIONS);
      const dueDate = row.date("dueDate");
      const dueGiven = dueDate !== null;
      const notes = row.text("notes", { max: 500 });
      const description = row.text("description", { max: 200 });
      if (!row.ok || !st || !period || total === null) continue;
      parsed.push({
        rowNum: row.rowNum,
        row,
        studentId: st.id,
        studentName: st.name,
        period,
        f: {
          category, total, discount, paid, paidAt, method, dueDate: dueDate ?? (resolveDueDate(period, settings.billing.dueDay) || null), dueGiven, notes,
          // 내보내기 파일의 빈 수납명은 빈 글자 그대로(저장값이 ""라 같다고 봐야 한다). 모르는 구분 글자는 설명으로.
          lines: [{ kind: lineKind, description: exportFile ? (description ?? (known ? "" : rawCategory.trim())) : (description ?? CATEGORY_LABEL[category] ?? ""), amount: total }],
        },
      });
    }
    // 서식 파일 = 한 원생·한 달 한 줄(두 줄이면 오류). 내보내기 파일 = **청구 줄 단위**라 같은 원생·같은 달이 여러 줄 —
    // 한 청구서로 다시 묶는다(금액·할인·납부는 합, 줄은 그대로, 결제수단·메모는 첫 값, 납부일은 가장 늦은 날).
    if (exportFile) {
      const merged = new Map<string, Parsed>();
      for (const p of parsed) {
        const key = `${p.studentId}|${p.period}`;
        const m = merged.get(key);
        if (!m) {
          merged.set(key, { ...p, f: { ...p.f, lines: [...p.f.lines] } });
          continue;
        }
        m.f.total += p.f.total;
        m.f.discount += p.f.discount;
        m.f.paid += p.f.paid;
        m.f.lines.push(...p.f.lines);
        m.f.method ??= p.f.method;
        m.f.notes ??= p.f.notes;
        if (p.f.paidAt && (!m.f.paidAt || p.f.paidAt > m.f.paidAt)) m.f.paidAt = p.f.paidAt;
      }
      parsed.splice(0, parsed.length, ...merged.values());
    } else {
      issues.push(...duplicateKeyIssues(SHEET, parsed, (p) => `${p.studentId}|${p.period}`, "원생·청구월"));
    }

    const studentIds = [...new Set(parsed.map((p) => p.studentId))];
    const periods = [...new Set(parsed.map((p) => p.period))];
    const existing = studentIds.length
      ? await fetchInChunks<Existing>(studentIds, (chunk) =>
          db
            .from("invoices")
            .select("id, student_id, period, status, line_items, amount_total, amount_discount, amount_paid, payment_method, paid_at, notes, category")
            .eq("tenant_id", ctx.tenantId)
            .in("student_id", chunk)
            .in("period", periods),
        )
      : [];
    const byKey = new Map(existing.map((e) => [`${e.student_id}|${e.period}`, e]));

    // 회차 확정·배분이 걸린 청구서(덮어쓰기에서 건드리지 않는다) — 덮어쓰기 후보만 묻는다.
    const candidateIds = mode === "overwrite" ? parsed.map((p) => byKey.get(`${p.studentId}|${p.period}`)?.id).filter((x): x is string => !!x) : [];
    const lockedIds = new Set(
      candidateIds.length
        ? (
            await fetchInChunks<{ invoice_id: string }>(candidateIds, (chunk) =>
              db
                .from("invoice_session_terms")
                .select("invoice_id")
                .eq("tenant_id", ctx.tenantId)
                .in("invoice_id", chunk)
                .or("confirmed_sessions.not.is.null,allocation_amount.not.is.null"),
            )
          ).map((r) => r.invoice_id)
        : [],
    );

    const plan: Plan = { inserts: [], updates: [] };
    const preview: ImportPreviewRow[] = [];
    const notes: string[] = [];
    let skip = 0;
    for (const p of parsed) {
      const cur = byKey.get(`${p.studentId}|${p.period}`);
      const st = statusOf(p.f.total, p.f.discount, p.f.paid);
      const summary = `${p.period} · ${CATEGORY_LABEL[p.f.category]} ${p.f.total.toLocaleString("ko-KR")}원${p.f.discount ? ` · 할인 ${p.f.discount.toLocaleString("ko-KR")}` : ""} · 납부 ${p.f.paid.toLocaleString("ko-KR")} · ${STATUS_LABEL[st]}`;
      if (!cur) {
        plan.inserts.push({ rowNum: p.rowNum, studentId: p.studentId, period: p.period, f: p.f });
        preview.push({ sheet: SHEET, rowNum: p.rowNum, key: p.studentName, action: "insert", summary });
        continue;
      }
      if (mode === "append") {
        skip += 1;
        preview.push({ sheet: SHEET, rowNum: p.rowNum, key: p.studentName, action: "skip", summary: `${p.period} 청구서 이미 있음` });
        continue;
      }
      // 🔴 지난 달 청구서는 고치지 않는다 — 그 달 강사 정산이 이미 끝났을 수 있다(새 청구서 추가는 그대로 된다).
      const why = p.period < kstMonth()
        ? "지난 달 청구서라 바꾸지 않습니다(그 달 강사 정산이 끝났을 수 있습니다 — 고칠 게 있으면 수납 화면에서)"
        : !isManualInvoiceShape(cur.line_items)
        ? "메이크에듀에서 동기화된 청구서라 바꾸지 않습니다(메이크에듀에서 고치면 다음 동기화에 반영)"
        : lockedIds.has(cur.id)
          ? "회차 확정·수납 배분이 걸린 청구서라 바꾸지 않습니다(회차 확정 면에서 먼저 해제)"
          : cur.status === "void" || cur.status === "refunded"
            ? "취소·환불된 청구서라 바꾸지 않습니다"
            : null;
      if (why) {
        skip += 1;
        notes.push(`${p.rowNum}행 ${p.studentName} ${p.period}: ${why}`);
        preview.push({ sheet: SHEET, rowNum: p.rowNum, key: p.studentName, action: "skip", summary: why });
        continue;
      }
      // 바뀐 게 없으면 건너뛴다 — 내보낸 파일을 그대로 올리면 결제수단·납부일·메모가 **지금 값과 같아서** 채워져 있다(비었다고만 보면 전부 갱신이 된다).
      const same =
        Number(cur.amount_total) === p.f.total && Number(cur.amount_discount) === p.f.discount && Number(cur.amount_paid) === p.f.paid && cur.status === st &&
        (!p.f.notes || p.f.notes === (cur.notes ?? "")) &&
        (!p.f.method || p.f.method === cur.payment_method) &&
        (!p.f.paidAt || p.f.paidAt === kstDay(cur.paid_at)) &&
        sameLines(cur.line_items, p.f.lines);
      if (same) {
        skip += 1;
        preview.push({ sheet: SHEET, rowNum: p.rowNum, key: p.studentName, action: "skip", summary: "바뀐 칸 없음" });
        continue;
      }
      plan.updates.push({ id: cur.id, f: p.f, patchNotes: p.f.notes !== null, curCategory: cur.category });
      preview.push({
        sheet: SHEET,
        rowNum: p.rowNum,
        key: p.studentName,
        action: "update",
        summary: `${summary} (지금 ${Number(cur.amount_total).toLocaleString("ko-KR")}원 · 납부 ${Number(cur.amount_paid).toLocaleString("ko-KR")})`,
      });
    }
    return { counts: [{ label: "청구서", total: sheet?.rows.length ?? 0, insert: plan.inserts.length, update: plan.updates.length, skip }], preview, notes, plan };
  },

  async apply({ ctx, plan }) {
    const db = await createClient();
    const lineItems = (f: Fields) => f.lines;
    const paidAtOf = (f: Fields, status: string) => (f.paidAt ? `${f.paidAt}T00:00:00+09:00` : status === "unpaid" ? null : undefined);
    let inserted = 0;
    for (let i = 0; i < plan.inserts.length; i += 200) {
      const chunk = plan.inserts.slice(i, i + 200);
      const { error } = await db.from("invoices").insert(
        chunk.map((r) => {
          const status = statusOf(r.f.total, r.f.discount, r.f.paid);
          return {
            tenant_id: ctx.tenantId,
            student_id: r.studentId,
            period: r.period,
            category: r.f.category,
            amount_total: r.f.total,
            amount_discount: r.f.discount,
            amount_paid: r.f.paid,
            status,
            line_items: lineItems(r.f),
            due_date: r.f.dueDate,
            paid_at: paidAtOf(r.f, status) ?? null,
            payment_method: r.f.method,
            notes: r.f.notes,
          };
        }),
      );
      if (error) {
        const dup = error.code === "23505" || /duplicate|unique/i.test(error.message);
        return { error: `${chunk[0]!.rowNum}~${chunk[chunk.length - 1]!.rowNum}행 청구서를 넣지 못했습니다 — ${dup ? "그 사이 같은 원생·같은 달 청구서가 생겼습니다(미리보기를 다시 받아 주세요)" : error.message}${inserted ? ` · 그 앞 ${inserted}건은 들어갔습니다` : ""}` };
      }
      inserted += chunk.length;
    }
    let updated = 0;
    for (const u of plan.updates) {
      const status = statusOf(u.f.total, u.f.discount, u.f.paid);
      const patch: Record<string, unknown> = {
        amount_total: u.f.total,
        amount_discount: u.f.discount,
        amount_paid: u.f.paid,
        status,
        line_items: lineItems(u.f),
      };
      const paidAt = paidAtOf(u.f, status);
      if (paidAt !== undefined) patch.paid_at = paidAt;
      if (u.f.method) patch.payment_method = u.f.method;
      // 마감일은 파일에 적혔을 때만(내보내기 파일엔 없다 — 학원 기본값으로 덮으면 따로 정한 마감일이 사라진다).
      if (u.f.dueGiven && u.f.dueDate) patch.due_date = u.f.dueDate;
      if (u.f.category !== u.curCategory) patch.category = u.f.category;
      if (u.patchNotes) patch.notes = u.f.notes;
      // 🔴 수동 청구서·미취소일 때만(미리보기와 쓰기 사이에 동기화가 덮었거나 취소됐으면 0행 = 건너뜀).
      const { data, error } = await db
        .from("invoices")
        .update(patch)
        .eq("id", u.id)
        .eq("tenant_id", ctx.tenantId)
        .not("status", "in", "(void,refunded)")
        .select("id, line_items");
      if (error) return { error: `${explainDbError(error, { scope: "excel-import.invoices", fallback: "청구서 고치기 중 멈췄습니다 — 잠시 후 다시 시도해 주세요" }).message} (새 청구서 ${inserted}건 · 고친 ${updated}건은 반영됐습니다)` };
      if ((data ?? []).length) updated += 1;
    }
    const missed = plan.updates.length - updated;
    return missed ? { notes: [`그 사이 취소·환불된 청구서 ${missed}건은 고치지 않았습니다`] } : {};
  },
};

export default def;
