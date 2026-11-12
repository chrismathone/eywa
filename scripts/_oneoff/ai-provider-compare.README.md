# AI 공급자 품질 비교 실행기

이 장치는 운영 DB에 연결하지 않고 Claude/Codex 내부요금제로만 품질을 비교한다. 기본 모드 `internal`은 같은 프롬프트를 Claude와 Codex에 보내며, 학부모 멘트는 같은 입력을 두 번씩 실행해 흔들림을 잰다. 실제 OpenAI API는 품질 비교에 쓰지 않고 `openai-connectivity`에서 가짜 입력 한 건으로 연결과 합성 Claude 인증 실패 뒤 폴백만 확인한다.

## 실행

```powershell
pnpm tsx scripts/_oneoff/ai-provider-smoke.mts --mode=internal --input=scripts/_oneoff/pseudonymized-ai-input.json --out=tmp/ai-provider-compare.json
```

`--mode=claude-cli` 또는 `--mode=codex-cli`로 한쪽만 실행할 수 있다. API 연결 확인은 원장 승인 범위에서 `pnpm tsx scripts/_oneoff/ai-provider-smoke.mts --mode=openai-connectivity`로 따로 실행한다. `--input`을 생략하면 가짜 이름만 든 멘트 1건·운영형 분석 14건·계약서 1건을 쓴다.

Windows에서는 PATH의 `codex.exe`가 아니라 npm 설치본 `codex.cmd`를 고르며, 다른 실행 파일을 써야 할 때만 `AYWA_CODEX_BIN`에 경로를 지정한다. 실행기는 모델 호출 전에 `codex --version`을 한 번 확인해 표와 결과 JSON의 `cliVersion`에 남긴다.

## 가명 입력 파일 형식

```json
{
  "version": 1,
  "ment": [
    {
      "id": "ment-001",
      "mode": "A",
      "input": {
        "studentName": "가명학생A",
        "subject": "수학",
        "progress": "일차방정식 2단원",
        "storedProgress": "수학 2-6-1 일차방정식 2단원",
        "dailyTest": "10문제 중 8개 맞음",
        "checkTest": "",
        "attitude": "차분히 풀이함",
        "homework": "80%",
        "homeworkToday": "가명교재 32~34쪽",
        "textbook": "가명교재",
        "specialNote": "다음 수업은 목요일 오후 4시"
      }
    }
  ],
  "analyses": [
    {
      "id": "consult-001",
      "kind": "consultation",
      "consult": {
        "prospect_name": "가명학생B",
        "prospect_grade": "중2",
        "prospect_school": "가명중학교B",
        "parent_name": "가명보호자B",
        "parent_phone": null
      },
      "transcript": "[화자 A] ... 가명 처리한 1,500~3,000자 전사 ...",
      "mustCapture": [
        { "label": "환불 분쟁 이력", "anyOf": ["환불", "분쟁"] },
        { "label": "건강 주의", "anyOf": ["과호흡", "알레르기"] }
      ]
    }
  ]
}
```

멘트 입력에 필요한 칸은 `studentName`, `subject`, `progress`, `dailyTest`, `checkTest`, `attitude`, `homework`, `homeworkToday`, `textbook`, `specialNote`이며 운영 자동작성의 `ReportCommentInput`과 같은 모양이다. 선택 칸은 `classContext`, `classNotice`, `videoHomework`, `videoHomeworkDue`, `understanding`, `lessonMemo`다. 저장 보고서의 진도 칸처럼 과목 라벨이 붙은 값을 비교하려면 `storedProgress`에 넣는다. 실행기가 운영 입력처럼 `subject`와 `progress`를 분리해 조립하므로 저장 결과를 그대로 프롬프트 재료로 잘못 쓰는 #145 차이를 피한다.

분석 사례에는 임의 `prompt`를 넣지 않는다. `kind`별 운영 재료만 받으며 실행기가 운영과 같은 빌더를 호출한다: `consultation`은 `consult`·`transcript`·선택 `multi`, `form`은 `context`·`transcript`, `classification`은 `items`, `translation`은 `source`, `meeting`은 `transcript`·`context`, `studentConsultation`은 `transcript`·학생/상담 `context`, `prep`은 운영 `PrepFacts`와 같은 `facts`다. 모든 사례에 `mustCapture`를 두고 각 항목은 사람이 읽을 사실 이름 `label`과 출력에서 인정할 대체 표현 `anyOf`를 가진다. 상담 전사는 1,500~3,000자로 화자 교대·잡담·주의 신호를 포함하고, 폼 입력은 학생 가명·학년·학교 가명만 쓴다. 실제 학생 이름·전화번호·주민번호는 파일에 넣지 않는다.

`studentConsultation.context`에 필요한 칸은 `studentName`, `grade`, `school`, `consultedAt`, `audience`, `category`다. `prep.facts`는 운영 `PrepFacts` 그대로 `student`, `parent`, `checklist`, `habits`, `priorConsults`, `siblings`, `classes`, `tuition`, `textbooks`, `peers`, `policy`를 넣는다. 이 구조를 그대로 받기 때문에 저장된 보고서 문장을 재료처럼 다시 넣지 않고 운영 조립·검증·학부모 호칭 후처리를 모두 통과한다.

표에는 기능, 경로, 실행 차수, 통과 여부, 실제/요청 모델, Codex CLI 판, 추론 강도, 시간, 입력·출력 토큰과 필수 사실 포착률이 나온다. 결과 JSON에는 종결형 섞임, 입력 숫자 보존·없는 숫자, 단원/퍼센트, 과목명 접두, 금지 표현, 길이, 고유명사 의심, 두 실행의 문장 수·종결형·길이 차이와 분석 필수 사실 포착률·누락 사실, 참고용 칸 채움률, `warnings` 누락, 운영 normalize 통과, 잡담 혼입이 함께 저장된다. 계약서 사례는 Codex 호출을 하지 않고 `거절(Claude 전용)`으로 남아야 정상이다.
