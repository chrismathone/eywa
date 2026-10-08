# Windows 연동 앱 다운로드 게시 및 handoff

## 요청과 원인

사용자가 `학원 설정 → 연동 → 연동 PC`의 Windows 연동 앱 카드에 다운로드가 없음을 보고했다. `AgentCard → getAgentDashboard → sync_agent_releases`의 배선은 존재했지만 정식 릴리스 표가 비어 있었고, 설치기·업데이트 묶음이 로컬에만 있었다. 따라서 웹이 `설치 파일을 준비 중입니다`를 표시했다.

원격 저장소의 전역 파일 제한으로 첫 버킷 생성이 거부됐다. 사용자가 AYWA 프로젝트의 전역 제한을 올렸다고 확인한 후 게시를 진행했다. 기존 첨부파일 버킷의 제한·정책은 수정하지 않았다.

## 적용 결과

- **1.0.1 / sequence 2**의 기존 검증된 EXE·ZIP을 그대로 게시했다. 실행 파일을 다시 빌드하거나 같은 순번의 내용을 교체하지 않았다.
- Supabase 프로젝트 `ylqviwxedsdikuslmwxf`에 `sync-agent-releases` 공개 다운로드 버킷을 만들었다. 버킷 제한은 **629,145,600바이트(600MiB)**, MIME 허용은 `application/octet-stream`, `application/zip`, `application/json`이다. 기존 저장소 쓰기 정책은 다른 업무 버킷에만 한정되어 있어 이 버킷에 일반 사용자 업로드 권한을 추가하지 않았다.
- `2/` 경로에 EXE·ZIP·서명 선언 `release.json`·`checksums.json`을 올렸다. 인증 없는 HTTPS 다운로드에서 EXE·ZIP은 리다이렉트 없이 200이다.
- 실제 원격 EXE·ZIP의 **전체 크기와 SHA-256**을 대조한 후 Supabase CLI `db query`로 정식 릴리스 **1행**을 등록했다. SQL은 앱 프로젝트를 검증하는 기존 실행기를 사용했고, 표 잠금·동일 내용 재실행 허용·이미 사용한 순번 거부를 적용했다.
- 등록 시각은 **2026-10-09 04:27:08 KST**다. 최신 비철회 릴리스 조회에서 버전·순번·공개 설치기 URL·서명 선언을 확인했다. 웹 다운로드와 기존 앱의 `latest` API는 이 동일한 릴리스 표를 사용한다.
- 연결 기기 수와 전환된 지점 수는 게시 전후 **0 / 0**이다. 기기 등록·연결 코드 발급·지점 설정 변경·구 워커 종료·실제 PC 전환은 실행하지 않았다.

[Windows 설치기 다운로드](https://ylqviwxedsdikuslmwxf.supabase.co/storage/v1/object/public/sync-agent-releases/2/AywaSync-Setup-1.0.1.exe)

| 산출물 | 크기 | SHA-256 |
|---|---:|---|
| AywaSync-Setup-1.0.1.exe | 411,948,868바이트 | `d82bf06e7477b5a22999844d2ff3981826db003df783b5fe8a58352f99ede320` |
| AywaSync-1.0.1.zip | 569,572,324바이트 | `36386cb66a269f6e1caa9aec00c9ac7d3fdd038795b7ec6a9b653c67a54f7048` |

## 구현·검증

[`publish-release.cjs`](../../apps/sync-agent/publish-release.cjs)는 기본 실행 시 읽기 검증만 한다. 명시적인 `--apply`에서만 전용 버킷 생성과 게시를 수행한다. 서명·로컬 해시·프로젝트 주소를 먼저 검사하고 TUS 6MiB 청크로 전송한다. 업로드 응답 유실과 중단 후 재개를 지원한다. 다른 호스트로 인증 정보를 보내지 않고, 기존 공개 경로의 내용이 다르면 덮어쓰지 않는다. 릴리스 DB 등록은 별도 단계다. 저장소가 JSON을 길이 헤더 없이 전송하는 경우 실제 응답 내용을 해시 검사한다.

- `node --test test/*.test.cjs`: **31개 통과, 실패·건너뜀 0**. 기존 데스크톱 21개와 신규 게시 검사 10개다. 신규 검사는 읽기 계획·게시·동일 파일 재실행·저장소 크기 제한·변조 파일·다른 프로젝트 주소·타 호스트 인증 차단·응답 유실·재개·JSON 길이 헤더 누락을 포함한다.
- `node test/package-audit.cjs`: 기존 실행기 소스 **125개**, 패키지 **9,997개 파일**, EXE 해시 확인. Git의 CRLF 체크아웃과 패키지 LF 차이만 허용하도록 텍스트 대조를 보완했고 다른 문자 차이는 계속 거부한다.
- `node register-release.cjs --verify-remote`: 로컬 서명·EXE/ZIP 해시 및 공개 원격 EXE/ZIP의 전체 해시 일치. `remoteVerified:true`, 당시 `registered:false`였으며 이후 CLI로 등록했다.
- 공개 설치기 HEAD: **200**, `Content-Length: 411948868`, `Content-Type: application/octet-stream`.
- CLI 등록 후 최신 릴리스 조회: **version 1.0.1, sequence 2, revoked_at NULL**, 서명 payload 2,252,640바이트.
- `git diff --check`: 변경한 파일에 공백 오류 없음.

기기 인증이 필요한 `latest`를 확인하려고 운영 DB에 가짜 기기를 등록하지 않았다. 웹 소스의 조회 배선과 동일한 실제 DB 결과 및 공개 파일 다운로드를 검증했다. Orca CLI는 `Unable to locate Orca.exe next to "C:\Users\user\AppData\Local\Programs\orca\resources"`로 실행되지 않아 실제 브라우저의 버튼 클릭은 이번 검사에 포함하지 않았다.

## 다음 버전과 실제 PC 전환

다음 버전은 package 버전·sequence를 올리고 새 HTTPS 경로에서 서명·게시·원격 해시 검증·정식 등록을 수행한다. `work/sync-agent-publish/`에는 비공개 업로드 재개 상태만 보관하며 커밋하지 않는다. 서버 서비스 키와 서명 개인키는 게시물·저장소에 넣지 않는다.

실제 PC 설치와 기존 설정 가져오기·기존 워커 종료·계정/Drive 권한 확인은 [운영 안내](../../apps/sync-agent/README.md)를 따른다. 이번 다운로드 게시를 실제 외부 서비스 인수 시험이나 PC 교체 완료로 해석하지 않는다.
