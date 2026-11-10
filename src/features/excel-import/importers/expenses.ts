import "server-only";
import { kstToday } from "@/lib/date-kst";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_CURRENCY, roundMoney } from "@/features/billing/currencies";
import { IMPORT_META } from "../kinds";
import { parseOption, type ColumnSpec, type ImportPreviewRow, type SheetSpec } from "../spec";
import type { ImporterDef } from "../server/types";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * 지출 가져오기 — 체크리스트 21번 "비용·지출"(과거 지출 내역을 옮길 때). 행 모양은 **사무실 직접 작성(`createExpense`)과 같다**
 * (분류 5종 · 정산방법 4종 · 작성 칸 체크 · 결재 상태는 표 기본값). 원화(KRW)만.
 * 🔑 매칭 = 지출일 + 항목 + 금액 — **같은 지출이 여러 건일 수 있다**(간식 10,000원 ×2). 그래서 개수로 센다:
 *    파일에 N줄 · 이미 M건이면 '추가'는 N − M줄만 넣고 나머지는 건너뛴다. '덮어쓰기'는 파일 1줄 ↔ 기존 1건일 때만
 *    고치고(분류·거래처·정산방법·메모 — 키에 든 금액은 그대로), 여러 건이면 어느 것인지 모르니 그 줄을 오류로 낸다.
 * 🔴 슬랙·알림을 보내지 않는다 — 지출 슬랙은 건마다의 `expense_create` 감사로그에서 나가는데, 가져오기는 감사로그를
 *    **한 줄**(`excel_import`)만 남긴다(과거 지출 수백 건이 채널에 쏟아지지 않게).
 * 🔴 계좌·카드번호 칸은 받지 않는다(체크리스트: 전체 카드번호는 제출하지 않는다) — 은행·카드명·번호는 화면에서.
 */
type K = "date" | "title" | "category" | "vendor" | "amount" | "method" | "memo" | "currency";
const SHEET = "지출";
const CATEGORIES = ["인건비", "운영비", "매입", "마케팅", "기타"] as const;
const METHODS = ["카드결제", "현금", "계좌이체", "법인카드"] as const;

const COLUMNS: ColumnSpec<K>[] = [
  { key: "date", header: "지출일", width: 12, required: true, aliases: ["일자", "날짜", "사용일"] },
  // '제목' = 수납관리 › 지출 **엑셀 내보내기**의 제목 열. 그 파일엔 뒤쪽에 '항목'(세부 항목 목록) 열도 있는데, 열 제목은 **앞에 온 것**이
  // 이겨서(mapHeaders) 제목이 먼저 잡힌다 — 세부 항목 열은 읽지 않는다.
  { key: "title", header: "항목", width: 24, required: true, aliases: ["제목", "항목명", "내역", "적요", "내용"] },
  { key: "category", header: "분류", width: 9, options: CATEGORIES, strictOptions: true, hint: "비우면 기타" },
  { key: "vendor", header: "거래처", width: 16, aliases: ["사용처", "업체"] },
  { key: "amount", header: "금액", width: 12, required: true, aliases: ["지출액", "지출금액", "총액"] },
  { key: "method", header: "정산방법", width: 10, options: METHODS, strictOptions: true, aliases: ["결제수단", "지급수단"] },
  { key: "memo", header: "메모", width: 28, aliases: ["비고"] },
  // 지출 **엑셀 내보내기** 파일에만 있는 열 — 이 열이 있으면 내보내기 파일로 보고 옛 분류·결제수단 글자도 그대로 받는다.
  { key: "currency", header: "통화", exportOnly: true },
];
const SPEC: SheetSpec<K> = { name: SHEET, columns: COLUMNS, keyHint: IMPORT_META.expenses.keyHint };

type Existing = { id: string; expense_date: string; title: string; amount: number; category: string; vendor: string | null; payment_method: string | null; memo: string | null };
type Row = { rowNum: number; date: string; title: string; category: string | null; vendor: string | null; amount: number; method: string | null; memo: string | null };
type Plan = { inserts: Row[]; updates: { id: string; patch: Record<string, string> }[] };

const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const keyOf = (date: string, title: string, amount: number) => `${date}|${squash(title)}|${amount}`;

