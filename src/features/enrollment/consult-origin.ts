/**
 * 등록상담 **출처 라벨** — "이 기록이 어디서 왔나"를 한 줄로. 순수 함수(Vitest).
 *
 * 🔴 배경(원장 2026-09-01 제보): 병합 화면이 같은 학생의 두 상담을 `makeedu 연동` / `직접 입력`으로
 * 보여 줘서 *"aywa에서 작성한 걸 makeedu로 동기화시켰는데 다시 aywa로 가져온 것 같다 — 버그같다"*는
 * 의심을 샀다. 실제로는 왕복이 아니었다(실측: 푸시한 35건 전부 counselSeq 확보 · `sync_added_at` 흔적 0).
 *
 * 원인은 **라벨이 `makeedu_id`만 보고 판단한 것**이다. 그 컬럼엔 뜻이 둘 있다:
 *   · makeedu에서 **들어온** 건의 원본 키 → 진짜 "makeedu 연동"
 *   · 우리가 makeedu로 **보내고** 받아 적은 counselSeq(`makeedu_pushed_at`과 함께) → 우리 기록이다
 * 뒤엣것을 "makeedu 연동"이라 부르면 **우리가 만든 기록이 남의 것처럼 보인다**.
 *
 * ⚠️ 그래서 판정은 `makeedu_pushed_at`을 **먼저** 본다. 순서를 바꾸지 말 것.
 */
export type ConsultOriginInput = {
  /** 옛 시트 이관 키. */
  legacyKey?: string | null;
  /** makeedu 원본 키(들어온 것) **또는** 우리가 보내고 받아 적은 counselSeq. */
  makeeduId?: string | null;
  /** aywa → makeedu로 **보낸** 시각. 있으면 이 기록은 우리 것이다. */
  makeeduPushedAt?: string | null;
  /** 학부모 QR 공개접수로 들어온 건. */
  fromPublicIntake?: boolean | null;
};

export function consultOriginLabel(r: ConsultOriginInput): string {
  if (r.legacyKey) return "옛 시트 이관";
  // 🔑 우리가 보낸 건 — 키가 makeedu에서 왔어도 **기록의 출처는 aywa**다. 어디서 시작했는지를 함께 적어
  //    "보냈다"는 사실까지 한 줄에 담는다(병합에서 어느 쪽을 남길지 고르는 근거가 된다).
  if (r.makeeduPushedAt) return r.fromPublicIntake ? "QR 접수 · makeedu 전송함" : "직접 입력 · makeedu 전송함";
  if (r.makeeduId) return "makeedu 연동";
  if (r.fromPublicIntake) return "QR 접수";
  return "직접 입력";
}
