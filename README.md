# DeskTwin

**Your desk, understood.** 사진과 대화로 구성하는 나만의 작업 공간.

DeskTwin은 책상을 넓게 보여주는 **실제 3D voxel 작업실**과, 기기·연결 관계를 함께 수정하는 workspace companion입니다. 그림을 배경으로 붙인 UI가 아닙니다. Three.js 장면에서 기기와 가구·소품을 선택하고, 위치·회전·크기·색을 편집하며 연결을 기록할 수 있습니다.

> 아래 화면은 예시 책상과 새 오른쪽 고정 패널입니다. Mac 감지는 중지된 상태이며, 예시 기기는 실제 감지 결과가 아닙니다. [검증 범위](docs/VALIDATION.md)를 참고하세요.

![View 모드의 예시 책상과 오른쪽 고정 Workspace overview 패널](docs/screenshots/workspace-overview-desktop.png)

> **현재 단계: local-first MVP.** 기본 실행은 외부 API를 호출하지 않는 규칙 기반 데모입니다. Meta API 연결 코드는 구현되어 있지만, 실제 키를 이용한 live 호출 및 모델 정확도 평가는 아직 완료하지 않았습니다. macOS의 실제 CoreGraphics/AppKit·IOKit API를 읽는 로컬 감지 경로를 추가했습니다. **이 Linux 작업 환경에서는 Swift 빌드와 실제 Mac 연결·해제를 검증하지 못했습니다.** Bluetooth 실시간 감지는 지원하지 않으며, 수동 Bluetooth 연결 기록은 유지합니다.

## 빠르게 실행하기

Node.js 22.12 이상이 필요합니다. 이번 검증 환경은 Node.js 24.22.1과 Chromium입니다. 의존성 버전은 `package-lock.json`에 고정되어 있습니다.

```bash
git clone https://github.com/junjunjunbong/DeskTwin.git
cd DeskTwin
npm ci
npm run dev
```

브라우저에서 **http://127.0.0.1:5173**을 엽니다. API 서버는 `127.0.0.1:4318`에서 실행합니다. 두 서버 모두 기본적으로 로컬 컴퓨터에서만 접근할 수 있습니다.

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
- 데스크톱에서는 장면과 상세 패널이 화면을 나눕니다. 모바일에서는 아래 상세 패널을 접어 드래그 공간을 늘릴 수 있습니다. View/Edit 전환은 저장된 장면을 바꾸지 않으며, 선택한 항목의 입력 초안도 유지합니다.
- **Show connections**는 두 모드에서 독립적으로 켜고 끕니다. 선택한 기기의 연결 상대와 선이 강조되고, 편집 중 선의 끝점도 기기를 따라 움직입니다.

## 지금 사용할 수 있는 기능

| 영역       | 구현 내용                                                                             |
| ---------- | ------------------------------------------------------------------------------------- |
| 작업실     | 실제 3D 장면, 회전·확대, 조명, View/Edit 분리, 오른쪽 고정 상세 패널 및 모바일 접기   |
| 장면 편집  | 기기·가구·소품의 충돌 방지, 표면 배치, 책상 연결·분리, 위치·회전·크기·색·부품 편집    |
| 연결 구성  | 독립적인 Show connections ON/OFF, Bluetooth 포함 기록, 연결 상대·포트·출처 확인       |
| Mac 인식   | 명시적 동의 후 display·USB 조회, 출처·시각·서비스 상태, 승인 후 기존/새 기기에 연결   |
| 대화       | 로컬 규칙 기반 예시, Meta structured-output 연결, 제안 확인·취소                      |
| 사진       | 별도 전송 동의, 사용자 설명을 포함한 장면 제안, 저장되지 않는 3D 편집·검토, 전체 승인 |
| 문제 확인  | 모니터 점검 단계와 사용자 응답 기록. 원인을 자동 확정하지 않음                        |
| 저장       | 탭 간 저장 충돌 방지, v1/v2 호환 읽기, JSON 가져오기·내보내기, 20단계 Undo/Redo       |
| 인터페이스 | 키보드 접근 가능한 목록·폼, 모바일 레이아웃, WebGL 실패 안내                          |

