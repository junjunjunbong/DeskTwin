# Submission close-out

마감은 **2026-11-04 21:00 ET**, 한국 시간 **2026-11-05 11:00**입니다. 공개 이벤트 페이지는 2026-11-03에도 같은 시각을 유지했습니다. 로그인 뒤 제출 폼은 확인하지 못했습니다.

이 저장소의 커밋은 모두 2026-10-26 이후입니다. 이 문서는 촬영 원고와 제출 문장입니다. 저장소는 2026-11-05에 public으로 바꿨습니다. 영상 업로드와 Cerebral Valley 제출은 아직입니다.

## 남은 일

1. 아래 순서로 3분 영상을 찍고, 로그아웃한 브라우저에서도 열리는 링크를 만듭니다.
2. 저장소를 public으로 바꿉니다. 바꾼 뒤 로그아웃 상태에서 코드와 README 이미지가 열리는지 확인합니다. 공개 전 점검 결과는 맨 아래에 있습니다.
3. Cerebral Valley에서 제출하고 확인 화면을 남깁니다.

## 실제 Meta 호출 기록 (2026-11-04)

| 요청                            | 결과                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 대화 1번                        | 성공, 14.3초. 기록된 기기가 없다는 점을 밝히고 전원·입력·케이블 순서로 안내했습니다.                                                                                                                                                                                                                                                          |
| 실사진 분석 (서버 제한 60초)    | 60초에 504 시간 초과. 이후 사진 제한을 서버 120초, 브라우저 125초로 늘렸습니다.                                                                                                                                                                                                                                                               |
| 실사진 분석 (120초)             | 약 98초 뒤 502. 진단용으로 같은 요청을 한 번 더 보내자 82초에 물건 17개가 왔습니다. 사진 가장자리에서 잘린 노트북의 영역이 사진 밖으로 나가 응답 전체가 거부됐습니다. 이제 그런 영역은 사진 안쪽으로 잘라 씁니다. 저장한 응답을 다시 넣으면 고르기와 3D 검토까지 가지만, 모니터·받침대·스탠드 겹침 4–5건이 남아 적용 전에 직접 고쳐야 합니다. |
| Muse Image 데모 이미지 3장 생성 | 12.8초, $0.03. Git이 무시하는 `local-data/demo-images/`에 저장했습니다.                                                                                                                                                                                                                                                                       |
| 생성 이미지 2번, 2단계 + SAM    | 성공, 96.7초. 목록 37.4초(SAM 3.1이 14개 중 13개 윤곽), 배치 60.7초, 적용까지 막힘 없음. `META_PHOTO_TWO_STAGE=true`, `META_SAM_ENABLED=true`.                                                                                                                                                                                                |
| 실사진, 2단계 + SAM             | 목록 성공(53.6초, 19개, SAM 12개), 배치 단계 502. 원인 미확인.                                                                                                                                                                                                                                                                                |
| 생성 이미지 2번 분석 (120초)    | 성공, 70.4초. 물건 14개 → 고르기 → 3D 검토 → 적용까지 막힘 없이 진행됐고, 기기 6개와 물건 8개가 저장됐습니다.                                                                                                                                                                                                                                 |

개별 관찰이며 응답 시간 분포나 품질을 뜻하지 않습니다. 영상의 사진 단계는 생성 이미지 2번을 쓰고, 화면에 “Muse Image로 만든 데모 이미지”라고 표시합니다.

## 3분 촬영

한 사용 사례만 보여줍니다. 노트북, 도크, 모니터 두 대 중 오른쪽 화면이 나오지 않는 상황입니다. 사진 제안, 사용자가 확인한 연결, 점검 답이 서로 다른 기록이라는 점을 말로 구분합니다.

분석 대기는 편집으로 줄입니다. 분석 중 경과 초는 화면에 남기고, 시간 초과가 나면 그 오류를 그대로 보여준 뒤 수동 기록으로 이어갑니다. 규칙 기반 Local demo를 Meta 결과처럼 말하지 않습니다.

