# DeskTwin

**Your desk, understood.** 사진과 대화로 구성하는 나만의 작업 공간.

DeskTwin은 책상을 넓게 보여주는 **실제 3D voxel 작업실**과, 기기·연결 관계를 함께 수정하는 workspace companion입니다. 그림을 배경으로 붙인 UI가 아닙니다. Three.js 장면에서 기기와 가구·소품을 선택하고, 위치·회전·크기·색을 편집하며 연결을 기록할 수 있습니다.

> 아래 화면은 처음 열었을 때의 예시 책상입니다. 기기 8개와 연결 7개는 예시이며 실제 감지 결과가 아닙니다. 오른쪽 패널의 **Start my own desk**를 누르면 예시 기기를 비우고 설정 안내가 열립니다. [초기 구현 검증 기록](docs/VALIDATION.md)과 [PR #4 검토 후 수정·검증 기록](docs/PR4_REVIEW_FIXES.md)을 참고하세요.

![처음 열었을 때의 예시 책상과 Start my own desk 안내](docs/screenshots/first-visit-desktop.png)

> **현재 단계: local-first MVP.** 기본 실행은 외부 API를 호출하지 않는 규칙 기반 데모입니다. **Setup guide**에서 사진·수동 기록·동의한 Mac 관측을 비교하고, 연결 확인과 모니터 점검까지 이어갈 수 있습니다. 2026-11-01에 별도 승인한 Meta 대화 1건과 사진 분석 2건이 응답 검증을 통과했습니다. 당시 사진 흐름은 기본 35초 제한에서 시간 초과가 났고, 테스트에서만 제한을 늘려 받은 결과에도 배치 문제가 남아 적용은 차단됐습니다. 이후 저장된 19개 응답의 수치 재현은 [공동 기하 보정과 사진 피팅](docs/PHOTO_REFERENCE_FITTING.md)으로 독립 적용 검사를 통과했습니다. 새 실사진 품질과 물리적 하드웨어 재검사는 별도입니다. Bluetooth 실시간 감지는 지원하지 않으며, 수동 Bluetooth 연결 기록은 유지합니다. [사진 검토 개선과 검증 범위](docs/PHOTO_REVIEW.md), [이전 워크플로 검증](docs/PRE_META_WORKFLOW.md)을 참고하세요.

## 빠르게 실행하기

Node.js 22.12 이상이 필요합니다. 최신 사진 공동 보정 검증은 Node.js 26.0.0과 Chromium에서 실행했으며, 초기 검증 기록은 Node.js 22.22.3 환경입니다. 의존성 버전은 `package-lock.json`에 고정되어 있습니다.

```bash
git clone https://github.com/junjunjunbong/DeskTwin.git
cd DeskTwin
npm ci
npm run dev
```

브라우저에서 **http://127.0.0.1:5173**을 엽니다. API 서버는 `127.0.0.1:4318`에서 실행합니다. 두 서버 모두 기본적으로 로컬 컴퓨터에서만 접근할 수 있습니다.

`npm run dev`의 UI에서 보내는 `/api` 요청은 개발 서버의 로컬 proxy를 거칩니다. Proxy는 브라우저가 사용한 Host와 Origin을 유지하여 대화·사진·하드웨어 요청을 같은 UI 주소에서 처리하고, API의 요청 출처 검증을 유지합니다.

다른 작업에서 이 포트를 사용 중이면 별도 포트로 실행할 수 있습니다. `DESKTWIN_WEB_PORT`는 UI 서버, `PORT`는 API 서버와 UI의 API proxy를 지정합니다. 다음 예시는 API 키를 비운 로컬 데모입니다.

```bash
MODEL_API_KEY='' DESKTWIN_WEB_PORT=5187 PORT=4337 npm run dev
# http://127.0.0.1:5187
```

UI 포트가 이미 사용 중이면 실행이 실패합니다. 다른 포트로 자동 이동하거나 기존 서버를 재사용하지 않습니다.

저장소가 비공개인 동안에는 접근 권한과 GitHub 인증이 필요합니다. 라이선스 추가나 이 구현으로 저장소 공개 상태를 변경하지 않았습니다.

## View와 Edit

- **View**: 아무것도 선택하지 않으면 오른쪽 **Workspace overview**에 기기·기록된 연결·사용자 보고·Mac 감지 요약이 표시됩니다. 기기를 선택하면 같은 고정 패널에서 이름, 모델, 연결 상대, 양쪽 포트, 출처와 메모를 확인합니다.
- **Edit**: 장면에서 직접 드래그하고 오른쪽 패널에서 위치·회전·크기·색·부품을 수정합니다. 선택 label과 편집 팝업은 장면 위에 나타나지 않습니다. 삭제 확인은 해당 패널 안에서 처리합니다.
- 데스크톱에서는 장면과 상세 패널이 화면을 나눕니다. 모바일에서는 아래 상세 패널을 접어 드래그 공간을 늘릴 수 있습니다. View/Edit 전환은 저장된 장면을 바꾸지 않으며, 선택한 편집기의 입력 초안도 유지합니다.
- **Show connections**는 두 모드에서 독립적으로 켜고 끕니다. 선택한 기기의 연결 상대와 선이 강조되고, 편집 중 선의 끝점도 기기를 따라 움직입니다.

기기의 이름·모델·사용자 보고 상태·메모 초안은 **현재 열린 앱의 메모리**에 기기별로 보관됩니다. **My desk**, 다른 기기, 패널 닫기·열기, 사진·히스토리 등으로 이동해도 유지되며, **Unsaved device details**에서 다시 열어 **Save device details** 또는 **Discard draft**를 선택합니다. View에는 저장된 기록을 표시하므로 미저장 정상 작동 보고가 실제 보고처럼 나타나지 않습니다. 초안은 JSON 내보내기나 모델 전송 구성에 포함되지 않으며, 브라우저 새로고침이나 탭 닫기 이후에는 복원되지 않습니다.

최신 저장본 불러오기·가져오기·초기화 또는 저장된 이름·모델·보고·메모 변경 후에는 초안을 유지하면서 검토를 요구합니다. **Keep my edited fields after review**는 최신 값과 비교한 뒤 편집을 계속하는 선택이며, 실제 적용에는 다시 **Save device details**가 필요합니다. 삭제된 기기의 초안은 참조하거나 명시적으로 폐기할 수 있습니다. 자세한 경계와 저장 충돌 처리는 [Storage](docs/STORAGE.md)에 설명했습니다.

연결의 추가·제거는 **Edit**에서 수행합니다. View의 **Edit connections**는 모드만 전환하며, 연결 제거는 오른쪽 패널의 **Confirm removal / Cancel removal**로 확인합니다. Assistant의 연결 제안도 **Edit to review connection** 이후 별도의 **Confirm and apply**가 필요합니다.

같은 두 기기의 기존 연결을 바꾸려면 현재 기록을 검토하고 **Confirm replacement**로 확인해야 합니다. 검토 후 다른 작업이 기록을 변경했다면 다시 검토합니다. 상태와 메모는 하나의 보고로 함께 저장하므로, 이전 편집 초안과 새 진단 결과가 서로 섞이지 않습니다.

## 사진에서 문제 확인까지

1. 처음 열면 오른쪽 패널의 **Start my own desk**로 예시 기기를 비웁니다. 이어서 열리는 **Set up your desk**에서 **Use a desk photo** 또는 **Add a device**로 시작합니다. 사진은 별도 전송 동의가 필요하고, 분석 뒤 **Choose what to add**에서 넣을 물건을 고른 다음 3D로 검토하고 승인합니다. 예시를 지운 뒤에는 왼쪽 **Setup guide**나 오른쪽 **Open setup guide**로 다시 열 수 있습니다.
2. **Devices**에서 사진 추정·사용자 보고·샘플을 구분합니다. 필요한 경우 **Compare with this Mac**에서 로컬 감지에 동의하고 기존 기기와 관측을 직접 매칭합니다.
3. **Connections**에서 누락된 연결 질문에 답하고, 실제 확인한 기기·케이블·포트를 저장합니다. 사진 설명은 메모로 이어지며 명시적인 두 기기 연결 보고만 제한적으로 제안합니다. 불분명한 케이블은 **Unknown**으로 남깁니다.
4. **Try a check**에서 모니터를 선택합니다. 기록된 경로를 확인한 뒤 직접 연결과 도크 경유에 맞는 점검을 진행합니다. 건너뛴 검사는 실패나 성공으로 처리하지 않습니다.
5. 각 답과 최근 30개 점검은 브라우저에 저장됩니다. 새로고침 후 이어갈 수 있고, 연결이 달라졌다면 이전 이력을 보존한 새 점검을 시작합니다. 작동 상태는 **Save result as user-reported**로 따로 확인해야 바뀝니다.
6. **Ask about this device**로 대화 대상을 지정하고 기록 경로를 장면에서 강조할 수 있습니다. 로컬 데모는 저장된 점검을 참고하며, Meta 활성화 후에는 공유 가능한 기기의 점검 요약만 전송합니다. OS 관측과 OS에서 만든 기기·점검은 로컬에 남습니다.

## 지금 사용할 수 있는 기능

| 영역       | 구현 내용                                                                           |
| ---------- | ----------------------------------------------------------------------------------- |
| 작업실     | 실제 3D 장면, 회전·확대, 조명, View/Edit 분리, 오른쪽 고정 상세 패널 및 모바일 접기 |
| 장면 편집  | 기기·가구·소품의 충돌 방지, 표면 배치, 책상 연결·분리, 위치·회전·크기·색·부품 편집  |
| 연결 구성  | 독립적인 Show connections ON/OFF, Bluetooth 포함 기록, 연결 상대·포트·출처 확인     |
| Mac 인식   | 명시적 동의 후 display·USB 조회, 출처·시각·서비스 상태, 승인 후 기존/새 기기에 연결 |
| 대화       | 로컬 규칙 기반 예시, Meta structured-output 연결, 제안 확인·취소                    |
| 사진       | 별도 전송 동의, 찾은 물건 먼저 고르기, 저장되지 않는 3D 편집·검토, 전체 승인        |
| 문제 확인  | 모니터 점검 단계와 사용자 응답 기록. 원인을 자동 확정하지 않음                      |
| 저장       | 탭 간 저장 충돌 방지, v1/v2 호환 읽기, JSON 가져오기·내보내기, 20단계 Undo/Redo     |
| 인터페이스 | 키보드 접근 가능한 목록·폼, 모바일 레이아웃, WebGL 실패 안내                        |

사진 분석은 **보이는 물체의 종류·대략적 배치·색·크기**를 구조화된 데이터로 제안합니다. 별도 3D 미리보기에서 물체를 수정하고 **Confirm and apply scene**을 눌러야 저장됩니다. 취소하면 현재 구성은 그대로 남습니다. 적용 한 번은 Undo 한 단계입니다.

기존 코드 기반 voxel 도형을 재사용하며, 렌더링과 충돌 계산이 같은 부품 데이터를 사용합니다. 빠른 드래그도 이동 경로를 검사하고, 숫자로 지정한 회전·크기가 다른 물체와 충돌하면 이전 값을 유지합니다. **Place on surface**로 바닥·책상 위에 놓고, **Attach to desk**로 책상과 함께 이동·회전하도록 연결할 수 있습니다. 개별 이동과 **Detach from desk**도 가능합니다.

얇고 수평인 매트·러그도 실제 지지 표면으로 계산합니다. 기본 키보드·마우스·SSD·의자가 이동 중 매트 안으로 낮아지던 문제를 수정했습니다. 매트 경계를 지나는 이동은 상승·가로 이동·하강 경로를 각각 충돌 검사하고 한 번의 Undo로 저장합니다. 두꺼운/기울어진 매트와 실제 장애물은 계속 충돌하며, 기존 예시 좌표나 사용자 배치를 자동으로 바꾸지 않습니다.

바닥이나 책상 또는 매트에 놓인 물체의 크기를 바꿀 때는 기존 접촉 높이를 유지합니다. 물체 원점과 실제 하단이 달라도 크기 변경만으로 책상을 뚫거나 공중으로 들리지 않도록 보정합니다. 사용자가 높이를 직접 지정한 경우에는 그 입력을 그대로 검사합니다.

**Customize template shape**로 모든 기기·가구 템플릿을 편집 가능한 box 부품으로 바꿀 수 있습니다. 부품의 위치·크기·3축 회전·색을 수정하고 추가·복제·삭제합니다. 사용자는 최대 128개 부품을 저장할 수 있으며, 사진 모델은 최대 32개의 부품으로 형태를 제안할 수 있습니다. 지원하지 않는 물체도 Generic object로 근사합니다. AI 코드는 실행하지 않습니다.

사진의 **Device record**에서 기존 기기 매칭을 확인하거나 별도의 새 기기로 바꿀 수 있습니다. 이전 사진 ID와 고유한 이름을 재사용해 반복 분석의 중복을 줄입니다. 같은 종류의 기존 기기가 있지만 매칭을 결정할 수 없으면 **기존 기기 또는 별도의 새 기기를 명시적으로 선택하기 전에는 적용할 수 없습니다.** 기존 예시 기기에 사용자가 기록한 연결이 있어도 해당 기기와 연결을 보존합니다. 기존 이름·모델·작동 상태도 유지하고 새 기기의 상태는 `unknown`으로 둡니다.

두 탭의 변경이 충돌하면 오래된 탭은 최신 저장을 덮어쓰지 않고 자신의 화면을 유지합니다. 필요한 경우 그 탭의 구성을 내보낸 뒤 **Load latest saved workspace**로 최신 구성을 불러옵니다. 안전한 저장은 Web Locks를 지원하는 HTTPS 또는 localhost 브라우저 환경을 사용합니다. Workspace·장면 물체 이름과 숫자 편집은 Enter 또는 포커스 이동 때 저장되며, 기기의 이름·모델·사용자 보고·메모는 **Save device details**로 저장합니다.

저장 형식은 별도 wrapper가 없는 Workspace v2 JSON이며, 기존 `desktwin.workspace.v1` 저장 키를 유지합니다. 승인된 OS 매칭은 선택적 `hardwareBinding`으로 로컬 저장합니다. JSON 내보내기·가져오기는 설치별 매칭을 제거하므로 다시 매칭해야 합니다. 승인한 기기 이름·모델과 `hardwareOrigin` 출처는 내보내기에 유지됩니다. v1/v2 저장본과 JSON을 읽을 수 있고, 읽기나 마이그레이션만으로 원본을 다시 저장하지 않습니다. Web Locks를 지원하지 않는 환경에서는 편집 저장을 막고 JSON 내보내기를 제공합니다.

바닥·벽·창문과 조명 구조는 고정된 예시 room shell입니다. 중력·균형·정밀한 실측을 계산하는 물리 시뮬레이션은 아닙니다. [장면 편집 범위와 데이터 형식](docs/SCENE_EDITOR.md), [저장 충돌 처리](docs/STORAGE.md)를 참고하세요.

## Mac에서 실제 하드웨어 감지 실행

macOS 12 이상, Node.js 22.12 이상, Xcode Command Line Tools가 필요합니다. 이 PR의 기능을 시연하려면 기존 작업을 건드리지 않는 별도 폴더에서 브랜치를 받으세요. 저장소 접근 권한과 GitHub 인증이 필요합니다.

```bash
git clone --branch feat/hackathon-macos-inspector-20261029 \
  https://github.com/junjunjunbong/DeskTwin.git DeskTwin-hackathon
cd DeskTwin-hackathon
npm ci
# Command Line Tools가 없을 때 사용자가 직접 실행:
xcode-select --install
npm run hardware:build
MODEL_API_KEY='' npm run dev
```

**http://127.0.0.1:5173**에서 **Open Mac hardware**를 엽니다. 로컬에서 읽을 정보 안내와 **I agree to read this Mac’s hardware metadata locally.**를 확인하고 **Start detection**을 누릅니다. 페이지를 열거나 helper를 빌드한 것만으로는 기기를 읽지 않습니다. **Stop detection**으로 중지합니다. Meta key를 비운 실행은 하드웨어 시연 중 유료 API 호출을 방지합니다.

| 종류                 | 로컬 OS 정보                                                                                  | 확인하지 못하는 정보                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Displays             | CoreGraphics/AppKit의 온라인 display, 가능한 이름·픽셀 크기·내장/미러링/절전/그리기 활성 flag | 화면이 실제로 정상인지, HDMI 케이블 경로, monitor의 물리적 Dock 연결                                       |
| USB devices and hubs | IOKit에 등록된 USB 이름·제품/제조사 정보와 OS USB 상위 기기                                   | 전송·충전·영상 기능의 정상 여부, OS에 없는 물리적 포트·케이블 정보, USB entry가 없는 Thunderbolt-only 기기 |
| Bluetooth            | 수동으로 기록한 연결은 계속 표시                                                              | 실시간 pairing·연결·배터리 상태: **Unavailable**, 감지하지 않음                                            |

활성화한 탭은 약 5초마다 갱신합니다. 감지 상태, 각 정보의 출처, 마지막 성공 시각을 표시합니다. **Detection stopped**와 **Status unavailable**은 물리적 연결 해제를 뜻하지 않습니다. 같은 설치에서 승인한 안정적 identity가 성공한 category 조회에 없을 때만 **Not detected**입니다. 식별이 불안정한 기기는 재연결 또는 새 세션에서 **Match again**으로 다시 선택해야 합니다. 같은 식별 정보가 여러 기기에서 관측되면 기존 매칭도 **Match again**이 됩니다. 이후 하나만 남아도 이전 기기라고 자동 판단하지 않습니다. 로컬에 저장된 최소 충돌 기록으로 일반적인 bridge 재시작 후에도 이 판단을 유지하며, 기록을 안전하게 읽거나 쓸 수 없으면 **Status unavailable**로 표시합니다. 저장 실패와 프로세스 종료가 겹치는 경우의 한계는 [Mac 감지 문서](docs/MACOS_HARDWARE.md#local-collision-trust-history)에 명시했습니다.

감지된 항목을 선택하고 **Desk device match**에서 기존 기기 또는 별도의 새 기기를 고릅니다. **Review match → Confirm and save match**를 거쳐야 저장됩니다. 비슷한 이름으로 자동 병합하지 않습니다. 기존 기기의 이름·배치·연결·사용자 상태는 보존합니다. 새 기기는 사용자가 고른 template과 빈 위치로 추가하며 작동 상태는 `unknown`입니다. 감지가 3D 배치나 케이블 연결을 측정하는 것은 아닙니다.

감지 결과는 기본적으로 로컬에서만 사용합니다. 일련번호는 필요한 안정적 매칭에만 사용하고 native process 안에서 설치별 HMAC으로 바꿉니다. 원문 일련번호와 live snapshot은 로그·JSON 내보내기에 넣지 않습니다. OS에서 생성한 기기와 관련 연결은 이름 수정·매칭 해제 후에도 Meta 자동 전송 구성에서 제외합니다. 매칭한 기존 수동 기기는 수동 정보만 기존 동의 범위로 사용할 수 있습니다.

**수정한 브랜치의 실제 Mac 검증은 아직 필요합니다.** [정확한 감지 범위, 실행 방법과 Mac 수동 확인 절차](docs/MACOS_HARDWARE.md)에 따라 display/USB 연결·분리, 동일 이름 기기, bridge 중단, 매칭 및 권한 오류를 확인하세요. Linux의 mock 테스트 통과는 native API 성공의 증거가 아닙니다.

## 연결 정보는 어떻게 믿나요?

상단 **Show connections**는 **View**와 **Edit** 모두에서 켜고 끌 수 있습니다. ON은 Bluetooth를 포함한 모든 기록된 관계를 표시합니다. OFF는 선만 숨기며 연결 기록과 Undo 기록을 변경하지 않습니다.

기기를 선택하면 연결된 상대 기기와 관련 선을 강조합니다. 나머지 선도 계속 표시합니다. 책상이나 소품을 선택해도 모든 기기 연결선이 남습니다. 상세 패널에서는 상대 기기 이름, 연결 방식, 양쪽에 입력한 포트, 정보 출처와 메모를 확인하고 상대 기기를 선택할 수 있습니다. 선을 켠 채 드래그하면 선의 끝점도 기기를 따라 움직입니다.

이 선은 **저장된 관계를 읽기 쉽게 표시한 것**입니다. 실제 포트의 물리 위치, 케이블 경로, 전기적 연결, 협상된 기능이나 작동 상태를 확인한 표시가 아닙니다. 표시 토글은 화면 상태이며 저장본이나 내보낸 JSON에 추가하지 않습니다.

`source`와 `status`는 서로 다른 필드입니다. v2의 `visual.source`는 위치·크기·색의 출처를 별도로 기록합니다. 시각적 속성을 수정해도 기기 작동 상태는 바뀌지 않습니다.

| 출처             | 의미                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `demo`           | 체험을 위한 예시. 실제 사용자 기기라는 뜻이 아님                                          |
| `user-reported`  | 사용자가 직접 입력하거나 확인한 구성                                                      |
| `photo-inferred` | 사진의 시각적 특징에서 추정한 기기                                                        |
| `os-detected`    | 사용자가 승인해 추가한 OS 관측 기반 기기 기록. 현재 존재 여부나 정상 작동을 보장하지 않음 |

실시간 OS 관측은 위의 저장된 출처 및 사용자 보고와 별도로 표시합니다. `OS detected`와 `User reports an issue`가 동시에 표시될 수 있습니다. OS USB 계층은 출처를 붙여 보여주며, 사용자가 기록한 케이블 graph에 자동 추가하지 않습니다.

작동 상태는 `unknown`, `reported-working`, `reported-issue`로 구분합니다. **케이블을 연결했다고 알려주는 것만으로 상태가 정상으로 바뀌지 않습니다.** 모델 제안도 사용자가 확인하기 전까지 상태에 반영하지 않습니다.

처음 표시되는 8개 기기와 7개 연결은 모두 예시입니다. 오른쪽 패널의 **Start my own desk**로 예시만 제거하고 자신의 기기를 추가할 수 있습니다.

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

- 대화 전송: 현재 메시지, Meta 모드에서 작성한 최근 대화 최대 12개, 전송 가능한 기기·연결 구성. Local demo 대화는 자동 전송하지 않습니다.
- 사진 전송: 사진 패널에서 별도 동의하고 분석 버튼을 누른 경우에만 축소된 사진, 전송 가능한 기기·연결·장면 구성, 입력한 설명을 전송합니다. 설명은 시각적 제안의 문맥이며 연결을 자동 저장하지 않습니다.
- OS live snapshot·매칭 identity·OS에서 생성한 기기와 관련 연결·저장 history는 모델 구성에서 제외합니다. 사용자가 직접 메시지나 사진 설명에 쓴 내용은 해당 전송 동의의 대상입니다.
- 모델 제안은 strict JSON schema와 존재하는 기기 ID를 검증한 후 표시합니다. 사진 응답에는 시각적 속성만 허용하며 연결·status·실행 코드 필드는 거부합니다.
- 오류가 나면 실제 오류를 표시합니다. 실패한 live 응답을 성공한 AI 데모로 가장하지 않습니다.
- 실제 API 호출은 비용이 발생할 수 있습니다. 로컬 20 requests/minute 제한은 과금 상한이 아닙니다.

코드는 공식 Meta API 호스트만 허용합니다. 다른 provider, 로컬 open-weight 서버, BYOK 웹 서비스는 이번 MVP 범위가 아닙니다.

## 사진에서 편집 가능한 장면 만들기

1. **Desk photo**에서 JPEG, PNG, WebP 또는 HEIC/HEIF 사진을 선택합니다. 방향 보정·축소·HEIC 변환은 로컬에서 수행하며 선택만으로는 전송하지 않습니다.
2. 알고 있는 기기나 연결 설명을 입력하고 별도 Meta 전송 동의를 확인합니다.
3. **Create scene preview with Meta**를 누릅니다. 서버 key가 설정된 경우 실제 API 비용이 발생할 수 있습니다.
4. 응답이 오면 **Choose what to add**에서 넣을 물건을 고릅니다. 모두 체크된 상태로 시작하며, 뺀 물건은 다음 단계에서도 다시 넣을 수 있습니다. 아래 화면은 테스트용 가짜 응답입니다.

   ![사진 분석 뒤 넣을 물건을 고르는 Choose what to add 화면 (테스트용 가짜 응답)](docs/screenshots/photo-object-picker.png)

   **Review your desk scene**의 물건 목록에서 포함·제외를 선택하고, 빠진 물건은 **Add missing object**로 추가합니다. 제외한 후보는 편집값을 유지한 채 복구할 수 있으며, 기존 저장 기기와 매칭된 후보를 제외해도 원래 기기 기록은 남습니다. 키보드와 손목 받침대, 모니터와 받침대, 노트북과 스탠드는 독립적으로 편집합니다. 원본 사진과 3D를 비교하고, 기기 매칭과 배치 문제를 해결한 뒤 적용합니다.

5. **Show original estimate**로 원본 추정을 비교하고, **Undo automatic adjustments**로 자동 보정을 되돌릴 수 있습니다. **Fit small gaps**는 사진 피팅 전에는 원래 추정 주변의 작은 이동을 탐색하고, 사진 피팅 후에는 현재 잠금을 반영해 사진 맞춤을 다시 실행합니다. 사용자 잠금값은 유지합니다. 직접 편집한 위치·회전·크기와 선택한 받침은 자동 잠금됩니다. 해결되지 않은 장면도 preview는 열리지만 적용은 차단됩니다.
6. **Confirm and apply scene**으로 한 번에 적용하거나 **Discard preview**로 취소합니다.
7. **Scene objects**에서 이후에도 가구·소품을 편집합니다. 기기는 **Edit**에서 배치·연결·부품을 수정합니다.
8. 변경은 브라우저에 저장됩니다. 설정의 **Export JSON**과 **Import JSON**으로 구성을 옮길 수 있습니다. 기존 v1 저장본과 JSON은 v2로 읽으며, 사진·대화·key는 JSON에 포함하지 않습니다.

같은 사진을 사용한 후속 실제 평가에서 물체 19개가 반환됐지만 받침·충돌 문제로 적용은 차단됐습니다. 성공한 후속 요청은 테스트 전용 90초 제한에서 38.887초가 걸렸으며 당시 제품의 서버 제한은 35초였습니다. 단일 사진 결과와 자동 기능 검증을 구분합니다. [실사진 평가와 재현 사례](docs/PHOTO_EVALUATION.md), [기능 검증 범위](docs/PHOTO_REVIEW.md), [GPT Pro 검토 프롬프트](docs/GPT_PRO_REVIEW_PROMPT.md)를 참고하세요.

이후 구현한 [제한된 사진 배치 보정](docs/PHOTO_PLACEMENT_REPAIR.md)은 위 세 재현 사례와 mock·로컬 fixture로 검증했습니다. 접촉·받침 판정, 수정값 보존, 작은 간격 보정과 취소 전파를 개선했지만 새로운 실사진 품질 향상이나 실제 API 지연 개선을 입증한 것은 아닙니다. 현재 사진 분석 제한은 서버 120초·브라우저 125초이며, preview 받침 관계는 영속 Workspace graph로 저장하지 않습니다.

[사진 기준 자동 피팅](docs/PHOTO_REFERENCE_FITTING.md)은 사진 속 물체 영역과 템플릿으로 비교 시점을 한 번 추정한 뒤, 받침·충돌을 공동 보정하고 같은 시점에서 사진 정렬을 개선합니다. 좌표·모서리·시야각 입력 단계는 없습니다. **Compare with your photo**에서 비교하고, **Match photo again**으로 로컬 재시도하거나 **Undo photo match**로 되돌립니다. 근거가 부족하면 기존 preview를 유지합니다. 전체 19개 수치 재현은 객체·크기·회전을 유지하면서 충돌 0쌍, 받침 문제 0건으로 독립 적용 검사를 통과합니다. 동일 시점의 이미지 근거 오차 개선과 실사진 유사도 검증은 구분하며, 이동 제한·잠금·되돌리기 검증과 남은 한계는 문서에 기록합니다.

선택 설정 `META_PHOTO_TWO_STAGE=true`이면 사진 분석이 물건 목록과 장면 배치의 두 단계로 나뉩니다. 기본값은 꺼짐이며, 이 화면 경로는 실제 Meta API로 검증하지 않았습니다. 자세한 내용은 [2단계 사진 분석](docs/PHOTO_TWO_STAGE.md)에 있습니다.

## 데모 순서

제출용 3분 촬영 순서와 영문 소개문은 [제출 마감 문서](docs/SUBMISSION.md)에 있습니다. 아래는 제품 안내용 순서입니다.

1. **View**에서 책상과 **Workspace overview**를 보여줍니다. 기본 기기·연결은 예시이며 사용자 보고와 OS 인식이 별도라는 점을 설명합니다.
2. **Show connections**를 켜고 Dock을 선택합니다. 오른쪽 고정 패널에서 상대 기기, 양쪽 포트, 출처와 메모를 확인합니다. Bluetooth 기록도 연결 목록에 남습니다.
3. **Edit**로 바꾸고 키보드·마우스·SSD 또는 의자를 직접 옮깁니다. 매트/러그 위 이동, 장애물에서 정지, 연결선 갱신, Undo/Redo를 보여줍니다. 부착한 물체가 있는 책상도 함께 이동시킵니다.
4. 실제 Mac에서 helper 빌드와 수동 확인을 완료했다면 **Open Mac hardware → Start detection**을 시연합니다. 실제 OS 출처·시각을 보여주고 새 기기 연결/분리로 목록 갱신을 확인합니다. Linux나 helper 미설치 환경에서는 Unavailable을 그대로 보여줍니다.
5. 관측 하나를 선택하고 기존 기기 또는 새 기기를 명시적으로 매칭합니다. 검토 전에는 저장되지 않고, 승인해도 사용자 작동 상태는 자동 변경되지 않음을 확인합니다.
6. **Stop detection**으로 중지합니다. 상태가 Detection stopped가 되며 연결 해제로 표시되지 않는지 확인합니다.
7. 문제가 보고된 모니터를 선택해 **Troubleshoot monitor step by step**을 엽니다. 각 답은 점검 이력에 저장됩니다. 작동 상태는 **Save result as user-reported**를 눌러야 별도로 저장됩니다.
8. 사진 흐름은 선택 → 별도 전송 동의 → **Choose what to add**에서 고르기 → 물건별 포함·제외·추가와 배치 검토 → **Confirm and apply scene** 순서입니다. 실제 Meta 분석은 별도 승인과 key가 있을 때만 실행합니다. 모의 응답 시연과 이전 실제 분석 결과를 구분해서 설명합니다.
9. **Open settings → Export JSON**으로 구성을 내보냅니다. 승인한 장면과 출처는 남고 설치별 하드웨어 매칭은 제외됩니다.

로컬 대화 데모에서 `I connected the right monitor to the dock with HDMI`를 입력하면 제한된 규칙 기반 제안이 나옵니다. View에서는 **Edit to review connection**으로 Edit에 들어간 뒤 **Confirm and apply**를 눌러야 사용자 보고 연결이 저장됩니다. 자유로운 대화와 실제 사진 분석은 Meta 연결이 필요합니다.

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

Meta 요청은 테스트에서 mock으로 대체합니다. `test:e2e`와 `test:production`은 API 키를 비운 자체 서버를 실행하며, 기존 개발 서버를 재사용하지 않습니다. E2E의 기본 UI/API 포트는 5173/4318입니다. 이미 사용 중이면 다음처럼 테스트 전용 포트를 지정합니다.

```bash
DESKTWIN_TEST_PORT=5187 DESKTWIN_TEST_API_PORT=4337 npm run test:e2e
```

`DESKTWIN_TEST_PORT`와 `DESKTWIN_TEST_API_PORT`는 Playwright가 시작할 UI/API 서버에 전달됩니다. 기존 서버를 종료하거나 설정을 바꿀 필요가 없습니다. 테스트는 실제 Meta API 크레딧을 사용하지 않습니다. 초기 구현 검사는 [기존 검증 기록](docs/VALIDATION.md)에 남겨 두며, 이번 검토 후 수정·재현·후속 검증은 [PR #4 검토 수정 기록](docs/PR4_REVIEW_FIXES.md)에 구분해서 기록합니다.

- [Mac 하드웨어 감지와 실제 Mac 수동 확인](docs/MACOS_HARDWARE.md)
- [기본 장면 드래그·비동기 저장 회귀 조사](docs/BASELINE_REGRESSIONS.md)
- [장면 배치·형태 편집과 남은 제약](docs/SCENE_EDITOR.md)
- [탭 간 저장 충돌과 입력 처리](docs/STORAGE.md)
- [구조와 구현 범위](docs/ARCHITECTURE.md)
- [개인정보와 보안 경계](docs/PRIVACY.md)
- [PR #4 검토 후 수정과 후속 검증](docs/PR4_REVIEW_FIXES.md)
- [초기 구현 검증 기록과 당시 남은 확인](docs/VALIDATION.md)
- [기여 방법](CONTRIBUTING.md)
- [원래 프로젝트 brief](docs/PROJECT.md)
- [해커톤 제출 체크리스트](docs/HACKATHON.md)
- [3분 촬영 원고와 제출 문장](docs/SUBMISSION.md)

## 라이선스와 에셋

새 구현 코드는 [MIT](LICENSE) 라이선스입니다. 장면의 geometry와 pixel texture는 이 저장소 코드로 생성합니다. 제3자 3D 모델이나 사용자 사진을 기본 에셋으로 배포하지 않습니다. 아이콘은 `@phosphor-icons/react`, 글꼴은 시스템 글꼴을 사용합니다. 로컬 HEIC 변환용 `libheif-js`는 LGPL-3.0이며 [별도 고지와 소스 링크](public/THIRD_PARTY_NOTICES.txt), 라이선스 전문을 포함합니다. 각 의존성과 Meta API에는 각각의 라이선스·서비스 조건이 적용됩니다.

## API 참고 자료

- [Meta Chat Completions quickstart](https://dev.meta.ai/docs/cookbook/quickstart-chat-completions)
- [Meta structured output](https://dev.meta.ai/docs/structured-output)
- [Meta image understanding](https://dev.meta.ai/docs/image-understanding)