const def: ImporterDef<Plan> = {
  kind: "expenses",
  title: IMPORT_META.expenses.title,
  menu: "billing",
  sheets: [SPEC],
  singleSheet: true,
  modeHelp: IMPORT_META.expenses.modeHelp,
  guide: [
    "· 한 줄 = 지출 한 건. 주황 칸(*)은 필수입니다. 금액은 원 단위 숫자.",
    "· 지출의 '엑셀 내보내기'로 받은 파일을 고쳐 올려도 됩니다 — 제목·분류·총액·결제수단·거래처·메모를 읽고, 결재·증빙·세부 항목 열은 읽지 않습니다.",
    "· 같은 지출 판단: 지출일 + 항목 + 금액. 같은 지출이 여러 건이면 그 줄 수만큼 적으세요(간식 10,000원 ×2 = 두 줄).",
    "· '추가' = 이미 있는 건수만큼은 건너뛰고 남는 줄만 넣음 · '덮어쓰기' = 분류·거래처·정산방법·메모를 파일 값으로(빈 칸은 그대로 · 같은 지출이 여러 건이면 화면에서).",
    "· 분류: 인건비 · 운영비 · 매입 · 마케팅 · 기타 / 정산방법: 카드결제 · 현금 · 계좌이체 · 법인카드.",
    "· 들어간 지출은 화면에서 새로 적은 것과 같습니다(작성 칸 체크 · 원장·대표 결재는 목록에서). 슬랙 알림은 보내지 않습니다.",
    "· 계좌번호·카드번호는 적지 마세요 — 필요하면 지출 화면에서 넣습니다. 영수증 파일도 화면에서 붙입니다.",
  ],
  revalidate: ["/billing", "/expense-requests"],

  async template() {
    return [{ spec: SPEC, rows: [] }];
  },

  async plan({ ctx, mode, sheets, issues }) {
    const sheet = sheets[SHEET];
    const today = kstToday();
    /** 내보내기 파일(원장 2026-09-29 *"전부다 맞추기도 맞출것"*) — 저장된 값이 목록 밖(옛 분류·결제수단)이어도 그대로 되돌아와야 한다. */
    const exportFile = !!sheet?.map.has("currency");
    const lenient = <T extends string>(raw: string, table: ReadonlyArray<{ label: string; value: T; aliases?: readonly string[] }>): string | null =>
      parseOption(raw, table) ?? (raw.trim() || null);
    const rows: Row[] = [];
    for (const row of sheet?.rows ?? []) {
      const date = row.date("date", true);
      if (date && date > today) row.fail("date", "오늘 이후 날짜는 넣을 수 없습니다(지출한 뒤에)");
      const title = row.text("title", { required: true, max: 200 });
      // 🔴 원화가 아닌 지출은 받지 않는다(적대 리뷰 2026-09-29) — 금액 소수·통화별 매칭·저장 통화를 이 가져오기가 다루지 않는다.
      const currency = row.raw("currency").trim().toUpperCase();
      if (currency && currency !== DEFAULT_CURRENCY) {
        row.fail("currency", "원화가 아닌 지출은 화면에서 넣어 주세요(엑셀 가져오기는 원화만)");
        continue;
      }
      const categoryTable = CATEGORIES.map((c) => ({ label: c, value: c as string }));
      const category = exportFile ? lenient(row.raw("category"), categoryTable) : row.option("category", categoryTable);
      const vendor = row.text("vendor", { max: 120 });
      const amount = row.int("amount", { required: true, min: 0 });
      const methodTable = [
        { label: "카드결제", value: "카드결제", aliases: ["카드", "신용카드"] },
        { label: "현금", value: "현금" },
        { label: "계좌이체", value: "계좌이체", aliases: ["이체", "송금"] },
        { label: "법인카드", value: "법인카드" },
      ];
      const method = exportFile ? lenient(row.raw("method"), methodTable) : row.option("method", methodTable);
      const memo = row.text("memo", { max: 1000 });
      if (!row.ok || !date || !title || amount === null) continue;
      rows.push({ rowNum: row.rowNum, date, title, category, vendor, amount: roundMoney(amount, DEFAULT_CURRENCY), method, memo });
    }

    const db = await createClient();
    const dates = rows.map((r) => r.date).sort();
    const existing = rows.length
      ? await fetchAllPaged<Existing>((from, to) =>
          db
            .from("expenses")
            .select("id, expense_date, title, amount, category, vendor, payment_method, memo")
            .eq("tenant_id", ctx.tenantId)
            // 원화 지출끼리만 대조 — 같은 날·같은 제목·같은 숫자의 달러 지출과 섞이지 않게.
            .eq("currency", DEFAULT_CURRENCY)
            .gte("expense_date", dates[0]!)
            .lte("expense_date", dates[dates.length - 1]!)
            .order("id")
            .range(from, to),
        )
      : [];
    const byKey = new Map<string, Existing[]>();
    for (const e of existing) {
      const k = keyOf(String(e.expense_date).slice(0, 10), e.title, Number(e.amount));
      (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(e);
    }
    const fileCount = new Map<string, number>();
    for (const r of rows) {
      const k = keyOf(r.date, r.title, r.amount);
      fileCount.set(k, (fileCount.get(k) ?? 0) + 1);
    }
    /** 같은 키의 몇 번째 줄인가(파일 순서) — 기존 건수만큼은 '이미 있음'으로 짝짓는다. */
    const seenInFile = new Map<string, number>();

    const plan: Plan = { inserts: [], updates: [] };
    const preview: ImportPreviewRow[] = [];
    let skip = 0;
    for (const r of rows) {
      const summary = `${r.date} · ${r.category ?? "기타"} · ${r.amount.toLocaleString("ko-KR")}원${r.vendor ? ` · ${r.vendor}` : ""}`;
      const k = keyOf(r.date, r.title, r.amount);
      const matches = byKey.get(k) ?? [];
      const nth = (seenInFile.get(k) ?? 0) + 1;
      seenInFile.set(k, nth);
      // 기존 건수를 넘는 줄 = 새 지출(방식과 무관하게 넣는다).
      if (nth > matches.length) {
        plan.inserts.push(r);
        preview.push({ sheet: SHEET, rowNum: r.rowNum, key: r.title, action: "insert", summary });
        continue;
      }
      if (mode === "append") {
        skip += 1;
        preview.push({ sheet: SHEET, rowNum: r.rowNum, key: r.title, action: "skip", summary: `이미 있음(${matches.length}건) · ${summary}` });
        continue;
      }
      // 여럿이어도 파일 줄이 기존 모든 건과 **이미 같으면** 고칠 것이 없다 — 같은 이력을 덮어쓰기로 다시 올려도 막히지 않게.
      const sameAsAll = matches.every(
        (m) => (!r.category || r.category === m.category) && (!r.vendor || r.vendor === m.vendor) && (!r.method || r.method === m.payment_method) && (!r.memo || r.memo === m.memo),
      );
      if ((matches.length !== 1 || (fileCount.get(k) ?? 0) !== 1) && sameAsAll) {
        skip += 1;
        preview.push({ sheet: SHEET, rowNum: r.rowNum, key: r.title, action: "skip", summary: `바뀐 칸 없음(같은 지출 ${matches.length}건)` });
        continue;
      }
      if (matches.length !== 1 || (fileCount.get(k) ?? 0) !== 1) {
        issues.push({
          sheet: SHEET,
          row: r.rowNum,
          col: null,
          header: null,
          value: r.title,
          message: `같은 지출(${r.date} · ${r.amount.toLocaleString("ko-KR")}원)이 여러 건이라 어느 것을 고칠지 모릅니다 — 화면에서 고쳐 주세요`,
        });
        continue;
      }
      const cur = matches[0]!;
      const patch: Record<string, string> = {};
      if (r.category && r.category !== cur.category) patch.category = r.category;
      if (r.vendor && r.vendor !== cur.vendor) patch.vendor = r.vendor;
      if (r.method && r.method !== cur.payment_method) patch.payment_method = r.method;
      if (r.memo && r.memo !== cur.memo) patch.memo = r.memo;
      if (Object.keys(patch).length === 0) {
        skip += 1;
        preview.push({ sheet: SHEET, rowNum: r.rowNum, key: r.title, action: "skip", summary: "바뀐 칸 없음" });
        continue;
      }
      plan.updates.push({ id: cur.id, patch });
      preview.push({ sheet: SHEET, rowNum: r.rowNum, key: r.title, action: "update", summary: `${Object.keys(patch).length}칸 바꿈 · ${summary}` });
    }
    return { counts: [{ label: "지출", total: sheet?.rows.length ?? 0, insert: plan.inserts.length, update: plan.updates.length, skip }], preview, plan };
  },

  async apply({ ctx, plan }) {
    const db = await createClient();
    const today = kstToday();
    let inserted = 0;
    for (let i = 0; i < plan.inserts.length; i += 200) {
      const chunk = plan.inserts.slice(i, i + 200);
      const { error } = await db.from("expenses").insert(
        chunk.map((r) => ({
          tenant_id: ctx.tenantId,
          title: r.title,
          category: r.category ?? "기타",
          amount: r.amount,
          currency: DEFAULT_CURRENCY,
          expense_date: r.date,
          vendor: r.vendor,
          author: ctx.user.displayName,
          payment_method: r.method,
          memo: r.memo,
          created_by: ctx.user.id,
          // 사무실 직접 작성과 같다 — 작성 칸은 저장 즉시 체크, 원장·대표·집행자는 목록에서.
          approval_checks: { author: { checked: true, date: today } },
        })),
      );
      if (error) return { error: `${chunk[0]!.rowNum}~${chunk[chunk.length - 1]!.rowNum}행 지출을 넣지 못했습니다 — ${error.message}${inserted ? ` · 그 앞 ${inserted}건은 들어갔습니다` : ""}` };
      inserted += chunk.length;
    }
    for (const u of plan.updates) {
      const { error } = await db.from("expenses").update(u.patch).eq("id", u.id).eq("tenant_id", ctx.tenantId);
      if (error) return { error: `${explainDbError(error, { scope: "excel-import.expenses", fallback: "지출 고치기 중 멈췄습니다 — 잠시 후 다시 시도해 주세요" }).message} (새 지출 ${inserted}건은 들어갔습니다)` };
    }
    return {};
  },
};

export default def;
