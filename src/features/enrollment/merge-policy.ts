// 등록상담 병합 — **컬럼별 정책표**(순수 데이터). 로직은 merge-plan.ts.
//
// 🔴 이 표가 병합의 안전장치다. 컬럼을 하나 빠뜨리면 그 값은 **조용히 승자 것으로 덮이거나 사라진다**.
//    enrollment_consultations에 컬럼을 추가하면 여기에도 추가할 것(구조 테스트가 전수를 강제한다).
//
// 정책 4종:
//   · skip   — 병합 대상 아님(행 정체성·시스템 타임스탬프). 승자 값 그대로.
//   · scalar — 한쪽만 차 있으면 채우고, 양쪽이 다르면 **사람이 고른다**(자동 판정 금지).
//   · append — 자유 서술. 서로 다른 내용은 **이어붙인다**(둘 다 실제로 있었던 기록이라 하나를 버리면 손실).
//   · atomic — 여러 컬럼이 **한 사건**을 이룬다. 찢으면 거짓이 된다(오디오는 A인데 전사는 B인 행).
//              세트 단위로 통째 채택하며, 양쪽 세트가 다 살아 있으면 사람이 고른다.

/** 한 사건을 이루는 컬럼 묶음 — 세트 안에서 값을 섞지 않는다. */
export const ATOMIC_SETS = {
  // 녹음 1건 = 파일·길이·전사·화자·처리상태가 한 덩어리. 섞으면 "A의 오디오에 B의 전사"가 된다.
  audio: [
    "audio_path",
    "audio_duration_sec",
    "audio_size_bytes",
    "transcription",
    "speaker_labels",
    "processing_status",
    "processing_error",
    "assemblyai_transcript_id",
  ],
  // 사전 브리프 스냅샷 + 생성 상태.
  prep: ["prep_brief", "prep_brief_at", "prep_brief_status", "prep_brief_error", "prep_brief_job_at"],
  // 결제 사실 — 금액만 가져오고 날짜를 두면 "언제 낸 27만원인지" 모르는 행이 된다.
  // ⚠️ `registration_status`("영수등록"·"등록완료"·"미등록")는 여기 넣지 말 것 — 금액이 없는 행도
  //    상태는 갖고 있어서, 한 세트로 묶으면 **결제 기록이 한쪽에만 있는데도** 세트가 양쪽 다 살아 있는
  //    것으로 보여 불필요한 질문이 생긴다(실측 11그룹 중 3그룹이 이 꼴). 상태는 별도 scalar.
  payment: ["payment_amount", "payment_date", "registrar"],
  // 후속조치 — 날짜와 내용이 짝. 내용만 이어붙이면 어느 날짜의 약속인지 사라진다.
  followUp: ["follow_up_date", "follow_up_content"],
  // QR 공개접수 출처 — 학부모가 낸 원본 제출의 증거(토큰·체크리스트·플래그).
  intake: ["from_public_intake", "intake_token_id", "intake_checklist"],
  // 🔴 makeedu 연동 키 — 승자로 옮기지 않으면 패자 삭제 후 **다음 동기화에 되살아난다**.
  makeedu: ["makeedu_id", "sync_added_at", "makeedu_pushed_at"],
  // 🔴 옛 시트 이관 키 — 재이관 스크립트가 다시 돌면 부활(부분 유니크가 승자 것만 막는다).
  legacy: ["legacy_key", "legacy_source"],
  // 소개한 사람(0362a) — 원생·직원은 둘 중 하나만(체크 제약)이라 따로 고르면 둘 다 선 행이 생긴다. 신청서에 적은 이름도 같은 소개의 근거.
  referrer: ["referrer_student_id", "referrer_staff_id", "referrer_name"],
} as const;

export type AtomicSetName = keyof typeof ATOMIC_SETS;