사진 분석은 **보이는 물체의 종류·대략적 배치·색·크기**를 구조화된 데이터로 제안합니다. 별도 3D 미리보기에서 물체를 수정하고 **Confirm and apply scene**을 눌러야 저장됩니다. 취소하면 현재 구성은 그대로 남습니다. 적용 한 번은 Undo 한 단계입니다.

기존 코드 기반 voxel 도형을 재사용하며, 렌더링과 충돌 계산이 같은 부품 데이터를 사용합니다. 빠른 드래그도 이동 경로를 검사하고, 숫자로 지정한 회전·크기가 다른 물체와 충돌하면 이전 값을 유지합니다. **Place on surface**로 바닥·책상 위에 놓고, **Attach to desk**로 책상과 함께 이동·회전하도록 연결할 수 있습니다. 개별 이동과 **Detach from desk**도 가능합니다.

얇고 수평인 매트·러그도 실제 지지 표면으로 계산합니다. 기본 키보드·마우스·SSD·의자가 이동 중 매트 안으로 낮아지던 문제를 수정했습니다. 매트 경계를 지나는 이동은 상승·가로 이동·하강 경로를 각각 충돌 검사하고 한 번의 Undo로 저장합니다. 두꺼운/기울어진 매트와 실제 장애물은 계속 충돌하며, 기존 예시 좌표나 사용자 배치를 자동으로 바꾸지 않습니다.

바닥이나 책상 또는 매트에 놓인 물체의 크기를 바꿀 때는 기존 접촉 높이를 유지합니다. 물체 원점과 실제 하단이 달라도 크기 변경만으로 책상을 뚫거나 공중으로 들리지 않도록 보정합니다. 사용자가 높이를 직접 지정한 경우에는 그 입력을 그대로 검사합니다.

**Customize template shape**로 모든 기기·가구 템플릿을 편집 가능한 box 부품으로 바꿀 수 있습니다. 부품의 위치·크기·3축 회전·색을 수정하고 추가·복제·삭제합니다. 사용자는 최대 128개 부품을 저장할 수 있으며, 사진 모델은 최대 32개의 부품으로 형태를 제안할 수 있습니다. 지원하지 않는 물체도 Generic object로 근사합니다. AI 코드는 실행하지 않습니다.

사진의 **Device record**에서 기존 기기 매칭을 확인하거나 별도의 새 기기로 바꿀 수 있습니다. 이전 사진 ID와 고유한 이름을 재사용해 반복 분석의 중복을 줄입니다. 같은 종류의 기존 기기가 있지만 매칭을 결정할 수 없으면 **기존 기기 또는 별도의 새 기기를 명시적으로 선택하기 전에는 적용할 수 없습니다.** 기존 예시 기기에 사용자가 기록한 연결이 있어도 해당 기기와 연결을 보존합니다. 기존 이름·모델·작동 상태도 유지하고 새 기기의 상태는 `unknown`으로 둡니다.

두 탭의 변경이 충돌하면 오래된 탭은 최신 저장을 덮어쓰지 않고 자신의 화면을 유지합니다. 필요한 경우 그 탭의 구성을 내보낸 뒤 **Load latest saved workspace**로 최신 구성을 불러옵니다. 안전한 저장은 Web Locks를 지원하는 HTTPS 또는 localhost 브라우저 환경을 사용합니다. 이름과 숫자는 Enter 또는 포커스 이동 때 저장됩니다.

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

활성화한 탭은 약 5초마다 갱신합니다. 감지 상태, 각 정보의 출처, 마지막 성공 시각을 표시합니다. **Detection stopped**와 **Status unavailable**은 물리적 연결 해제를 뜻하지 않습니다. 같은 설치에서 승인한 안정적 identity가 성공한 category 조회에 없을 때만 **Not detected**입니다. 식별이 불안정한 기기는 재연결 또는 새 세션에서 **Match again**으로 다시 선택해야 합니다.

