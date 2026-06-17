// ijw export → eywa 교재신청(textbook_orders) + 지출(expenses) 데모 이식.
// 멱등: 테넌트 기존 행 삭제 후 재삽입. 사용: node scripts/_poc_migration/import-textbooks-expenses.cjs [--apply]
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("node:crypto");
const postgres = require("postgres");

const APPLY = process.argv.includes("--apply");
const T = "becaa316-e636-42e9-9d09-08b133e0b094";
let url = process.env.DATABASE_URL;
if (!url) { const e = fs.readFileSync("D:/eywa_refactoring/.env.local", "utf8"); url = e.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))?.slice(13).trim().replace(/^["']|["']$/g, ""); }
const TMP = "D:/tmp";
const f = fs.readdirSync(TMP).filter((x) => x.startsWith("ijw-export-") && x.endsWith(".json")).sort().pop();
const C = JSON.parse(fs.readFileSync(path.join(TMP, f), "utf8")).collections;
const sql = postgres(url, { prepare: false, max: 3 });

const normName = (s) => (s ?? "").replace(/\s+/g, "").toLowerCase();
const normDate = (v) => { if (v == null || v === "") return null; const m = String(v).match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const ts = (v) => (v == null || v === "" ? null : String(v)); // ISO 타임스탬프 그대로

function tbStatus(k) {
  if (k.isPaid) return "paid";
  if (k.copiedToBilling) return "billed";
  if (k.isCompleted) return "delivered";
  if (k.isOrdered) return "ordered";
  return "requested";
}
function expenseCategory(title, items) {
  const text = (String(title || "") + " " + (items || []).map((i) => `${i.purpose || ""} ${i.description || ""}`).join(" ")).toLowerCase();
  if (/급여|인건|강사료|월급|상여|수당|퇴직연금|비자|감사선물|선물|치료비|복리|회식/.test(text)) return "인건비";
  if (/전단|홍보|광고|설명회|기프티콘|쿠폰|상품권|시상|상금|마켓데이|행사|감사제|공고|이벤트|포토존|친구소개|플라워|치킨파티|상품주문|시상품|꾸미기/.test(text)) return "마케팅";
  if (/교재|문제집|부교재|도서|복사|인쇄|카피|토너|매입|프린터/.test(text)) return "매입";
  if (/임대|월세|관리비|공과|전기|수도|인터넷|통신|운영|소모품|비품|청소|간식|다과|커피|렌탈|렌트|임차|api|사용료|충전|프로그램|시스템|인증서|컴퓨터|데스크pc|설치|소방|수수료|문자|웹머니|뮤레카|노트킹/.test(text)) return "운영비";
  return "기타";
}

(async () => {
  try {
    // 학생명 → eywa uuid (교재신청은 studentName만 있음 — 이름 매칭, 동명이인은 첫 매치)
    const students = await sql`select id, name from students where tenant_id=${T}`;
    const nameMap = new Map();
    for (const s of students) { const k = normName(s.name); if (!nameMap.has(k)) nameMap.set(k, s.id); }

    // ── textbook_orders ──
    const tbSrc = C.textbook_requests || [];
    const tbRows = [];
    let tbMatched = 0;
    for (const k of tbSrc) {
      if (!k.bookName || !String(k.bookName).trim()) continue;
      const sid = nameMap.get(normName(k.studentName)) ?? null;
      if (sid) tbMatched++;
      tbRows.push({
        id: randomUUID(), tenant_id: T, student_id: sid,
        student_name: k.studentName ?? null, teacher_name: k.teacherName ?? null,
        book_name: String(k.bookName).trim(), book_detail: k.bookDetail && String(k.bookDetail).trim() ? String(k.bookDetail).trim() : null,
        price: Math.round(Number(k.price) || 0), status: tbStatus(k),
        request_date: normDate(k.requestDate) || normDate(k.createdAt),
        ordered_at: ts(k.orderedAt), delivered_at: ts(k.completedAt), billed_at: ts(k.copiedAt), paid_at: ts(k.paidAt),
        notes: null,
      });
    }

    // ── expenses ──
    const expSrc = C.expenses || [];
    const expRows = [];
    for (const e of expSrc) {
      const date = normDate(e.expenseDate) || normDate(e.createdDate) || normDate(e.createdAt);
      if (!date) continue;
      const items = Array.isArray(e.items) ? e.items : [];
      const amount = Math.round(Number(e.totalAmount) || items.reduce((s, i) => s + (Number(i.totalPrice) || 0), 0));
      const vendors = [...new Set(items.map((i) => i.vendor).filter(Boolean))];
      expRows.push({
        id: randomUUID(), tenant_id: T, title: e.title && String(e.title).trim() ? String(e.title).trim() : "(제목 없음)",
        category: expenseCategory(e.title, items), amount, expense_date: date,
        vendor: vendors[0] ?? null, department: e.department ?? null, author: e.author ?? null,
        payment_method: e.paymentMethod ?? null, approval_status: e.approvalStatus === "approved" ? "approved" : "pending",
        line_items: items.length ? JSON.stringify(items) : null, memo: e.memo && String(e.memo).trim() ? String(e.memo).trim() : null,
      });
    }

    const tbByStatus = {}; tbRows.forEach((r) => { tbByStatus[r.status] = (tbByStatus[r.status] || 0) + 1; });
    const expByCat = {}; expRows.forEach((r) => { expByCat[r.category] = (expByCat[r.category] || 0) + 1; });
    console.log("=== import-textbooks-expenses", APPLY ? "[APPLY]" : "[DRY-RUN]", "===");
    console.log("textbook_orders:", tbRows.length, "| student matched:", tbMatched, "| byStatus:", JSON.stringify(tbByStatus));
    console.log("expenses:", expRows.length, "| total:", expRows.reduce((s, r) => s + r.amount, 0).toLocaleString(), "| byCat:", JSON.stringify(expByCat));

    if (!APPLY) { console.log("[DRY-RUN] 쓰기 없음. --apply 로 적용."); return; }

    await sql`delete from textbook_orders where tenant_id=${T}`;
    await sql`delete from expenses where tenant_id=${T}`;
    for (let i = 0; i < tbRows.length; i += 500) { await sql`insert into textbook_orders ${sql(tbRows.slice(i, i + 500))}`; }
    for (let i = 0; i < expRows.length; i += 500) { await sql`insert into expenses ${sql(expRows.slice(i, i + 500))}`; }
    console.log("APPLIED textbook_orders:", tbRows.length, "expenses:", expRows.length);
  } catch (e) { console.error("ERR", e.message); process.exitCode = 1; }
  finally { await sql.end(); }
})();
