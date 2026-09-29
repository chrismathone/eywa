// 최종 총평 공용 상수 — 서버 액션("use server")은 async 함수만 export할 수 있어 여기 둔다([[#119]]).

/** 총평 최대 길이 — 문단 몇 개면 충분하다(jsonb 한 행이 무한히 커지지 않게). */
export const FINAL_REVIEW_MAX = 2000;
