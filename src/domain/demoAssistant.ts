import type { AssistantResponse, Device, Proposal, Workspace } from './workspace';

/** A deliberately limited offline demonstration, not an LLM. */
export function demoReply(message: string, workspace: Workspace): AssistantResponse {
  const text = message.toLowerCase();
  const aliases: Record<string, string[]> = {
    laptop: ['macbook', '맥북', '노트북', 'laptop'],
    dock: ['dock', '도크', '독'],
    'monitor-left': ['왼쪽 모니터', '왼쪽 화면', 'left monitor'],
    'monitor-right': ['오른쪽 모니터', '오른쪽 화면', 'right monitor'],
    ssd: ['ssd', '외장 드라이브'],
    router: ['공유기', 'router'],
    keyboard: ['키보드', 'keyboard'],
    mouse: ['마우스', 'mouse'],
  };
  const mentioned = workspace.devices.filter((d) =>
    [d.name.toLowerCase(), d.id.toLowerCase(), ...(aliases[d.id] || [])].some(
      (a) => a.length > 1 && text.includes(a),
    ),
  );
  const respond = (message: string, proposals: Proposal[] = []): AssistantResponse => ({
    message,
    proposals,
    mode: 'demo',
  });
  const problem =
    /안\s*나와|안\s*나오|안\s*켜|안\s*돼|안\s*되|인식.*않|no signal|not working|문제/.test(text);
  if (problem) {
    const d = mentioned.find((d) => d.kind === 'monitor') || mentioned[0];
    if (!d)
      return respond(
        '어느 기기에 문제가 있나요? 예: “오른쪽 모니터가 안 나와”. 실제 화면이나 연결 상태를 제가 감지한 것은 아닙니다.',
      );
    const peers = workspace.connections
      .filter((c) => c.from === d.id || c.to === d.id)
      .map(
        (c) =>
          workspace.devices.find((item) => item.id === (c.from === d.id ? c.to : c.from))?.name,
      )
      .filter(Boolean);
    return respond(
      `${d.name}의 문제를 사용자 보고로 기록할 수 있어요. ${peers.length ? `저장된 구성에는 ${peers.join(', ')} 연결이 있습니다. 이 기록은 실제 동작의 증거는 아닙니다.` : '아직 연결 구성이 없습니다.'}\n\n먼저 기기의 전원과 입력 소스를 확인해 주세요. 모니터라면 케이블이 연결된 HDMI/DP 입력이 선택되어 있는지 확인한 뒤 결과를 알려주세요.`,
      [
        {
          type: 'set-status',
          deviceId: d.id,
          status: 'reported-issue',
          note: message.slice(0, 300),
          reason: '사용자가 보고한 문제를 기록합니다. 자동 진단 결과가 아닙니다.',
        },
      ],
    );
  }
  if (/연결|꽂|connect/.test(text)) {
    if (mentioned.length < 2 || /어떻게|추천|할까|할 수|should|can i|\?/.test(text))
      return respond(
        '연결한 두 기기와 케이블 종류를 알려주세요. 예: “MacBook을 Dock에 USB-C로 연결했어”. 모르는 포트 사양은 추측해서 채우지 않습니다.',
      );
    if (mentioned.length > 2)
      return respond(
        '여러 기기를 말씀하셨어요. 로컬 데모에서는 한 번에 두 기기의 연결만 기록합니다. 연결 관계를 하나씩 알려주세요.',
      );
    const type = /hdmi/.test(text)
      ? 'HDMI'
      : /displayport|\bdp\b/.test(text)
        ? 'DisplayPort'
        : /usb[ -]?c/.test(text)
          ? 'USB-C'
          : /ethernet|이더넷|랜선/.test(text)
            ? 'Ethernet'
            : /bluetooth|블루투스/.test(text)
              ? 'Bluetooth'
              : /usb[ -]?a/.test(text)
                ? 'USB-A'
                : 'Unknown';
    return respond(
      `${mentioned[0].name} ↔ ${mentioned[1].name} 연결을 ${type === 'Unknown' ? '종류 미확인' : type}으로 기록할까요? 아래에서 확인해야 구성이 바뀝니다. 케이블의 성능이나 현재 작동 상태는 확인하지 않았습니다.`,
      [
        {
          type: 'connect',
          from: mentioned[0].id,
          to: mentioned[1].id,
          connector: type,
          reason: '사용자가 대화로 알려준 연결 구성입니다.',
        },
      ],
    );
  }
  if (/정상|해결|잘\s*나와|이제.*나와|작동해|working now/.test(text)) {
    const d: Device | undefined = mentioned[0];
    if (!d)
      return respond(
        '어느 기기를 어떤 방법으로 확인했나요? 예: “오른쪽 모니터는 직접 연결하니 이제 잘 나와”. 확인 결과를 사용자 테스트로 기록합니다.',
      );
    return respond(
      `${d.name}의 동작을 사용자 확인 결과로 기록할까요? 독립적인 시스템 검증으로 표시하지는 않습니다.`,
      [
        {
          type: 'set-status',
          deviceId: d.id,
          status: 'reported-working',
          note: message.slice(0, 300),
          reason: '사용자가 직접 확인한 동작 결과입니다.',
        },
      ],
    );
  }
  return respond(
    '지금은 외부 전송 없는 로컬 데모입니다. 자연어 전체를 이해하는 LLM은 아직 연결되지 않았어요.\n\n“오른쪽 모니터를 Dock에 HDMI로 연결했어”처럼 연결을 알려주거나, “오른쪽 모니터가 안 나와”처럼 문제를 알려주세요. Meta API 키를 설정하면 실제 모델과 대화할 수 있습니다.',
  );
}
