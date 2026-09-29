import { secretMatches } from "@/lib/http/secret-compare";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantReadUrls } from "@/lib/storage/media-storage";
import {
  isNoticeImageAttachment,
  mergeNoticeAttachments,
  NOTICE_ATTACHMENT_MAX,
  type NoticeAttachment,
} from "@/features/onescreen/notice-attachments";

/**
 * ClassNote 공지 발송 워커 전용 — 공지(classnote_notices) 첨부의 signed 다운로드 URL.
 * 워커가 kage에 재업로드하려면 원본 바이트가 필요한데, 워커에 스토리지 자격증명·백엔드 분기를 넣는 대신
 * **앱 서명(resolveTenantReadUrls)을 재사용**한다(보고서 경로 /api/internal/report-attachments와 동일 구조).
 *
 * ⚠️ 보고서 경로와 다른 점 ①: 공지는 **워커 스크린샷이 없다**(글자 그대로 게시) → 이미지도 반드시 돌려준다.
 * ⚠️ 다른 점 ②: 첨부가 두 군데다 — 전원 공통(`attachments`)과 학생별(`targets[].attachments`).
 *
 * 🔴 **워커 계약(중요)**: `targets[i]`는 이미 **공통 + 그 타깃**을 합쳐 둔 *최종* 목록이다(중복 path 제거됨).
 *   워커는 타깃 i를 올릴 때 `targets[i].images`/`.files`만 쓰고 **`common`을 다시 더하면 안 된다**(중복 게시).
 *
 * ⚠️⚠️ **이 라우트는 이미지를 반드시 포함한다 — 수업보고서 라우트와 계약이 다르다.**
 *   report-attachments는 2026-07-22에 이미지 개별 부착을 철회했는데(ClassNote가 attached_images를
 *   **가로로 나열**해 세로 배치가 안 됨), 그 결론을 여기로 옮겨오지 말 것. 이유 두 가지:
 *   ① 공지는 **`/r` 스샷 자체가 없다** — 이미지를 개별 부착하지 않으면 학부모에게 보낼 방법이 아예 없다.
 *      (⚠️ 굵게 표시하는 별 두 개 **바로 뒤에 슬래시**를 붙이면 블록 주석이 거기서 끝나 버린다 —
 *       2026-07-22 main 빌드 중단의 실제 원인. 경로를 강조할 땐 백틱으로 감쌀 것.)
 *   ② 교재요청서는 **가로 나열이 오히려 원하는 모습**이다 — 원장이 지금 손으로 올리는 글이
 *      '요청서 양식 + 교재 표지'를 나란히 붙인 형태다(2026-07-21 원장 첨부 스크린샷).
 *   즉 철회 사유(세로 배치)가 이 경로엔 해당하지 않는다. kage 업로드 자체는 그때 정상 동작했다.
 *   `common`은 참고·진단용(공통 첨부가 몇 장이었는지). `targets`는 큐 행 `targets`와 **같은 순서·같은 길이**라
 *   index로 짝지어도, `board`로 찾아도 된다.
 *
 * 🔴 **`expected`·`missing`(적대검증 2026-07-21)**: 서명 실패분을 그냥 빼고 주면, 워커는 "원래 몇 장이었는지"를
 *   알 길이 없어 **첨부 0장짜리 응답을 '첨부 없는 공지'로 오인**해 글자만 게시하고 `success`로 기록한다
 *   (요청서 없는 글이 정상 발송으로 보이는 최악의 침묵). 그래서 타깃마다 **서명 전 장수(`expected`)**와
 *   **서명 실패한 이름(`missing`)**을 함께 내려보내고, 워커가 개수를 대조해 부족하면 그 타깃 게시를 보류한다.
 * ⚠️ 게이트: `x-eywa-internal` === `CLASSNOTE_INTERNAL_SECRET`(워커 스샷·보고서 첨부와 동일 시크릿).
 * ⚠️ 학원설정 showAttachments는 **여기서 재검사하지 않는다** — 게이트는 발송 시점(sendTextbookNotice) 한 곳.
 *    읽기 시점에 조용히 빼면 강사가 붙인 요청서가 이유 없이 사라진 글이 게시된다(#77 "표면마다 다른 게이트" 회피).
 */