/**
 * 🔑 **사람에게 묻지 않는 세트** — 기술 식별자라 상담사가 판단할 근거가 없다.
 * 승자 것을 유지하고 패자 키는 감사로그에 보존한다(되짚을 근거는 남기되 질문은 안 한다).
 * 1차 드라이런에서 legacy 62그룹·makeedu 12그룹이 "어느 시트 탭 키를 남길까요?"를 묻고 있었다 —
 * 답할 수 없는 질문이 전체 선택지의 34%를 차지해 무충돌 그룹이 0%가 됐다.
 */
export const KEY_SETS: readonly AtomicSetName[] = ["makeedu", "legacy"];

/** 이어붙이는 자유 서술 — 짝 컬럼이 없어 합쳐도 맥락이 안 깨지는 것만. */
export const APPEND_COLUMNS = ["parent_request", "safety_notes", "siblings_details"] as const;

/**
 * 시각·날짜는 **가장 이른 것**이 사실이다 — 첫 접촉 시점이 그 상담의 시작이고,
 * 늦은 값은 같은 사건을 나중에 옮겨 적으면서 생긴 그림자다(옛 시트 이월 기재가 정확히 이 꼴).
 * 사람에게 "9시 10분과 8시 36분 중 어느 쪽인가요"를 묻는 건 답이 없는 질문이다.
 */
export const EARLIEST_WINS_COLUMNS = ["consulted_at", "received_date", "consultation_date"] as const;

/**
 * 전화 — 형식 차이(하이픈·공백·국가번호)는 충돌이 아니다. 정규화해서 같으면 같은 값.
 *
 * 🔴 **이 컬럼에는 전화번호가 아닌 값이 실제로 들어 있다**(2026-08-11 실측, 2,206건 중):
 *   · `333D32100E28110C` 꼴 16자리 암호문 **210건** — makeedu 임포터가 ijw 암호화 값을 그대로 넣었다(2023~2024).
 *   · 상담교사 이름 **약 87건** — 2025년 이관에서 컬럼이 밀렸다("정유진" 21건·"김초롱" 9건·"원 일" 7건…).
 * 둘 다 사람에게 "어느 쪽을 남길까요"라고 물어도 **답할 수 없는 값**이라, 병합은 전화 모양인 값만 후보로 본다.
 * (표시 자체가 잘못된 건 별개 문제 — 병합이 고칠 일이 아니다.)
 */
export const PHONE_COLUMNS = ["parent_phone", "student_phone", "home_phone"] as const;

/**
 * 사람 이름이 쉼표로 나열되는 칸 — "예원 대표"와 "대표 예원"은 **같은 값**이고,
 * "대표"는 "예원 대표"의 부분집합이라 더 많은 쪽이 정보를 다 담는다. 어순만 다른 걸 물으면 안 된다.
 */
// ⚠️ `registrar`는 여기 넣지 말 것 — payment 세트에 속해 결제 사실과 한 덩어리다(두 번 결정되면 값이 갈린다).
export const NAME_LIST_COLUMNS = ["counselor", "receiver"] as const;

/** 값이 아니라 '빈칸 표시'인 문자열 — 옛 시트에서 그대로 넘어왔다. */
export const PLACEHOLDER_VALUES: readonly string[] = ["-", "—", "–", ".", "n/a", "N/A"];

/**
 * 학교명 — "일중"과 "대구일중"은 같은 학교다. 판정은 새로 만들지 않고
 * [`normalizeSchoolName`](../schools/school-name.ts) **단일 소스**를 그대로 쓴다(규칙 2벌 금지).
 * 급만 남은 값("초"·"중")은 학교를 특정 못 하므로 후보에서 뺀다 — 실측 "동평초" vs "초".
 */
export const SCHOOL_COLUMNS = ["prospect_school"] as const;

/**
 * 동의·신청 플래그는 **한 번이라도 true면 true**(동의한 기록이 실제로 있었다는 뜻).
 * false는 "안 함"이 아니라 대개 "그 폼에 칸이 없었음"이라, 승자만 보면 동의 기록이 사라진다.
 */
export const BOOLEAN_OR_COLUMNS = ["privacy_agreement", "installment_agreement", "shuttle_bus_request"] as const;

/** 병합하지 않는다 — 행 정체성·시스템 타임스탬프. */
export const SKIP_COLUMNS = ["id", "tenant_id", "created_at", "updated_at"] as const;

