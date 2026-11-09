import s from "./sample.module.css";

/**
 * 시안 화면(경영 분석 · 통합 지식그래프 · 업무 작성센터 · 관찰·후속 조치) 공용 — aywa-next(375d27df4)에서 UI만 옮겨 온 것.
 * 🔴 이 화면들이 읽고 쓰던 표(management_* · academy_* · marketing_* …)는 이 DB에 없다. 예시 값만 그리고, 저장은 하지 않는다.
 */
export const SAMPLE_SAVE_MESSAGE = "시안 화면입니다 — 저장되지 않습니다";

export function SampleBanner() {
  return (
    <p role="note" className={s.banner}>
      시안 · 예시 값입니다(실제 기록과 연결 전)
    </p>
  );
}

/** 저장·전송 버튼 대신 부른다 — 네트워크 요청 없이 같은 자리에 안내 문구를 돌려준다. */
export async function sampleSave(): Promise<string> {
  return SAMPLE_SAVE_MESSAGE;
}
