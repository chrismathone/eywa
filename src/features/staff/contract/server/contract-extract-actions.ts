"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUploadTicket, MEDIA_KIND, removeObject } from "@/lib/storage/media-storage";
import { isTenantDocumentPath } from "@/lib/storage/legacy-audio-path";
import type { UploadTicket } from "@/lib/storage/types";
import { generateJSON } from "@/lib/ai/generate";
import { logAction } from "@/features/audit/server/log";
import {
  EMPTY_EXTRACT,
  composeContractTerms,
  groundContractExtract,
  isEmptyExtract,
  maskResidentRegNo,
  type ContractExtract,
  type RawContractExtract,
} from "../contract-extract";
import { EMPLOYMENT_TYPES } from "../../resume/resume";

// 계약서 PDF → 계약 기입 폼 자동 채움(원장 지시 2026-07-31, PDF만. 스캔 OCR 승인 2026-08-03).
// 실측: 글자 PDF 경로는 실계약서(8쪽)로 프로덕션 검증 완료(2026-08-03, 직접 페이지·창 모두).
// ⚠️ **저장하지 않는다** — 뽑은 값을 폼에 채워 보여주고, 사람이 확인해 저장한다.
// 계약 기간·금액은 틀리면 그대로 돈 문제라 AI 결과를 DB에 직행시키지 않는다(등록상담 폼 자동입력과 같은 원칙).

const PDF_CT = "application/pdf";
const PDF_MAX_BYTES = 15 * 1024 * 1024;
/** 프롬프트에 싣는 본문 상한 — 계약서는 보통 2~4쪽이라 충분하고, 넘치면 앞부분(기간·임금 조항)이 남는다. */
const TEXT_LIMIT = 12_000;
/** 스캔 OCR 전사 응답 한도 — 계약서 2~4쪽 한글 전사가 넉넉히 들어가는 크기. */
const OCR_MAX_TOKENS = 8000;

export type ContractPdfTicketState = { ticket?: UploadTicket; error?: string } | undefined;
export type ContractExtractState =
  | { ok?: true; data?: ContractExtract; error?: string; notice?: string }
  | undefined;

async function requireOffice() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "staff"))) return { error: "계약서를 올릴 권한이 없습니다" as const };
  return { user };
}

/** 업로드 티켓 — PDF만. 경로는 서버가 빌드(문서 버킷 규약 재사용). */
export async function issueContractPdfTicket(
  _prev: ContractPdfTicketState,
  formData: FormData,
): Promise<ContractPdfTicketState> {
  const gate = await requireOffice();
  if ("error" in gate) return { error: gate.error };

  const contentType = String(formData.get("contentType") ?? "");
  if (contentType !== PDF_CT) return { error: "계약서는 PDF만 올릴 수 있습니다 (한글 파일은 PDF로 저장해 주세요)" };
  const size = Number(formData.get("size") ?? 0);
  if (!Number.isFinite(size) || size <= 0 || size > Math.min(PDF_MAX_BYTES, MEDIA_KIND.document.maxBytes)) {
    return { error: "파일이 너무 큽니다 (최대 15MB)" };
  }
  const path = `${gate.user.tenantId}/documents/${crypto.randomUUID()}.pdf`;
  if (!isTenantDocumentPath(path, gate.user.tenantId)) return { error: "경로 생성 실패" };
  try {
    return { ticket: await createUploadTicket({ kind: "document", path, contentType }) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "업로드 티켓 발급 실패" };
  }
}

/**
 * 올린 PDF에서 계약 정보를 읽어 **폼 채움용 값**으로 돌려준다.
 * 텍스트 추출은 unpdf(서버리스용 pdfjs) — 스캔 이미지 PDF는 글자가 없어 빈 결과가 나온다(그땐 그렇게 알린다).
 * keep=1이면 파일을 지우지 않는다 — 보관 등록(registerStaffContractFile)과 한 업로드를 공유하는 경로
 * (원장 지시 2026-08-03: 계약서 원본도 직원에게 붙여 보관). keep 없이 부르면 종전처럼 분석 후 지운다.
 */
