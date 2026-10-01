"use client";

import { useEffect, useState } from "react";

/** Drive 접근 확인이 이만큼 안 끝나면 그냥 재생기를 보인다 — 확인이 막혔을 뿐인 영상을 '권한 없음'으로 숨기지 않는다. */
const ACCESS_CHECK_TIMEOUT_MS = 8_000;
/** 막 올라간 영상은 Drive가 아직 썸네일을 못 만들어 확인이 실패한다 — 이 시간 안의 영상은 확인 없이 바로 연다. */
const FRESH_UPLOAD_MS = 6 * 60 * 60_000;

type Access = "checking" | "ok" | "denied";

/**
 * 숙제 영상 재생기 — Drive 미리보기(iframe)를 보이기 전에 **지금 브라우저의 구글 계정이 그 영상을 볼 수 있는지** 먼저 본다.
 * 원장 2026-10-01 *"영상 자체에 '권한이 없어서 영상을 재생할 수 없습니다.' 페이지로 대체"* — 권한이 없으면 iframe 안에
 * 구글 로그인·권한 요청 화면이 떴고, 그걸 아래 안내 문구("Drive 열기에서 Google 계정으로 로그인…")로 설명하던 것을 걷었다.
 * 🔑 iframe은 다른 출처라 안에 뜬 화면을 읽을 수 없다. 대신 같은 파일의 Drive 썸네일을 이미지로 불러 본다 — 권한이 있으면
 *    이미지가 오고, 없으면 로그인·거절 HTML이 와서 `onError`가 난다(구글 쿠키는 iframe과 같은 규칙으로 실린다).
 * ⚡ 확인하는 동안에도 iframe은 **숨긴 채 미리 불러 둔다**(확인 → 로드 순서로 하면 재생마다 그만큼 늦다). 권한이 없으면 걷는다.
 * ⚠️ 막 올라간 영상(FRESH_UPLOAD_MS)은 썸네일이 아직 없어 권한이 있어도 실패하므로 확인을 건너뛴다.
 */
export function HomeworkVideoPlayer({ preview, thumbnail, title, uploadedAt }: {
  preview: string; thumbnail: string; title: string; uploadedAt: string | null;
}) {
  // 선택(클릭) 뒤에만 마운트되므로 Date.now()가 서버 렌더와 어긋날 일이 없다.
  const [access, setAccess] = useState<Access>(() => {
    const at = uploadedAt ? Date.parse(uploadedAt) : NaN;
    // 미래 시각(브라우저 시계가 늦거나 값이 이상함)은 '막 올라감'으로 치지 않는다 — 5분까지만 봐준다.
    const age = Date.now() - at;
    return Number.isFinite(at) && age >= -5 * 60_000 && age < FRESH_UPLOAD_MS ? "ok" : "checking";
  });
  useEffect(() => {
    if (access !== "checking") return;
    const timer = window.setTimeout(() => setAccess("ok"), ACCESS_CHECK_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [access]);
  return (
    <div className="border-line relative aspect-video w-full overflow-hidden rounded-xl border">
      {access === "checking" ? (
        // eslint-disable-next-line @next/next/no-img-element -- 접근 확인용 Drive 썸네일(표시하지 않는다). next/image는 서버가 대신 받아 와서 판정이 안 된다.
        <img src={thumbnail} alt="" aria-hidden="true" className="hidden" onLoad={() => setAccess("ok")} onError={() => setAccess("denied")} />
      ) : null}
      {access !== "denied" ? (
        <iframe src={preview} title={title} allow="fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
          // 확인 중엔 탭 이동·스크린리더에서도 빠지게(숨긴 프레임에 포커스가 들어가지 않게).
          inert={access === "checking"}
          className={`absolute inset-0 size-full ${access === "checking" ? "invisible" : ""}`} />
      ) : null}
      {access !== "ok" ? (
        <div role="status" className="bg-muted/30 absolute inset-0 flex items-center justify-center p-6 text-center text-sm">
          {access === "denied" ? "권한이 없어서 영상을 재생할 수 없습니다." : "영상을 불러오는 중입니다."}
        </div>
      ) : null}
    </div>
  );
}