| 시간      | 화면                         | 말과 조작                                                                                                                                                                                                                                                                                                                                                                                  |
| --------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:00–0:15 | 제목                         | “책상 위 기기와 케이블은 사진만으로 확인되지 않습니다. DeskTwin은 Meta가 본 장면을 제안하고, 사람이 연결과 점검 결과를 확인한 뒤에 기록합니다.”                                                                                                                                                                                                                                            |
| 0:15–0:25 | 🏠 My desk 처음 화면         | 왼쪽 메뉴가 My desk, Hardware, AI chat 세 개라는 것을 보여줍니다. 오른쪽 **This is an example desk** 안내에서 **Start my own desk**를 누릅니다. 예시 기기만 사라지고 방은 남습니다.                                                                                                                                                                                                        |
| 0:25–1:15 | 🏠 My desk → 사진            | Muse Image로 만든 데모 책상 이미지라고 먼저 밝힙니다. **Build from a photo**로 사진을 고르고 메모에 “오른쪽 모니터는 HDMI로 도크에, 도크는 노트북 USB-C에 연결했다”를 적습니다. 동의 칸을 읽고 **Create scene preview with Meta**를 누릅니다. 대기는 자릅니다.                                                                                                                             |
| 1:15–1:35 | Choose what to add           | 물건마다 **Outlined by SAM 3.1** 표시를 짚고, 머그컵과 **Laptop stand**를 빼고 **Continue with N objects**를 누릅니다. 스탠드를 빼면 노트북이 책상 위에 바로 놓여, 노트북·스탠드 겹침으로 적용이 막히는 경우를 피합니다. 3D 검토 창에서 장면을 확인하고 **Confirm and apply scene**, 이어서 **Back to the desk**를 누릅니다. 연결을 적을 때는 책상에서 기기를 누르고 꽂힌 기기를 고릅니다. |
| 1:35–2:00 | 🔌 Hardware → Connections    | 메모에서 나온 **Review:** 제안 두 개를 각각 눌러 폼을 채우고 **Save connection**으로 저장합니다. 장면에 연결선과 “Focus: … → …”가 뜨는 것을 보여주고 “저장은 사용자 보고이며 작동을 확인한 것은 아니다”라고 말합니다.                                                                                                                                                                      |
| 2:00–2:25 | 🖥 오른쪽 모니터 상세         | 책상에서 오른쪽 모니터를 눌러 상세 화면의 **Troubleshoot monitor step by step**으로 한 단계 답합니다. **Save result as user-reported** 전에는 작동 상태가 바뀌지 않음을 보여줍니다.                                                                                                                                                                                                        |
| 2:25–2:45 | 💬 AI chat                   | 모니터 카드의 **Ask about this device**로 “오른쪽 화면이 검다. 기록된 경로에서 다음에 무엇을 볼까?”를 묻습니다. Meta 응답이면 모델 답이라고 말하고, 장면에 자동 강조된 기록 경로를 가리킵니다.                                                                                                                                                                                             |
| 2:45–3:00 | `server/meta.ts`의 사진 지시 | 사진 응답은 보이는 물체의 시각 제안만 받고, 연결과 작동 상태는 받지 않는다고 말합니다. “이 저장소는 해커톤 기간에 시작했습니다.”로 끝냅니다.                                                                                                                                                                                                                                               |

사진 요청이 시간 초과로 끝나면 오류를 2초 보여주고 자릅니다. 그다음 My desk의 **Add a device**로 노트북, 도크, 모니터 두 대를 넣어 1:35부터 같은 연결·점검·대화를 진행합니다. 수동으로 넣은 기기를 사진이 찾았다고 말하지 않습니다.

Mac 감지는 이 3분에 넣지 않습니다. helper를 빌드하고 연결·분리를 직접 확인한 뒤에만 별도 장면으로 보여줄 수 있습니다.

촬영 중 피합니다.

- 재매칭, 잠금, 제외, Undo를 한 흐름에서 조합하지 않습니다. 고르기 → 최초 검토 → 저장만 사용합니다.
- **Fit small gaps**, **Match photo again**은 시간이 남을 때만 다룹니다. 저장된 19개 응답의 로컬 재현 성공을 새 사진의 인식 품질이라고 말하지 않습니다.
- 예시 기기, 사진 추정, 사용자 보고, OS 관측을 한 종류의 사실로 합치지 않습니다.
- 실제 개인 책상 사진은 영상에 쓰지 않습니다. 데모 이미지는 실제 책상이 아니라고 화면에 밝힙니다.

## 제출 폼에 붙여 넣을 영문

**Name:** DeskTwin

**One line:** A desk photo becomes an editable workspace, and a confirmed connection graph guides one real monitor check.

**Description:**

DeskTwin helps someone explain and troubleshoot a desk with several devices. A Muse Spark request finds the visible objects in a desk photo. The person first chooses which ones belong in their desk, reviews the proposed 3D layout, confirms the cables they have actually checked, and walks through a route-aware monitor check. The app keeps three claims separate: a photo interpretation, a user report, and an optional consented macOS observation. Nothing from the photo is saved until the person applies it, and a saved cable does not mark a device as working.

The repository was started during this hackathon. It uses the Meta Model API with `muse-spark-1.3` and strict structured output for both conversation and photo understanding. Photo responses may describe visible objects only; connection, operating status, and executable fields are rejected. With no API key, the same workflow runs as a labeled local demo and does not imitate a model response.

**What is new in this event:** the workspace, first-visit setup, photo object selection and review, connection confirmation, monitor check, local Mac matching boundary, and Meta structured-output integration were built during the hackathon. There is no pre-event commit in this repository.

## 공개 전 점검 (2026-11-04)

로컬과 원격의 브랜치 20개, 커밋 50개 전체를 확인했습니다.

- 실제 `MODEL_API_KEY` 값은 어느 커밋에도 없습니다. 키 형태 검색에서 걸린 것은 README 예시 `MODEL_API_KEY=your_key_here` 하나입니다. `.env`는 무시 목록에 있고 추적된 적이 없습니다.
- 개인 책상 사진은 커밋된 적이 없습니다. 추가된 이미지는 `docs/screenshots/`의 앱 화면 19장과 합성 테스트 파일 `tests/fixtures/synthetic-rotated.heic`뿐입니다. 사진 검토·Mac 감지 화면도 가짜 데이터입니다.
- `tests/fixtures/photo-scene-19-sanitized.json`에는 원본 사진, 물건 이름, 메모, 색이 없고 좌표와 종류만 있습니다.
- 커밋 작성자 이메일은 GitHub noreply 주소이고, 추적 파일에 로컬 사용자 경로가 없습니다.
- `LICENSE`(MIT)와 `public/THIRD_PARTY_NOTICES.txt`가 있습니다.

공개하면 `codex/*`, `feat/*` 같은 원격 브랜치도 함께 보입니다. 숨길 브랜치가 있으면 공개 전에 정리합니다.
