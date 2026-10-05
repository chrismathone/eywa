# Claude v1 필수 수정의 Codex 반영 — v3

이 기록은 계획 변경만 다룬다. source-only 지적을 실제 앱에서 새로 재현한 결함으로 세지 않는다.

| Claude 지적 | v3의 반영 |
| --- | --- |
| P0-A 파서/구 스키마 안전 | 기본 파서는 선택 필드, with_progress 요청 소비처만 새 계산, 최상위 progress_contract:1, 기본 저장 문/이행/명단/마스터 불변과 혼합 배포 시험 |
| P0-B 상태 판정 | 순서표, unknown/finished 모순, no_show 정정과 인정 reverse 구분, imported done, 0분 인정, 별도 확인 플래그 |
| P0-C 목록과 같은 업무 의미 | SQL 도우미 공유, 기존 record_missing/review_pending와 대응 검사, 반전은 실시 기록부터 재개. 기존 케이스 SQL 불변 |
| P1-A 기존 예약 수/연결 권한 | reserved 미래/과거와 done 이력 분리. done 연결은 선택, wide+on capability. 일반 강사의 연결 버튼 제거 |
| P1-B 최신 결석/관측 | 후보와 같은 최신 유효 결석 도우미를 intake 저장에 적용. 수동 포함 원반/날짜 접수는 observe. source 원사건 잠금과 AFTER 관측 직렬화를 추가 제안하고 병행/교착/삭제 검증을 출시 조건으로 둠 |
| P1-C mapped 우선/역할/시간표 | active mapping을 먼저 대체. 미연결 같은 날 약속은2행. native 담당 반0개/앵커 없음도 본인/확인 대상으로 표시. legacy 이번 주와 native DB 오늘 범위 차이, 미투영 시간표 한계 명시 |
| P1-D 메모 | attendance 결석만 선택, 수동 사유 전부 필수. 서버 액션+UI 강제, DB 메모 정책 유지 |
| P1-E 이동/창/언어 | raw return URL 대신 출처+검증 인자, 기존 autoClose/withEmbed/EmbedLink/publishMutation. 미니셸 allowlist 확인, 한국어/English |
| P1-F 일정 계약 | 수학 기간/역할 범위, 지점 재조인, 실제/예정/인정 분, imported 포함 미지정 필터/보조 수, 기본 취소/변경 제외, 기간 밖 업무 목록, N:M 업무 담당·허용case, 일정만 실패 격리 |
| P1-G 적용/성능/되돌리기 | 진행 계산 요청 호출에만 추가, 역할별 측정. 번호/체인 갱신, private권한/schema reload, 현재 최종 함수 백업과 정확한 undo. 파일 단위 CLI+트랜잭션, 전체 db push 없음 |
| P1-H 수용 사례 | 제안한16개 사례를 v3의25개 기준 안에 포함. 추가로 mutation/유효 기본값/병행·시수·실제 앱 체인·모바일 검사 |

Codex 초기 설명도 두 가지 정정했다. legacy 예약 상태는 reserved/done 둘뿐이며 취소는 삭제다. 예약 반영은 같은 트랜잭션에서 이뤄지므로 projection_jobs를 예약 반영 지연의 증거로 사용하지 않는다. 해당 큐는 출결 효과다.

v3에는 Claude가 제안한 저장 시 검증과 관측 외에 동시 정정/접수의 원사건 잠금 설계를 추가했다. 이는 현재 구현에 이미 존재한다고 주장하지 않는 새 제안이며, 최종 Claude 검토 대상이다. 최종 승인 전에 남은 위험과 필요 수정은 별도 판정을 받는다.
