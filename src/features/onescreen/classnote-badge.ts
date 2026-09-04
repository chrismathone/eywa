/**
 * ClassNote 발송 상태 → 표시 라벨 + 색. **앱 전체 단일 정본**(순수 모듈).
 *
 * 🔴 **왜 컴포넌트 파일이 아니라 여기인가**: 원래 `components/report-card.tsx`(클라 컴포넌트, `useState`
 * 사용)에 있었는데, 학생 상세 진도 탭(**서버 컴포넌트**)이 이 함수를 쓰려고 import하는 순간 Next가
 * *"useState에 의존하는 모듈을 서버 컴포넌트로 가져왔다"*며 **빌드 에러**를 냈다 — 학생 상세가 통째로
 * 안 열렸다(2026-08-18 실측). 라벨·색은 순수 데이터라 컴포넌트에 묶일 이유가 없다.
 * ⚠️ 이 파일에 `"use client"`를 붙이거나 컴포넌트를 넣지 말 것(gotcha #61의 반대 방향 — 서버가
 *    import하는 공유 모듈은 클라 전용 코드에 닿으면 안 된다).
 *
 * 🔴 **사본을 만들지 말 것.** 진도 탭이 같은 이름의 로컬 사본을 들고 있었는데 회수 3종·링크 취소·
 * 과목 제외·결석/출결 미체크를 switch에서 빠뜨려 **전부 "—"로 삼켰다** — 색이 다른 정도가 아니라
 * **회수·발송실패가 학생 상세에서 사라지는 버그**였다. 상태가 늘어날 때 사본은 따라오지 않는다.
 *
 * `short`는 좁은 표 칸용 짧은 라벨 — 같은 switch에서 나오므로 상태를 빠뜨릴 수가 없다.
 * 색은 의미색 캐논(src/lib/design/semantic-color.ts): 발송 완료=positive · 실패·회수=critical ·
 * 회수 대기=caution · 대기·처리중·제외=inert.
 */
export type ClassnoteBadge = { label: string; short: string; cls: string };

/**
 * 한 상태의 **네 글자를 한 자리에** 적는다 — 긴/짧은 라벨 × 한국어/영어.
 *
 * 🔴 영어 표를 따로 두지 않는 이유는 이 파일이 생긴 이유와 같다: 표가 둘이면 상태가 늘 때
 *    한쪽만 채워지고, 빠진 키는 화면에서 **조용히 사라진다**(사본이 회수 3종을 삼켰던 그 사고).
 *    인자가 넷이라 언어 하나만 적고 넘어갈 수가 없다.
 */
function badge(
  lang: "ko" | "en",
  ko: string,
  koShort: string,
  en: string,
  enShort: string,
  cls: string,
): ClassnoteBadge {
  return lang === "en"
    ? { label: en, short: enShort, cls }
    : { label: ko, short: koShort, cls };
}

/** @param lang 없으면 한국어 — 사무실 화면(발송 콘솔·보고서 목록)은 한 글자도 안 바뀐다. */
export function classnoteBadge(
  status?: string | null,
  lang: "ko" | "en" = "ko",
): ClassnoteBadge | null {
  switch (status) {
    case "queued":
      return badge(lang, "ClassNote 발송 대기", "대기", "Waiting to send to ClassNote", "Waiting", "text-text-dim");
    case "processing":
      return badge(lang, "ClassNote 처리 중", "처리중", "ClassNote is processing", "Processing", "text-text-dim");
    case "success":
      return badge(lang, "ClassNote 발송 완료", "발송됨", "Sent to ClassNote", "Sent", "text-green");
    case "failed":
      return badge(lang, "ClassNote 발송 실패", "실패", "ClassNote send failed", "Failed", "text-danger");
    case "too_old":
      return badge(lang, "ClassNote 발송 제외(오래됨)", "제외", "Left out of the send (too old)", "Left out", "text-text-dim");
    case "revoked":
      return badge(lang, "링크 취소됨 — 재발급 필요", "링크취소", "Link cancelled — needs reissuing", "Link off", "text-danger");
    // 회수 3종(2026-08-05) — **링크 취소와 다르다**: 회수는 ClassNote 학부모 게시글 자체를 지운다.
    // 실제 삭제는 연동 PC 워커가 하므로 요청 → 완료 사이에 대기 상태가 보인다(report-recall.ts).
    case "recall_requested":
      return badge(lang, "회수 처리 중 — 게시글 삭제 대기", "회수중", "Recalling — waiting for the post to be deleted", "Recalling", "text-amber");
    case "recalled":
      return badge(lang, "회수됨 — 학부모 게시글 삭제", "회수됨", "Recalled — the parent post was deleted", "Recalled", "text-danger");
    case "recall_failed":
      return badge(lang, "회수 실패 — 다시 시도하세요", "회수실패", "Recall failed — try again", "Recall failed", "text-danger");
    case "name_conflict":
      return badge(lang, "동명이인 — 자동 발송 차단", "동명이인", "Same name as another student — auto-send blocked", "Same name", "text-danger");
    case "blocked_shared":
      // 워커 프리플라이트 게이트가 오발송 위험(한 보드에 2가족+ 등)으로 보류 — 사유는 classnote_error에 한글로.
      return badge(lang, "공유 보드 — 자동 발송 차단", "공유 보드", "Shared board — auto-send blocked", "Shared board", "text-danger");
    case "subject_off":
      // 원장 설정(classnoteSubjects) 밖 과목 — 저장만 되고 게시 안 됨. "발송 대기" 오인 방지(#2 확정).
      return badge(lang, "발송 대상 아님(과목 설정)", "과목 제외", "Not a send target (subject setting)", "Subject off", "text-text-dim");
    case "absent":
      // 서버 결석 게이트(#77) 반환 상태(세션 내 표시 전용 — DB엔 안 남음). 저장만 되고 발송 제외.
      return badge(lang, "결석 — 발송 제외", "결석", "Absent — left out of the send", "Absent", "text-text-dim");
    case "report_optout":
      // '수업보고서 미발송' 반(0174a) 게이트 반환 상태(세션 내 표시 전용 — DB엔 안 남는다).
      // 저장만 되고 발송 제외. 2026-08-19부터 이 반도 로스터에 있어서(출결 때문) 이 상태가 보인다.
      return badge(lang, "미발송 반 — 발송 제외", "미발송 반", "No-send class — left out", "No-send class", "text-text-dim");
    case "no_attendance":
      // 서버 출결 미체크 게이트(2026-08-17) 반환 상태(세션 내 표시 전용). 저장만 되고 발송 제외.
      return badge(lang, "출결 미체크 — 발송 제외", "출결없음", "Attendance not marked — left out", "No attendance", "text-text-dim");
    default:
      return null;
  }
}
