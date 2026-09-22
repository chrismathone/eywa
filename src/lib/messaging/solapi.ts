import "server-only";
import { SolapiMessageService } from "solapi";

/**
 * Solapi 클라이언트 팩토리(전역 키 캐시). operator 계정은 AYWA 1개 — 학원별 시크릿이 아니라
 * 전역 SOLAPI_API_KEY/SECRET을 쓰고, 학원 식별은 pfId(발신프로필)+승인 템플릿 ID(DB)로 한다.
 * ai/anthropic.ts의 캐시 팩토리 패턴 미러. 직접 호출은 messaging/provider.ts에서만.
 */
let cached: SolapiMessageService | null = null;

function getSolapi(): SolapiMessageService {
  if (cached) return cached;
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error("SOLAPI_API_KEY / SOLAPI_API_SECRET is not set");
  }
  cached = new SolapiMessageService(apiKey, apiSecret);
  return cached;
}

export type AlimtalkResult = { ok: true; providerMessageId: string } | { ok: false; error: string };

/**
 * 단건 알림톡 발송. SMS 대체발송은 disableSms=false로 솔라피에 위임(템플릿 본문이 SMS로 폴백).
 * 모든 접수가 실패하면 SDK가 MessageNotReceivedError를 throw → catch로 흡수해 결과로 환원.
 */
export async function sendAlimtalk(opts: {
  pfId: string;
  templateId: string;
  to: string;
  variables: Record<string, string>;
  disableSms: boolean;
}): Promise<AlimtalkResult> {
  const from = process.env.SOLAPI_FROM;
  try {
    const res = await getSolapi().send(
      {
        to: opts.to,
        ...(from ? { from } : {}),
        kakaoOptions: {
          pfId: opts.pfId,
          templateId: opts.templateId,
          variables: opts.variables,
          disableSms: opts.disableSms,
        },
      },
      { showMessageList: true },
    );
    const failed = res.failedMessageList ?? [];
    if (failed.length > 0) {
      const f = failed[0];
      return { ok: false, error: `${f.statusCode}: ${f.statusMessage}` };
    }
    const providerMessageId = res.messageList?.[0]?.messageId ?? res.groupInfo.groupId;
    return { ok: true, providerMessageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
