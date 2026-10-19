import { AnalysisError, MAX_FILE_BYTES, MAX_ROWS } from "./contract";

// Bounded RFC 4180-style reader. Never include source values in an error.
export function parseCsv(text: string): string[][] {
  if (text.length > MAX_FILE_BYTES) throw new AnalysisError("파일 크기 제한을 초과했습니다.", 413);
  text = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  const pushCell = () => {
    row.push(cell.trim()); cell = ""; closed = false;
    if (row.length > 50) throw new AnalysisError("열은 최대 50개까지 지원합니다.");
  };
  const pushRow = () => {
    pushCell();
    if (row.some((v) => v !== "")) rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS + 1) throw new AnalysisError("파일당 최대 10,000행까지 지원합니다.", 413);
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\0") throw new AnalysisError("CSV에 지원하지 않는 문자가 있습니다.");
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += c;
    } else if (c === ",") pushCell();
    else if (c === "\n" || c === "\r") {
      pushRow();
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else if (c === '"' && cell === "" && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new AnalysisError("CSV의 따옴표 형식이 올바르지 않습니다.");
      cell += c;
    }
    if (cell.length > 2048) throw new AnalysisError("한 셀은 최대 2,048자까지 지원합니다.");
  }
  if (quoted) throw new AnalysisError("CSV의 닫는 따옴표가 없습니다.");
  if (cell || row.length || closed) pushRow();
  if (rows.length === 0) throw new AnalysisError("열 이름이 있는 CSV 파일이 필요합니다.");
  const [headers] = rows;
  if (headers.some((h) => !h || h.length > 100) || new Set(headers).size !== headers.length)
    throw new AnalysisError("열 이름이 비어 있거나 중복되었거나 너무 깁니다.");
  if (rows.some((r) => r.length !== headers.length)) throw new AnalysisError("열 개수가 다른 행이 있습니다. CSV를 확인해 주세요.");
  return rows;
}

export function decodeCsv(buffer: ArrayBuffer, encoding: "utf-8" | "euc-kr"): string {
  if (buffer.byteLength > MAX_FILE_BYTES) throw new AnalysisError("파일당 512KB 이하로 올려 주세요.", 413);
  try { return new TextDecoder(encoding, { fatal: true }).decode(buffer); }
  catch { throw new AnalysisError("선택한 문자 인코딩으로 읽을 수 없습니다. 인코딩을 확인해 주세요."); }
}
