// scripts/_classnote/video-link-compress-rules.mjs — `/v` 영상 사후 압축의 판정 규칙(순수 함수 · 시험 대상). 한 건 처리는 video-link-compress-job.mjs.

/**
 * 다시 해 볼 횟수와 간격(분) — 내려받기·전송·인코딩 실패. 인증·디스크·폴더 확인·계정 권한·Drive 한도 같은 PC·설정 사정(`later`)은
 * 세지 않고 1시간 뒤부터 두 배씩(하루 상한) 다시 본다 — 끝나지 않지만 고쳐지면 저절로 이어 가고, 그동안 하루 한 번만 본다.
 */
export const LINK_COMPRESS_MAX_ATTEMPTS = 5;
const BACKOFF_MIN = [30, 120, 360, 1440];
const LATER_MIN = 60;
const LATER_MAX_MIN = 1440;

/**
 * Drive의 지금 모습 판정 — 손대도 되나. `recovered` = 이미 이 원본으로 처리한 표식이 있다(판정 기록만 잃었다 — 다시 받지 않는다).
 * `wait` = 이 계정이 고칠 수 없는 파일(내 소유도, 편집할 수 있는 공유 드라이브 파일도 아님) — 웹이 만든 파일이라 계정·연결이
 * 어긋난 PC·설정 사정이다. 끝내지 않고 나중에 다시 본다(고치면 풀린다).
 * @param meta readDriveVideo 결과(없으면 null) · @param row 장부 줄(md5·bytes = 원본 지문)
 */
export function judgeLinkVideo(meta, row) {
  if (!meta || meta.trashed) return { skip: "gone" };
  const p = meta.properties ?? {};
  if (typeof p.aywaCompressed === "string" && p.aywaSourceMd5 === row.md5 && Number(p.aywaSourceBytes) === Number(row.bytes)
    && p.aywaUploadMd5 === meta.md5Checksum && Number(p.aywaUploadBytes) === Number(meta.size)) return { recovered: p.aywaCompressed };
  if (meta.md5Checksum !== row.md5 || Number(meta.size) !== Number(row.bytes)) return { skip: "changed" };
  const editable = meta.ownedByMe === true || (Boolean(meta.driveId) && meta.capabilities?.canEdit === true);
  if (!editable) return { wait: "not-owned" };
  if (!/^video\//i.test(String(meta.mimeType ?? ""))) return { skip: "not-video" };
  return { ok: true };
}

/** 압축본은 늘 MP4라 이름 끝도 `.mp4`로(원본이 `.mov`·`.webm`이어도). */
export function mp4Name(name) {
  const base = String(name ?? "").replace(/\.[A-Za-z0-9]{1,5}$/, "");
  return base ? `${base}.mp4` : null;
}

function prior(row, key) {
  const archive = row.route?.archive;
  return archive?.state === "retry" && Number.isInteger(archive[key]) ? archive[key] : 0;
}

/**
 * 실패 → 다음 판정. PC·설정 사정(`later` · 인증 401 · 요청 한도 429)은 횟수를 세지 않고 `waits`만 늘려 간격을 벌린다.
 * 그 밖은 `attempts`를 세고, 다 쓰면 'failed'(원본 그대로 · 다시 안 본다).
 */
export function failureOutcome(row, error, now) {
  const reason = String(error?.message ?? "").slice(0, 120) || "확인하지 못했습니다.";
  const attempts0 = prior(row, "attempts");
  const at = (min) => new Date(now.getTime() + min * 60_000).toISOString();
  if (error?.later || /HTTP (401|429)\b/.test(reason)) {
    const waits = prior(row, "waits") + 1;
    return { state: "retry", attempts: attempts0, waits, retryAt: at(Math.min(LATER_MIN * 2 ** (waits - 1), LATER_MAX_MIN)), reason };
  }
  const attempts = attempts0 + 1;
  if (attempts >= LINK_COMPRESS_MAX_ATTEMPTS) return { state: "failed", attempts, reason };
  return { state: "retry", attempts, retryAt: at(BACKOFF_MIN[attempts - 1]), reason };
}
