import "server-only";
import { AnalysisError, MAX_REQUEST_BYTES, DATASETS, analysisOptionsSchema, type Dataset, type AnalysisResult } from "../contract";
import { decodeCsv } from "../csv";
import { normalizeData } from "../normalize";
import { calculateKpis, monthlyKpis } from "../calc";
import { kstToday } from "@/lib/date-kst";

// Read a bounded stream BEFORE multipart parsing, including chunked requests without Content-Length.
export async function readUpload(request: Request): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data;")) throw new AnalysisError("CSV 업로드 형식이 아닙니다.", 400);
  if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES) throw new AnalysisError("업로드 전체 크기는 2MB 이하여야 합니다.", 413);
  if (!request.body) throw new AnalysisError("업로드 파일이 없습니다.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new AnalysisError("업로드 전체 크기는 2MB 이하여야 합니다.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return await new Response(bytes, { headers: { "Content-Type": contentType } }).formData(); }
  catch { throw new AnalysisError("업로드 내용을 읽을 수 없습니다.", 400); }
}

export async function analyzeUpload(form: FormData, tenantId: string, now = new Date()): Promise<AnalysisResult> {
  const allowed = new Set<string>([...DATASETS, "options", "tenantId"]);
  if ([...form.keys()].some((key) => !allowed.has(key)) || [...allowed].some((key) => form.getAll(key).length !== 1))
    throw new AnalysisError("필수 파일과 분석 조건을 한 번씩 제출해 주세요.", 400);
  if (form.get("tenantId") !== tenantId) throw new AnalysisError("지점이 변경되었습니다. 화면을 새로 열어 주세요.", 403);
  const rawOptions = form.get("options");
  if (typeof rawOptions !== "string" || rawOptions.length > 10_000) throw new AnalysisError("분석 조건이 올바르지 않습니다.", 400);
  let decoded: unknown;
  try { decoded = JSON.parse(rawOptions); } catch { throw new AnalysisError("분석 조건이 올바르지 않습니다.", 400); }
  const parsed = analysisOptionsSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.asOf > kstToday(now)) throw new AnalysisError("날짜·열 연결·전체 이력 확인이 필요합니다. 기간은 최대 24개월이고 기준일은 오늘 이하여야 합니다.", 400);
  const options = parsed.data;
  const files = {} as Record<Dataset, string>;
  for (const dataset of DATASETS) {
    const file = form.get(dataset);
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv")) throw new AnalysisError("세 종류의 CSV 파일이 모두 필요합니다.", 400);
    files[dataset] = decodeCsv(await file.arrayBuffer(), options.encoding);
  }
  const normalized = normalizeData(files, options);
  if (normalized.issueCount) return { ok: false, error: "데이터 오류를 수정한 후 다시 분석해 주세요. 일부 행만으로 집계하지 않습니다.", issues: normalized.issues, issueCount: normalized.issueCount };
  const period = { from: options.from, to: options.to };
  return { ok: true, report: {
    period, asOf: options.asOf, generatedAt: now.toISOString(), quality: normalized.quality,
    kpis: calculateKpis(normalized.data, period), months: monthlyKpis(normalized.data, period),
  } };
}
