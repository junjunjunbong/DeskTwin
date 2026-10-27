# DeskTwin

**Your desk, understood.** 사진과 대화로 구성하는 나만의 작업 공간.

DeskTwin은 책상을 넓게 보여주는 **실제 3D voxel 작업실**과, 기기·연결 관계를 함께 수정하는 workspace companion입니다. 그림을 배경으로 붙인 UI가 아닙니다. Three.js 장면에서 기기를 선택하고, 배치를 옮기고, 연결을 기록할 수 있습니다.

![DeskTwin의 실제 실행 화면](docs/screenshots/hero-desktop.png)

> **현재 단계: local-first MVP.** 기본 실행은 외부 API를 호출하지 않는 규칙 기반 데모입니다. Meta API 연결 코드는 구현되어 있지만, 실제 키를 이용한 live 호출 및 모델 정확도 평가는 아직 완료하지 않았습니다. OS 하드웨어 감지는 구현하지 않았습니다.

## 빠르게 실행하기

Node.js 22.12 이상이 필요합니다. 개발 및 검증 환경은 Node.js 26과 Chromium입니다. 의존성 버전은 `package-lock.json`에 고정되어 있습니다.

```bash
git clone https://github.com/junjunjunbong/DeskTwin.git
cd DeskTwin
npm ci
npm run dev
```

브라우저에서 **http://127.0.0.1:5173**을 엽니다. API 서버는 `127.0.0.1:4318`에서 실행합니다. 두 서버 모두 기본적으로 로컬 컴퓨터에서만 접근할 수 있습니다.

저장소가 비공개인 동안에는 접근 권한과 GitHub 인증이 필요합니다. 라이선스 추가나 이 구현으로 저장소 공개 상태를 변경하지 않았습니다.

## 지금 사용할 수 있는 기능

| 영역       | 구현 내용                                                                       |
| ---------- | ------------------------------------------------------------------------------- |
| 작업실     | 실제 3D 장면, 회전·확대, 낮·오후·밤 조명, 선택 시 기기 라벨                     |
| 기기 편집  | 기기 등록·삭제·이름·모델 수정, 드래그 및 슬라이더 배치 편집                     |
| 연결 구성  | 기기 사이 연결·포트 기록, 선택한 기기의 연결 표시, 사용자 입력과 예시 구분      |
| 대화       | 로컬 규칙 기반 예시, Meta structured-output 연결, 제안 확인·취소                |
| 사진       | 로컬 미리보기·축소·메타데이터 제거, 동의 후 Meta 분석, 기기 후보 개별 확인      |
| 문제 확인  | 모니터 점검 단계와 사용자 응답 기록. 원인을 자동 확정하지 않음                  |
| 저장       | 브라우저 localStorage, JSON 가져오기·내보내기, 최대 20단계 실행 취소, 변경 기록 |
| 인터페이스 | 키보드 접근 가능한 목록·폼, 모바일 레이아웃, WebGL 실패 안내                    |

사진 분석은 **보이는 기기와 편집 가능한 대략적 위치**를 제안합니다. 실내 전체의 정확한 3D 복원, 사진 속 모든 소품의 자동 모델링, 숨겨진 케이블 추적 기능은 아닙니다. 기본 방과 소품은 코드로 만든 예시 장면입니다.

## 연결 정보는 어떻게 믿나요?

`source`와 `status`는 서로 다른 필드입니다.

| 출처             | 의미                                             |
| ---------------- | ------------------------------------------------ |
| `demo`           | 체험을 위한 예시. 실제 사용자 기기라는 뜻이 아님 |
| `user-reported`  | 사용자가 직접 입력하거나 확인한 구성             |
| `photo-inferred` | 사진의 시각적 특징에서 추정한 기기               |

작동 상태는 `unknown`, `reported-working`, `reported-issue`로 구분합니다. **케이블을 연결했다고 알려주는 것만으로 상태가 정상으로 바뀌지 않습니다.** 모델 제안도 사용자가 확인하기 전까지 상태에 반영하지 않습니다.

처음 표시되는 8개 기기와 7개 연결은 모두 예시입니다. 사진 패널의 **Remove sample devices and start my setup**으로 예시만 제거하고 자신의 기기를 추가할 수 있습니다.

## Meta 연결

공식 Meta API 문서에서 확인한 기본값은 `https://api.meta.ai/v1`과 `muse-spark-1.3`입니다. 실제 계정에서 사용 가능한 모델과 API 조건은 설정할 때 다시 확인하세요.

```bash
cp .env.example .env
```

`.env`를 로컬에서 편집합니다. 키를 GitHub, 채팅, 스크린샷에 넣지 마세요.

