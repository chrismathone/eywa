/** 등록상담 심층 분석 운영 프롬프트와 응답 계약의 단일 소스. */
export type ConversationFlowNode = {
  topic: string;
  summary: string;
  children?: ConversationFlowNode[];
};

// 분석 결과 스키마(풀세트) — 섹션 순서 = 화면 아코디언 순서.
export type ConsultationReport13 = {
  consultationType: string;
  summary: string;
  familyBackground: string;
  parentConcerns: string;
  parentQuestions: string;
  parentRequests: string;
  parentSatisfaction: string;
  studentTraits: string;
  teacherResponse: string;
  salesPoints: string;
  agreements: string;
  followUps: string;
  warnings: string;
  conversationFlow?: ConversationFlowNode[];
  extracted: {
    prospectName: string | null;
    grade: string | null;
    school: string | null;
    parentName: string | null;
    parentPhone: string | null;
  };
};

/** 프롬프트에 들어가는 상담 행 필드(현재 입력값 — 추출 대조·grounding용). */
export type ConsultationPromptInput = {
  prospect_name: string;
  prospect_grade: string | null;
  prospect_school: string | null;
  parent_name: string | null;
  parent_phone: string | null;
};

/** ijw 이식 프롬프트 문자열 빌드(단일/합본 공용). multi=true면 회차 종합 안내 추가. */
export function buildConsultationAnalysisPrompt(
  consult: ConsultationPromptInput,
  formatted: string,
  multi: boolean,
): string {
  return [
    "다음은 학원 신입생 등록상담 녹음 전사입니다. 아래 지침대로 심층 분석한 보고서를 JSON으로만 답해주세요.",
    "음성인식(ASR) 특성상 고유명사(인명·학교명·지명)가 잘못 인식될 수 있습니다. 같은 사람을 가리키는 유사 이름이 여러 형태로 나오면 하나로 통일하고, 통일한 사실을 상담 요약에 메모하세요.",
    "",
    "⚠️ 분석 원칙 (최우선·반드시 준수):",
    "- 팩트 기반: 전사에 실제로 나온 발화만 근거로 분석한다. 전사에 없는 내용은 창작·추측·환각 절대 금지(일반론·보편적 조언·있을 법한 시나리오·다른 학생에게도 통할 뻔한 문구 금지).",
    "- 상담 외 잡담 배제: 녹음이 상담 종료 후에도 계속돼 섞인, 등록상담과 무관한 대화(잡담·일상 대화·음식/식사·다른 사람 이야기·오가는 인사말 등)는 분석 대상에서 제외하고 실제 상담 내용만 분석한다.",
    "- 근거 없으면 비운다: 각 섹션은 전사에 근거가 있을 때만 채우고, 근거가 없으면 빈 문자열(추출 정보는 null, conversationFlow는 빈 배열). 억지로 채우지 않는다.",
    "- 모순 금지: 한 섹션의 내용이 다른 섹션과 어긋나면 안 된다. 예) '형제자매 없음'이라 적으면 '형제 할인' 요청을 만들어내지 말 것. 전사에 형제·할인 언급이 있으면 가정 배경에 형제 존재를 반영하고, 없으면 형제 관련 항목을 아예 넣지 않는다. 작성 전 전사 근거를 대조하라.",
    "- 행간·감정·뉘앙스까지 읽어 학부모의 진짜 의도와 감정을 파악한다.",
    "",
    "ASR 오류 처리: 문맥상 맞지 않는 표현·잘못 인식된 고유명사는 문맥으로 추론한 뒤 바로 뒤에 [?]를 붙여 사용자가 원본과 대조하게 한다(예: '대구일중[?]').",
    "",
    "출력 형식 규칙(중요 — 반드시 지킬 것):",
    "- 각 JSON 문자열 값 안에서 항목을 구분할 때 반드시 줄바꿈(\\n)을 사용한다. 여러 항목이면 각 항목을 새 줄에 '- '로 시작한다(예: \"- 첫째 항목\\n- 둘째 항목\\n- 셋째 항목\").",
    "- 산문형 섹션(consultationType/summary/familyBackground/parentSatisfaction)은 '- ' 불릿을 쓰지 말고 자연스러운 문장(산문)으로 쓴다. 길면 2~3문장마다 줄바꿈(\\n)으로 문단을 나눈다.",
    "- 마크다운 볼드(**)·머리말(#)·코드블록을 쓰지 말 것. 순수 텍스트 + '- ' 불릿 + \\n 줄바꿈만 사용한다.",
    "- speakerRoles: 전사의 화자 라벨(A,B,…)을 상담 맥락으로 추론해 '상담자'/'학부모'/'학생'/'기타' 중 하나로 매핑한다.",
    "- ⚠️ 모든 섹션 본문에 화자 기호를 절대 쓰지 말 것 — 'A'/'B'/'C'·'(A)'·'화자 A'·'학생 C' 같은 표기 전부 금지. 사람은 이름이나 역할(상담자/학부모/학생)로만 지칭하고, 요약·가정배경 등 산문은 가능한 한 학생 이름을 주어로 자연스럽게 서술한다(예: '이태경은 …').",
    "",
    `학생 이름(현재 입력값): ${consult.prospect_name}`,
    `학년: ${consult.prospect_grade ?? "미상"}`,
    `학교: ${consult.prospect_school ?? "미상"}`,
    `학부모(현재 입력값): ${consult.parent_name ?? "미상"} / 연락처 ${consult.parent_phone ? "입력됨" : "미상"}`,
    "",
    "섹션별 작성 지침:",
    "1. consultationType: 상담 성격 한 줄 (예: '등록 상담 - 진단 결과 설명 및 등록 유도', '초기 탐색', '환불/이탈 우려'). 등록/영업 상담이면 상담사가 등록을 유도하는 구조임을 명시.",
    "2. summary: 상담 전체 요약 5~7문장 — 학생을 주어로 한 산문(불릿·번호 금지). 학생의 현재 상황·핵심 논의·결론/합의를 자연스럽게 서술한다. '상담자와 학부모가 …를 논의한다'식 회의록 나열이 아니라 '이태경은 수학 60점대로 …, 상담 결과 주3회 등록하기로 …'처럼 학생·결과 중심으로. ASR로 이름이 혼재됐다면 통일 사실도 명시.",
    "3. familyBackground: 가정 배경/개인 맥락 — 학부모 나이·직업·가족구성, 학생의 형제관계, 과거 학습 이력, 이전 학원·공부방 경험, 교육관 등 발화에 나온 것만. 언급 없는 항목은 생략.",
    "4. parentConcerns: 학부모가 걱정·불안해하는 부분 — 직접 말한 것 + 말투·맥락에서 추론되는 것.",
    "5. parentQuestions: 학부모가 질문한 사항. 각 항목을 한 줄로 쓴다 — '- 질문 요지 → 답변 요약'. 상담자가 실제로 답한 경우에만 답변을 쓰고, 상담자가 답하지 않은 질문만 답변 자리에 '(미답변)'을 쓴다. ⚠️ 답변 내용과 '(미답변)'을 함께 쓰지 말 것(답을 썼으면 '(미답변)' 금지). 질문과 답변을 서로 다른 줄로 분리하지 말 것(한 질문 = 한 항목 = 한 줄, 항목 사이만 \\n).",
    "6. parentRequests: 학부모가 '직접 발의해' 요청한 사항만(상담사가 제안하고 학부모가 수용한 건 제외 → teacherResponse/agreements로).",
    "7. parentSatisfaction: 전반적 만족도·감정. 긍정 반응 / 불만·우려 / 아직 안 풀린 부분을 구분.",
    "8. studentTraits: 학생 특이사항 — 학습 태도, 성적 변화, 심리 상태(자존감·자기효능감), 의사소통 패턴(눈치·표현 어려움), 교우관계, 강·약점.",
    "9. teacherResponse: 상담자가 제시한 해결책·설명·제안 요약(상담사가 제안하고 학부모가 수용한 것 포함).",
    "10. salesPoints: 상담사가 등록/유지를 위해 쓴 설득 논거(성공 사례, 입시 정보, 시설·프로그램 홍보, 지역 특수성 등). 등록/영업 성격이 아니면 빈 문자열.",
    "11. agreements: 합의된 사항 — 구체적 일정·방법·학습 로드맵(시기별 목표·진도 계획) 포함. 누가 제안했는지(학부모/상담사) 표시.",
    "12. followUps: 후속 조치 항목(담당자·기한 가능하면 포함).",
    "13. warnings: 주의 신호 — '특이사항 없음'으로 넘기지 말고 꼼꼼히 확인: 학생 자존감/자기효능감 저하, 가정 내 갈등·압박(부부 갈등·과도한 기대·감정적 훈육), 학생 의사소통 문제(부모에게 말 못함·눈치), 퇴원/이탈 가능성, 학부모 번아웃/좌절. 전사에 근거 있는 것만. 해당 없으면 '확인된 위험 신호 없음'.",
    "14. conversationFlow: 상담이 다룬 주제를 시간 순 트리로. 각 노드는 { topic, summary, children }. 근거 부족하면 빈 배열.",
    "15. extracted: 전사에서 자동 추출한 핵심 정보 (학생 이름/학년/학교/학부모/연락처). 발화에 명시되지 않으면 null.",
    "",
    "녹음 전사 (화자 라벨 포함):",
    formatted,
    "",
    "JSON schema (모든 필드 한국어, 줄바꿈은 \\n):",
    "{",
    '  "speakerRoles": { "A": "상담자|학부모|학생|기타", "B": "상담자|학부모|학생|기타" },',
    '  "consultationType": string,',
    '  "summary": string,',
    '  "familyBackground": string,',
    '  "parentConcerns": string,',
    '  "parentQuestions": string,',
    '  "parentRequests": string,',
    '  "parentSatisfaction": string,',
    '  "studentTraits": string,',
    '  "teacherResponse": string,',
    '  "salesPoints": string,',
    '  "agreements": string,',
    '  "followUps": string,',
    '  "warnings": string,',
    '  "conversationFlow": [ { "topic": string, "summary": string, "children": [ { "topic": string, "summary": string } ] } ],',
    '  "extracted": {',
    '    "prospectName": string | null,',
    '    "grade": string | null,',
    '    "school": string | null,',
    '    "parentName": string | null,',
    '    "parentPhone": string | null',
    "  }",
    "}",
    "",
    "추측·창작·환각 금지 — 전사에 실제 근거가 없는 내용은 빈 문자열 또는 null(억지로 채우지 말 것). 상담과 무관한 잡담은 무시.",
    "JSON만 출력. 마크다운 코드 블록 없이.",
    ...(multi
      ? [
          "",
          "※ 전사가 《녹음 n》 헤더로 나뉘어 있으면 같은 학생에 대해 여러 차례 진행된 상담입니다 — 전체 회차를 종합해 분석하세요. 화자 라벨(A/B)은 녹음마다 독립이므로 speakerRoles는 가장 최근 녹음 기준으로만 추론하세요.",
        ]
      : []),
  ].join("\n");
}
