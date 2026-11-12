# AI 공급자 품질 비교 실행기

이 장치는 운영 DB에 연결하지 않고 Claude/Codex 내부요금제로만 품질을 비교한다. 기본 모드 `internal`은 같은 프롬프트를 Claude와 Codex에 보내며, 학부모 멘트는 같은 입력을 두 번씩 실행해 흔들림을 잰다. 실제 OpenAI API는 품질 비교에 쓰지 않고 `openai-connectivity`에서 가짜 입력 한 건으로 연결과 합성 Claude 인증 실패 뒤 폴백만 확인한다.

## 실행

```powershell
pnpm tsx scripts/_oneoff/ai-provider-smoke.mts --mode=internal --input=scripts/_oneoff/pseudonymized-ai-input.json --out=tmp/ai-provider-compare.json
```

`--mode=claude-cli` 또는 `--mode=codex-cli`로 한쪽만 실행할 수 있다. API 연결 확인은 원장 승인 범위에서 `pnpm tsx scripts/_oneoff/ai-provider-smoke.mts --mode=openai-connectivity`로 따로 실행한다. `--input`을 생략하면 가짜 이름만 든 내장 6개 사례를 쓴다.

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
        "storedProgress": "수학: 일차방정식 2단원",
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
  "analyses": []
}
```

멘트 입력에 필요한 칸은 `studentName`, `subject`, `progress`, `dailyTest`, `checkTest`, `attitude`, `homework`, `homeworkToday`, `textbook`, `specialNote`이며 운영 자동작성의 `ReportCommentInput`과 같은 모양이다. 선택 칸은 `classContext`, `classNotice`, `videoHomework`, `videoHomeworkDue`, `understanding`, `lessonMemo`다. 저장 보고서의 진도 칸처럼 과목 라벨이 붙은 값을 비교하려면 `storedProgress`에 넣는다. 실행기가 운영 입력처럼 `subject`와 `progress`를 분리해 조립하므로 저장 결과를 그대로 프롬프트 재료로 잘못 쓰는 #145 차이를 피한다.

분석 사례는 `id`, `feature`, `kind`, `tier`, `claudeEffort`, `prompt`, `sourceFacts`, `expectedFields`가 필요하다. 등록상담은 가명 전사·폼 칸(`학생 가명`, 학년, 학교 가명, 학부모 가명, 전화번호는 삭제 또는 `입력됨`)을, 회의는 가명 전사·메모·제목·일자를, 계약서는 주민번호를 제거한 가짜 본문을 넣는다. 실제 학생 이름·전화번호·주민번호는 파일에 넣지 않는다.

표에는 기능, 경로, 실행 차수, 통과 여부, 실제/요청 모델, 추론 강도, 시간, 입력·출력 토큰이 나온다. 결과 JSON에는 종결형 섞임, 입력 숫자 보존·없는 숫자, 단원/퍼센트, 과목명 접두, 금지 표현, 길이, 고유명사 의심, 두 실행의 문장 수·종결형·길이 차이와 분석 칸 채움률, `warnings` 누락, normalize 통과, 잡담 혼입이 함께 저장된다. 계약서 사례는 Codex 호출을 하지 않고 `거절(Claude 전용)`으로 남아야 정상이다.