export async function extractContractFromPdf(
  _prev: ContractExtractState,
  formData: FormData,
): Promise<ContractExtractState> {
  const gate = await requireOffice();
  if ("error" in gate) return { error: gate.error };

  const path = String(formData.get("path") ?? "").trim();
  const keep = String(formData.get("keep") ?? "") === "1";
  if (!path || !isTenantDocumentPath(path, gate.user.tenantId)) {
    return { error: "파일 경로가 올바르지 않습니다 — 다시 첨부하세요" };
  }

  let text = "";
  let buf: Uint8Array | null = null;
  try {
    const { data, error } = await createAdminClient()
      .storage.from(MEDIA_KIND.document.supabaseBucket)
      .download(path);
    if (error || !data) return { error: `파일을 읽지 못했습니다 — ${error?.message ?? "unknown"}` };
    buf = new Uint8Array(await data.arrayBuffer());
    // unpdf = 서버리스용으로 번들된 pdfjs. 무거워서 **요청 시점에만** 불러온다(콜드스타트 비용 최소화).
    // ⚠️ pdfjs는 받은 버퍼를 워커로 **이전(transfer)시켜 비워 버린다** — 원본(buf)을 그대로 주면 뒤의
    // 스캔 OCR base64가 빈 값이 돼 Anthropic 400("PDF cannot be empty")이 난다(2026-08-03 실측). 복사본을 준다.
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(buf.slice());
    const res = await extractText(pdf, { mergePages: true });
    text = (Array.isArray(res.text) ? res.text.join("\n") : res.text) ?? "";
  } catch (e) {
    return { error: `PDF를 읽지 못했습니다 — ${e instanceof Error ? e.message : "형식 확인"}` };
  } finally {
    // 보관 경로(keep)가 아니면 임시 업로드본은 남기지 않는다.
    if (!keep) await removeObject(path, { bucket: MEDIA_KIND.document.supabaseBucket }).catch(() => {});
  }

  // 종이 계약서 스캔(글자 레이어 없음) → Claude 비전으로 **전사만** 시키고, 이후 단계(추출·후보정
  // 가드)는 텍스트 경로와 완전히 동일하게 태운다(원장 승인 2026-08-03 — 스캔의 외부 AI 전송 포함).
  // 전사→추출을 한 호출로 합치지 않는 이유: grounding(원문 등장 검증)이 전사 텍스트를 원문으로 삼는다.
  let ocrUsed = false;
  if (text.replace(/\s/g, "").length < 30 && buf) {
    try {
      const out = await generateJSON<{ text?: string }>({
        prompt: [
          "첨부된 문서는 학원 직원 계약서의 스캔본이다. 문서에 보이는 모든 글자를 순서대로,",
          '보이는 그대로 전사해 JSON {"text":"..."} 형태로만 출력하라.',
          "읽을 수 없는 글자는 건너뛰고, 문서에 없는 내용을 지어내지 말 것.",
        ].join("\n"),
        maxTokens: OCR_MAX_TOKENS,
        provider: "anthropic",
        allowedProviders: ["anthropic"],
        document: { mediaType: "application/pdf", dataBase64: Buffer.from(buf).toString("base64") },
        meta: { feature: "staff_contract_pdf_ocr", tenantId: gate.user.tenantId },
      });
      text = String(out.data.text ?? "");
      ocrUsed = true;
    } catch (e) {
      return { error: `스캔 계약서를 읽지 못했습니다 — ${e instanceof Error ? e.message : "잠시 후 다시"}` };
    }
  }

  // 🔒 주민번호는 어떤 경로든 추출 프롬프트에 싣지 않는다(외부 AI 전송 금지 필드 — 텍스트 단계 마스킹).
  // 공백은 한 칸으로 접되 **지우지 않는다** — 지우면 모델이 원문 인용(terms)을 공백 없이 돌려줘
  // "월급여액은일금2,200,000원…"처럼 읽기 나쁜 조건 문구가 저장된다(2026-08-03 실측).
  const body = maskResidentRegNo(text).replace(/\s+/g, " ").trim();
  if (body.replace(/ /g, "").length < 30) {
    return {
      error: "PDF에서 글자를 찾지 못했습니다 — 스캔 상태가 흐리면 인식이 안 될 수 있습니다(선명한 스캔 또는 글자 PDF로 다시 시도)",
    };
  }

  let raw: RawContractExtract = {};
  try {
    const out = await generateJSON<RawContractExtract>({
      prompt: [
        "아래는 학원 직원 근로/용역 계약서의 본문이다. 계약 정보를 JSON으로만 뽑아라.",
        "",
        "규칙:",
        "- startDate/endDate: 계약 기간의 시작일·종료일을 YYYY-MM-DD로. 본문에 없으면 빈 문자열.",
        `- employmentType: ${EMPLOYMENT_TYPES.join("·")} 중 본문에 적힌 것 하나. 없으면 빈 문자열.`,
        '- company: 계약서 서두 사용자(갑)의 회사/기관명을 본문 그대로 짧게(예: "주식회사 곰돌이", "EIE인재원"). 없으면 빈 문자열.',
        '- contractKind: 계약 종류를 본문 표현 그대로 짧게(예: "근로", "(시용)근로", "강의용역"). 없으면 빈 문자열.',
        '- payType: 급여 방식 — "월급"(월 고정급) | "시급" | "비율"(강의료 퍼센트 배분) 중 하나. 없으면 빈 문자열.',
        "- monthlyPay/hourlyPay: 해당 방식의 금액을 본문 숫자 그대로(쉼표 포함). 해당 없으면 빈 문자열.",
        '- rates: 비율제일 때 [{"label":"초등","percent":43}, …] — 구간 이름과 퍼센트를 본문 그대로. 아니면 빈 배열.',
        "- probationMonths: 시용/수습 기간 개월 수(숫자만). 없으면 빈 문자열.",
        "- terms: 위 구조 필드로 못 담는 핵심 계약조건이 있을 때만 본문 표현 그대로 한 줄. 금액은 본문 숫자를 그대로 옮길 것.",
        "- 본문에 없는 값은 절대 만들지 말고 빈 문자열로 둘 것.",
        "",
        "본문:",
        body.slice(0, TEXT_LIMIT),
      ].join("\n"),
      maxTokens: 900, // 구조 필드 포함 짧은 JSON — 넉넉하되 절단(#89)이 안 나는 선.
      provider: "anthropic",
      allowedProviders: ["anthropic"],
      meta: { feature: "staff_contract_pdf", tenantId: gate.user.tenantId },
    });
    raw = out.data ?? {};
  } catch (e) {
    return { error: `계약서를 분석하지 못했습니다 — ${e instanceof Error ? e.message : "잠시 후 다시"}` };
  }

  // 🔴 후보정 가드 — 원문에 실제로 있는 값만 통과(지어낸 기간·금액 차단).
  const data = groundContractExtract(raw, body);
  // 조건 문자열은 구조 필드가 검증을 통과하면 **우리가 조립**한다(원장 지시 2026-08-03 — 계약 종류별
  // 시트 관례 형태: "강의용역 : 초등(43%), 중등(44%)" / "(시용)근로 : 시용 3개월 / 시급 15,000원" /
  // "근로 : 월급 2,200,000원 (포괄임금)"). 조립 실패 시 기존 통짜 인용(grounded)이 그대로 남는다.
  const composed = composeContractTerms(raw, body);
  if (composed) data.terms = composed;
  await logAction({
    action: "staff_contract_pdf_extract",
    targetType: "user",
    metadata: { filled: Object.entries(data).filter(([, v]) => v).map(([k]) => k) },
  });

  if (isEmptyExtract(data)) {
    return {
      ok: true,
      data: EMPTY_EXTRACT,
      notice: "계약서에서 기간·조건을 확실히 찾지 못했습니다 — 직접 입력해 주세요",
    };
  }
  return {
    ok: true,
    data,
    notice: ocrUsed
      ? "스캔 계약서를 인식(OCR)해 값을 채웠습니다 — 원본과 맞는지 꼭 확인 후 저장하세요"
      : "계약서에서 읽은 값을 채웠습니다 — 확인 후 저장하세요",
  };
}
