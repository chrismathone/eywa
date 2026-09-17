/** Browser-serializable extractor. Refund child rows belong to the preceding invoice row. */
function extractTable() {
  let best = null, count = 0;
  for (const table of document.querySelectorAll("table")) {
    const n = table.querySelectorAll("tbody tr").length;
    if (n > count) { best = table; count = n; }
  }
  if (!best) return { headers: [], rows: [], invoiceRefunds: {} };
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const headers = Array.from(best.querySelectorAll("thead th, thead td"), (h) => clean(h.textContent));
  const invoiceTable = headers.some((h) => h.includes("청구월")) && headers.some((h) => h.includes("수납명"));
  const rows = [], invoiceRefunds = {};
  // Read current control values without concatenating neighbouring cells or all select options.
  const displayed = (node) => {
    if (node.nodeType === 3) return node.textContent || "";
    if (["SCRIPT", "STYLE", "TEMPLATE"].includes(node.nodeName)) return "";
    if (node.nodeName === "SELECT") return node.options[node.selectedIndex]?.text || "";
    if (node.nodeName === "INPUT") return node.type === "hidden" ? "" : node.value || "";
    if (node.nodeName === "IMG") return node.getAttribute("alt") || "";
    return Array.from(node.childNodes, displayed).join(" ");
  };
  const refundDate = (raw) => {
    const m = raw.match(/환\s*불\s*일(?:\s*자)?\s*[:：]?\s*(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})(?!\d)/);
    if (!m) return null;
    const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  };
  const refundAmount = (raw) => {
    const text = raw.match(/환\s*불\s*금\s*액\s*[:：]?\s*[₩￦]?\s*([^가-힣]*)(?=[가-힣]|$)/)?.[1]?.trim();
    if (!text || !/^(?:\d+|\d{1,3}(?:,\s*\d{3})+)$/.test(text)) return null;
    const amount = Number(text.replace(/[,\s]/g, ""));
    return Number.isSafeInteger(amount) ? amount : null;
  };
  let parent = null;
  for (const tr of best.querySelectorAll("tbody tr")) {
    const cells = Array.from(tr.children, (td) => {
      const sel = td.querySelector("select");
      if (sel) return clean(sel.options[sel.selectedIndex]?.text);
      // Hidden display helpers must never override the actual money input.
      return clean(td.innerText) || clean(td.querySelector("input")?.value);
    });
    const prefix = clean(Array.from(tr.children).slice(0, 3).map((td) => td.textContent).join(" "));
    if (invoiceTable && /^[└ㄴ↳\s]*환\s*불\s*\d+/.test(prefix)) {
      if (!parent) throw new Error("환불 내역의 원 수납 행을 찾지 못했습니다");
      const raw = clean(displayed(tr));
      const date = refundDate(raw);
      const amount = refundAmount(raw);
      const selections = Array.from(tr.querySelectorAll("select"), (sel) => clean(sel.options[sel.selectedIndex]?.text));
      const controls = Array.from(tr.querySelectorAll('input[type="button"],input[type="submit"],input[type="image"],button,a,[role="button"],[onclick]'));
      const active = controls.some((c) => [displayed(c), c.value, c.getAttribute("aria-label"), c.getAttribute("title"), c.getAttribute("alt")]
        .some((label) => clean(label).replace(/\s/g, "") === "환불취소"));
      const typeOptions = selections.filter((s) => /^(?:전\s*체|전\s*액|부\s*분)\s*환\s*불$/.test(s));
      const typeText = typeOptions.length ? typeOptions.join(" ") : raw.split(/환\s*불\s*(?:일|금\s*액|사\s*유)/)[0];
      const full = /(?:전\s*체|전\s*액)\s*환\s*불/.test(typeText);
      const partial = /부\s*분\s*환\s*불/.test(typeText);
      const type = full !== partial ? full ? "full" : "partial" : "unknown";
      const missing = [!date && "환불일자", amount === null && "환불금액", !active && "환불취소 버튼", type === "unknown" && "전체/부분 환불 구분"].filter(Boolean);
      if (missing.length) throw new Error(`환불 상세 확인 불가: ${missing.join(", ")}. 수납 동기화를 중단합니다`);
      invoiceRefunds[parent].push({ type, amount, date, method: selections.find((s) => /카드|현금|계좌/.test(s)) || null, status: "active", source: "makeedu" });
      continue;
    }
    rows.push(cells);
    if (invoiceTable) {
      const name = cells[headers.findIndex((h) => h.includes("이름"))];
      const month = cells[headers.findIndex((h) => h.includes("청구월"))];
      parent = name && /\d{4}[.\-/]?\d{2}/.test(month || "") ? cells.join("\u0001") : null;
      if (parent) invoiceRefunds[parent] = [];
    }
  }
  return { headers, rows, invoiceRefunds };
}
module.exports = { extractTable };