```dotenv
MODEL_API_KEY=your_key_here
META_BASE_URL=https://api.meta.ai/v1
META_MODEL=muse-spark-1.3
PORT=4318
```

API 서버를 재시작한 뒤 화면 아래 **Connect Meta API**를 엽니다. 전송 내용을 확인하고 활성화해야 다음 대화부터 실제 모델을 호출합니다. 키가 설정되어 있다는 사실은 API 호출 성공을 검증한 것과 다릅니다.

- 대화 전송: 현재 메시지, 최근 대화 최대 12개, 기기·연결 구성.
- 사진 전송: 사진 패널에서 별도 동의하고 분석 버튼을 누른 경우에만 축소된 사진과 기기 구성 전송.
- 모델 제안은 JSON schema와 존재하는 기기 ID를 검증한 후 표시합니다. 사진 응답에는 기기 추가 제안만 허용합니다.
- 오류가 나면 실제 오류를 표시합니다. 실패한 live 응답을 성공한 AI 데모로 가장하지 않습니다.
- 실제 API 호출은 비용이 발생할 수 있습니다. 로컬 20 requests/minute 제한은 과금 상한이 아닙니다.

코드는 공식 Meta API 호스트만 허용합니다. 다른 provider, 로컬 open-weight 서버, BYOK 웹 서비스는 이번 MVP 범위가 아닙니다.

## 데모 순서

1. 기본 화면에서 회전·확대로 책상을 살펴봅니다.
2. **Device list**에서 Dock을 선택하고 상세 정보를 확인합니다.
3. **Edit placement**에서 기기를 드래그하거나 좌우·앞뒤·회전 값을 조절합니다.
4. 대화창에 `I connected the right monitor to the dock with HDMI`를 입력합니다.
5. **Confirm and apply**를 눌러야 연결이 `user-reported`로 바뀝니다.
6. 오른쪽 모니터를 선택하고 **Troubleshoot monitor step by step**을 시작합니다.
7. 직접 테스트한 결과를 답하고, 필요하면 사용자 보고로 저장합니다.
8. 설정에서 구성을 JSON으로 내보냅니다.

로컬 데모는 위와 같은 제한된 표현만 처리합니다. 자유로운 대화와 실제 사진 분석은 Meta 연결을 사용합니다.

## Production 실행

```bash
npm run build
npm start
```

**http://127.0.0.1:4318**에서 빌드된 UI와 API를 함께 제공합니다. `npm start`는 현재 개발 도구인 `tsx`를 사용하므로 `npm ci --omit=dev`가 아니라 `npm ci`로 설치해야 합니다.

이 서버는 개인 컴퓨터에서 쓰는 MVP입니다. 다중 사용자 인증, 인터넷 공개 호스팅, 계정별 API 키, 지속적 클라우드 저장은 구현하지 않았습니다. 그대로 공용 인터넷에 노출하지 마세요.

## 개발과 검증

```bash
npm run check                 # TypeScript + unit/API tests + production build
npx playwright install chromium
npm run test:e2e              # 실제 Chromium UI 테스트
npm run test:production       # 별도 포트의 production 서버 + 브라우저 테스트
npm run format:check
```

Meta 요청은 테스트에서 mock으로 대체합니다. 테스트는 실제 API 크레딧을 사용하지 않습니다. `test:production`은 API 키를 비운 별도 프로세스를 사용합니다.

- [구조와 구현 범위](docs/ARCHITECTURE.md)
- [개인정보와 보안 경계](docs/PRIVACY.md)
- [실제 검증 기록과 남은 확인](docs/VALIDATION.md)
- [기여 방법](CONTRIBUTING.md)
- [원래 프로젝트 brief](docs/PROJECT.md)
- [해커톤 제출 체크리스트](docs/HACKATHON.md)

## 라이선스와 에셋

새 구현 코드는 [MIT](LICENSE) 라이선스입니다. 장면의 geometry와 pixel texture는 이 저장소 코드로 생성합니다. 제3자 3D 모델이나 사용자 사진을 기본 에셋으로 배포하지 않습니다. 아이콘은 `@phosphor-icons/react`, 글꼴은 시스템 글꼴을 사용합니다. 각 의존성과 Meta API에는 각각의 라이선스·서비스 조건이 적용됩니다.

## API 참고 자료

- [Meta Chat Completions quickstart](https://dev.meta.ai/docs/cookbook/quickstart-chat-completions)
- [Meta structured output](https://dev.meta.ai/docs/structured-output)
- [Meta image understanding](https://dev.meta.ai/docs/image-understanding)