export const dynamic = "force-dynamic";

type Split = {
  images: { name: string; url: string }[];
  files: { name: string; url: string }[];
  /** 서명 **전** 장수(=이 타깃이 올려야 할 첨부 수). 워커가 준비 결과와 대조하는 기준값. */
  expected: number;
  /** 서명에 실패해 URL을 못 준 첨부 이름 — 워커가 한글 사유로 보고한다(조용히 버리지 않는다). */
  missing: string[];
};

/** 이미지/파일 분리 + signed URL 매핑. 서명 실패분은 **버리지 않고** missing에 남긴다. */
function split(list: NoticeAttachment[], urls: Record<string, string>): Split {
  const out: Split = { images: [], files: [], expected: list.length, missing: [] };
  for (const a of list) {
    const url = urls[a.path];
    if (!url) {
      out.missing.push(a.name || "첨부");
      continue;
    }
    (isNoticeImageAttachment(a) ? out.images : out.files).push({ name: a.name, url });
  }
  return out;
}

/**
 * 한 타깃(학생) 몫 — 공통+개별 최종 목록. **상한 초과분도 `missing`으로 보고**한다.
 * 조용히 잘라 보내면 잘린 요청서가 있었다는 사실이 어디에도 남지 않는다(발송 액션이 미리 막지만,
 * 그 가드를 거치지 않은 옛 큐 행까지 여기서 방어 — 넘치면 워커가 그 타깃 게시를 보류한다).
 */
function targetSplit(
  common: NoticeAttachment[],
  individual: NoticeAttachment[],
  urls: Record<string, string>,
): Split {
  const all = mergeNoticeAttachments(common, individual, Number.MAX_SAFE_INTEGER);
  const out = split(all.slice(0, NOTICE_ATTACHMENT_MAX), urls);
  out.expected = all.length; // 저장된 진짜 장수(자르기 전)
  for (const a of all.slice(NOTICE_ATTACHMENT_MAX)) out.missing.push(a.name || "첨부");
  return out;
}

const asList = (v: unknown): NoticeAttachment[] =>
  Array.isArray(v) ? (v as NoticeAttachment[]).filter((a) => a && typeof a.path === "string") : [];

export async function GET(request: Request, { params }: { params: Promise<{ noticeId: string }> }) {
  const secret = process.env.CLASSNOTE_INTERNAL_SECRET;
  if (!secretMatches(request.headers.get("x-eywa-internal"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { noticeId } = await params;

  const admin = createAdminClient();
  const { data: notice } = await admin
    .from("classnote_notices")
    .select("tenant_id, attachments, targets")
    .eq("id", noticeId)
    .maybeSingle();
  // 공지 행이 없으면 첨부를 실을 수 없다 — 200+빈 목록으로 얼버무리면 워커가 글자만 게시한다. 404로 명확히.
  if (!notice) return NextResponse.json({ error: "notice_not_found" }, { status: 404 });

  const common = asList(notice.attachments);
  const targets = (Array.isArray(notice.targets) ? notice.targets : []) as {
    board?: string;
    attachments?: NoticeAttachment[];
  }[];
  const perTarget = targets.map((t) => asList(t?.attachments));

  // 서명은 **한 번에**(B4) — path 전건을 모아 단일 호출(내부에서 Promise.all). 중복 path는 Set으로 1회만.
  const paths = [...new Set([...common, ...perTarget.flat()].map((a) => a.path))];
  let urls: Record<string, string> = {};
  try {
    urls = await resolveTenantReadUrls(paths, "report_attachment", notice.tenant_id as string);
  } catch {
    // 자격증명 오류 등 전건 실패 — 삼키면 "첨부 0장"으로 보여 글자만 나간다. 500으로 떨어뜨려 사유를 남긴다.
    return NextResponse.json({ error: "sign_failed" }, { status: 500 });
  }

  return NextResponse.json({
    common: split(common, urls),
    targets: targets.map((t, i) => ({ board: t?.board ?? "", ...targetSplit(common, perTarget[i]!, urls) })),
  });
}