감지된 항목을 선택하고 **Desk device match**에서 기존 기기 또는 별도의 새 기기를 고릅니다. **Review match → Confirm and save match**를 거쳐야 저장됩니다. 비슷한 이름으로 자동 병합하지 않습니다. 기존 기기의 이름·배치·연결·사용자 상태는 보존합니다. 새 기기는 사용자가 고른 template과 빈 위치로 추가하며 작동 상태는 `unknown`입니다. 감지가 3D 배치나 케이블 연결을 측정하는 것은 아닙니다.

감지 결과는 기본적으로 로컬에서만 사용합니다. 일련번호는 필요한 안정적 매칭에만 사용하고 native process 안에서 설치별 HMAC으로 바꿉니다. 원문 일련번호와 live snapshot은 로그·JSON 내보내기에 넣지 않습니다. OS에서 생성한 기기와 관련 연결은 이름 수정·매칭 해제 후에도 Meta 자동 전송 구성에서 제외합니다. 매칭한 기존 수동 기기는 수동 정보만 기존 동의 범위로 사용할 수 있습니다.

**실제 Mac 검증은 아직 필요합니다.** [정확한 감지 범위, 실행 방법과 Mac 수동 확인 절차](docs/MACOS_HARDWARE.md)에 따라 display/USB 연결·분리, 동일 이름 기기, bridge 중단, 매칭 및 권한 오류를 확인하세요. Linux의 mock 테스트 통과는 native API 성공의 증거가 아닙니다.

## 연결 정보는 어떻게 믿나요?

상단 **Show connections**는 **View**와 **Edit** 모두에서 켜고 끌 수 있습니다. ON은 Bluetooth를 포함한 모든 기록된 관계를 표시합니다. OFF는 선만 숨기며 연결 기록과 Undo 기록을 변경하지 않습니다. **View connections**를 열면 ON이 되고, View/Edit를 전환해도 선택한 표시 상태를 유지합니다.

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

- 대화 전송: 현재 메시지, Meta 모드에서 작성한 최근 대화 최대 12개, 전송 가능한 기기·연결 구성. Local demo 대화는 자동 전송하지 않습니다.
- 사진 전송: 사진 패널에서 별도 동의하고 분석 버튼을 누른 경우에만 축소된 사진, 전송 가능한 기기·연결·장면 구성, 입력한 설명을 전송합니다. 설명은 시각적 제안의 문맥이며 연결을 자동 저장하지 않습니다.
- OS live snapshot·매칭 identity·OS에서 생성한 기기와 관련 연결·저장 history는 모델 구성에서 제외합니다. 사용자가 직접 메시지나 사진 설명에 쓴 내용은 해당 전송 동의의 대상입니다.
- 모델 제안은 strict JSON schema와 존재하는 기기 ID를 검증한 후 표시합니다. 사진 응답에는 시각적 속성만 허용하며 연결·status·실행 코드 필드는 거부합니다.
- 오류가 나면 실제 오류를 표시합니다. 실패한 live 응답을 성공한 AI 데모로 가장하지 않습니다.
- 실제 API 호출은 비용이 발생할 수 있습니다. 로컬 20 requests/minute 제한은 과금 상한이 아닙니다.

코드는 공식 Meta API 호스트만 허용합니다. 다른 provider, 로컬 open-weight 서버, BYOK 웹 서비스는 이번 MVP 범위가 아닙니다.

## 사진에서 편집 가능한 장면 만들기

1. **Desk photo**에서 사진을 선택합니다. 선택만으로는 전송하지 않습니다.
2. 알고 있는 기기나 연결 설명을 입력하고 별도 Meta 전송 동의를 확인합니다.
3. **Create scene preview with Meta**를 누릅니다. 서버 key가 설정된 경우 실제 API 비용이 발생할 수 있습니다.
4. **Review your desk scene**에서 물체와 기기 매칭을 확인하고, 충돌을 검사하는 배치·표면·책상 연결·부품 편집기로 조정합니다. **Review device record** 안내가 있으면 기존 기기 또는 별도의 새 기기를 선택합니다.
5. **Confirm and apply scene**으로 한 번에 적용하거나 **Discard preview**로 취소합니다.
6. **Scene objects**에서 이후에도 가구·소품을 편집합니다. 기기는 **Edit placement**에서 배치·연결·부품을 수정합니다.
7. 변경은 브라우저에 저장됩니다. 설정의 **Export JSON**과 **Import JSON**으로 구성을 옮길 수 있습니다. 기존 v1 저장본과 JSON은 v2로 읽으며, 사진·대화·key는 JSON에 포함하지 않습니다.

