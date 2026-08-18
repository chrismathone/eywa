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

export function classnoteBadge(status?: string | null): ClassnoteBadge | null {
  switch (status) {
    case "queued":
      return { label: "ClassNote 발송 대기", short: "대기", cls: "text-text-dim" };
    case "processing":
      return { label: "ClassNote 처리 중", short: "처리중", cls: "text-text-dim" };
    case "success":
      return { label: "ClassNote 발송 완료", short: "발송됨", cls: "text-green" };
    case "failed":
      return { label: "ClassNote 발송 실패", short: "실패", cls: "text-danger" };
    case "too_old":
      return { label: "ClassNote 발송 제외(오래됨)", short: "제외", cls: "text-text-dim" };
    case "revoked":
      return { label: "링크 취소됨 — 재발급 필요", short: "링크취소", cls: "text-danger" };
    // 회수 3종(2026-08-05) — **링크 취소와 다르다**: 회수는 ClassNote 학부모 게시글 자체를 지운다.
    // 실제 삭제는 연동 PC 워커가 하므로 요청 → 완료 사이에 대기 상태가 보인다(report-recall.ts).
    case "recall_requested":
      return { label: "회수 처리 중 — 게시글 삭제 대기", short: "회수중", cls: "text-amber" };
    case "recalled":
      return { label: "회수됨 — 학부모 게시글 삭제", short: "회수됨", cls: "text-danger" };
    case "recall_failed":
      return { label: "회수 실패 — 다시 시도하세요", short: "회수실패", cls: "text-danger" };
    case "name_conflict":
      return { label: "동명이인 — 자동 발송 차단", short: "동명이인", cls: "text-danger" };
    case "blocked_shared":
      // 워커 프리플라이트 게이트가 오발송 위험(한 보드에 2가족+ 등)으로 보류 — 사유는 classnote_error에 한글로.
      return { label: "공유 보드 — 자동 발송 차단", short: "공유 보드", cls: "text-danger" };
    case "subject_off":
      // 원장 설정(classnoteSubjects) 밖 과목 — 저장만 되고 게시 안 됨. "발송 대기" 오인 방지(#2 확정).
      return { label: "발송 대상 아님(과목 설정)", short: "과목 제외", cls: "text-text-dim" };
    case "absent":
      // 서버 결석 게이트(#77) 반환 상태(세션 내 표시 전용 — DB엔 안 남음). 저장만 되고 발송 제외.
      return { label: "결석 — 발송 제외", short: "결석", cls: "text-text-dim" };
    case "no_attendance":
      // 서버 출결 미체크 게이트(2026-08-17) 반환 상태(세션 내 표시 전용). 저장만 되고 발송 제외.
      return { label: "출결 미체크 — 발송 제외", short: "출결없음", cls: "text-text-dim" };
    default:
      return null;
  }
}