/**
 * 나머지 전부 = scalar. 여기 **열거하지 않은 컬럼이 실제 표에 있으면 구조 테스트가 실패**한다
 * (새 컬럼이 정책 없이 조용히 승자 값으로 덮이는 것을 막는 유일한 장치).
 */
export const SCALAR_COLUMNS = [
  "prospect_name",
  "prospect_grade",
  "prospect_school",
  "parent_name",
  "parent_phone",
  "learning_history",
  "consultant_id",
  "outcome",
  "student_id",
  "english_name",
  "gender",
  "blood_type",
  "birth_date",
  "student_phone",
  "home_phone",
  "parent_relation",
  "address",
  "zip_code",
  "address_detail",
  "consultation_path",
  "subject",
  "career_goal",
  "siblings",
  "registration_status",
  "shuttle_bus_request",
  "privacy_agreement",
  "installment_agreement",
  "non_registration_reason",
  "subject_details",
  "counselor",
  "received_date",
  "student_type",
  "consultation_date",
  "consulted_at",
  "receiver",
] as const;

/**
 * outcome 진행도 — **결말(terminal)과 진행 중을 구분한다.**
 * 🔴 `enrolled`와 `declined`는 순서가 아니라 **서로 반대인 두 결말**이다. 한 줄 랭킹에 세우면
 * "등록이 미등록보다 나중"이라는 거짓 규칙이 생겨 미등록 판정을 조용히 등록으로 덮는다.
 * → 진행 중(pending…ai_done)끼리는 자동으로 더 나아간 쪽, **결말이 둘 다 있으면 사람이 고른다.**
 * 실데이터: `consulted+enrolled` 35그룹(자동 해결 가능) vs `declined+enrolled` 2그룹(사람 확인 필요).
 */
export const OUTCOME_RANK: Record<string, number> = {
  pending: 0,
  scheduled: 1,
  no_show: 2,
  consulted: 3,
  ai_done: 4,
  declined: 5,
  enrolled: 5,
};

/** 서로 배타적인 결말 — 둘 다 있으면 자동 판정 금지. */
export const TERMINAL_OUTCOMES: readonly string[] = ["enrolled", "declined"];

/** 화면·감사로그용 한글 라벨(raw 컬럼명 노출 금지 규칙). */
export const COLUMN_LABEL: Record<string, string> = {
  prospect_name: "학생 이름",
  prospect_grade: "학년",
  prospect_school: "학교",
  parent_name: "학부모 이름",
  parent_phone: "학부모 연락처",
  parent_request: "상담 내용",
  learning_history: "학습 이력",
  consultant_id: "상담자",
  outcome: "진행 상태",
  student_id: "연결된 학생",
  consulted_at: "상담 일시",
  english_name: "영문 이름",
  gender: "성별",
  blood_type: "혈액형",
  birth_date: "생년월일",
  student_phone: "학생 연락처",
  home_phone: "자택 전화",
  parent_relation: "학부모 관계",
  address: "주소",
  zip_code: "우편번호",
  address_detail: "상세 주소",
  consultation_path: "상담 경로",
  subject: "과목",
  career_goal: "희망 진로",
  siblings: "남매 관계",
  registration_status: "등록 상태",
  safety_notes: "특이사항",
  shuttle_bus_request: "셔틀버스 신청",
  privacy_agreement: "개인정보 동의",
  installment_agreement: "할부 규정 동의",
  non_registration_reason: "미등록 사유",
  subject_details: "과목별 상세",
  counselor: "상담 교사",
  received_date: "접수일",
  student_type: "학생 구분",
  siblings_details: "남매 관계 기록",
  consultation_date: "상담일",
  receiver: "전화 수신자",
  audio: "녹음·전사",
  prep: "사전 브리프",
  payment: "결제 기록",
  followUp: "후속조치",
  intake: "QR 접수 원본",
  makeedu: "makeedu 연동 키",
  legacy: "옛 시트 이관 키",
  referrer: "소개한 사람",
};