사진 분석의 모델 인식 품질과 live API 성공은 아직 검증하지 않았습니다. 아래 테스트에서는 응답을 mock으로 대체합니다.

## 데모 순서

1. **View**에서 책상과 **Workspace overview**를 보여줍니다. 기본 기기·연결은 예시이며 사용자 보고와 OS 인식이 별도라는 점을 설명합니다.
2. **Show connections**를 켜고 Dock을 선택합니다. 오른쪽 고정 패널에서 상대 기기, 양쪽 포트, 출처와 메모를 확인합니다. Bluetooth 기록도 연결 목록에 남습니다.
3. **Edit**로 바꾸고 키보드·마우스·SSD 또는 의자를 직접 옮깁니다. 매트/러그 위 이동, 장애물에서 정지, 연결선 갱신, Undo/Redo를 보여줍니다. 부착한 물체가 있는 책상도 함께 이동시킵니다.
4. 실제 Mac에서 helper 빌드와 수동 확인을 완료했다면 **Open Mac hardware → Start detection**을 시연합니다. 실제 OS 출처·시각을 보여주고 새 기기 연결/분리로 목록 갱신을 확인합니다. Linux나 helper 미설치 환경에서는 Unavailable을 그대로 보여줍니다.
5. 관측 하나를 선택하고 기존 기기 또는 새 기기를 명시적으로 매칭합니다. 검토 전에는 저장되지 않고, 승인해도 사용자 작동 상태는 자동 변경되지 않음을 확인합니다.
6. **Stop detection**으로 중지합니다. 상태가 Detection stopped가 되며 연결 해제로 표시되지 않는지 확인합니다.
7. 문제가 보고된 모니터를 선택해 **Troubleshoot monitor step by step**을 엽니다. 직접 확인한 답만 입력하고 **Save result as user-reported**를 눌러야 저장됩니다.
8. 사진 흐름은 선택 → 별도 전송 동의 → preview 수정 → **Confirm and apply scene** 순서입니다. 실제 Meta 분석은 별도 승인과 key가 있을 때만 실행합니다. 사진 테스트는 mock 결과이며 실제 인식 성공으로 소개하지 않습니다.
9. **Open settings → Export JSON**으로 구성을 내보냅니다. 승인한 장면과 출처는 남고 설치별 하드웨어 매칭은 제외됩니다.

로컬 대화 데모에서 `I connected the right monitor to the dock with HDMI`를 입력하면 제한된 규칙 기반 제안이 나옵니다. **Confirm and apply**를 눌러야 사용자 보고 연결이 저장됩니다. 자유로운 대화와 실제 사진 분석은 Meta 연결이 필요합니다.

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

`DESKTWIN_TEST_PORT`와 `DESKTWIN_TEST_API_PORT`는 Playwright가 시작할 UI/API 서버에 전달됩니다. 기존 서버를 종료하거나 설정을 바꿀 필요가 없습니다. 테스트는 실제 Meta API 크레딧을 사용하지 않습니다. 실행한 검사와 남은 수동 검증은 [검증 기록](docs/VALIDATION.md)에 구분해서 기록합니다.

- [Mac 하드웨어 감지와 실제 Mac 수동 확인](docs/MACOS_HARDWARE.md)
- [기본 장면 드래그·비동기 저장 회귀 조사](docs/BASELINE_REGRESSIONS.md)
- [장면 배치·형태 편집과 남은 제약](docs/SCENE_EDITOR.md)
- [탭 간 저장 충돌과 입력 처리](docs/STORAGE.md)
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
