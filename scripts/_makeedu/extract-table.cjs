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
  let parent = null;
  for (const tr of best.querySelectorAll("tbody tr")) {
    const cells = Array.from(tr.children, (td) => {
      const sel = td.querySelector("select");
      if (sel) return clean(sel.options[sel.selectedIndex]?.text);
      return clean(td.innerText || td.textContent) || clean(td.querySelector("input")?.value);
    });
    const prefix = clean(Array.from(tr.children).slice(0, 3).map((td) => td.textContent).join(" "));
    if (invoiceTable && /^[└ㄴ↳\s]*환불\s*\d+/.test(prefix)) {
      if (!parent) throw new Error("환불 내역의 원 수납 행을 찾지 못했습니다");
      const copy = tr.cloneNode(true);
      const controls = Array.from(tr.querySelectorAll("input,select,button"));
      const copied = Array.from(copy.querySelectorAll("input,select,button"));
      controls.forEach((control, i) => {
        const value = control.tagName === "SELECT" ? control.options[control.selectedIndex]?.text : control.type === "hidden" ? "" : control.value || control.textContent;
        copied[i].replaceWith(document.createTextNode(` ${value || ""} `));
      });
      const raw = clean(copy.textContent);
      const date = raw.match(/환불일자\s*:?\s*(\d{4}[-./]\d{2}[-./]\d{2})/)?.[1]?.replace(/[./]/g, "-");
      const amountText = raw.match(/환불금액\s*:?\s*([\d,]+)/)?.[1];
      const selections = Array.from(tr.querySelectorAll("select"), (sel) => clean(sel.options[sel.selectedIndex]?.text));
      const active = controls.some((c) => clean(c.value || c.textContent).replace(/\s/g, "") === "환불취소");
      const type = selections.some((s) => /전체\s*환불/.test(s)) ? "full" : selections.some((s) => /부분\s*환불/.test(s)) ? "partial" : "unknown";
      if (!date || !amountText || !active || type === "unknown") throw new Error("환불 상세 행의 상태·일자·금액을 확인하지 못했습니다. 수납 동기화를 중단합니다");
      invoiceRefunds[parent].push({ type, amount: Number(amountText.replace(/,/g, "")), date, method: selections.find((s) => /카드|현금|계좌/.test(s)) || null, status: "active", source: "makeedu" });
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
