import {
  diagnosticContextMatches,
  diagnosticStep,
  diagnosticStepTitles,
  diagnosisNote,
} from './diagnosis';
import type { AssistantResponse, Device, Proposal, Workspace } from './workspace';

/** A deliberately limited offline demonstration, not an LLM. */
export function demoReply(
  message: string,
  workspace: Workspace,
  focusDeviceId?: string | null,
): AssistantResponse {
  const text = message.toLowerCase();
  const aliases: Record<string, string[]> = {
    laptop: ['macbook', '맥북', '노트북', 'laptop'],
    dock: ['dock', '도크', '독'],
    'monitor-left': ['왼쪽 모니터', '왼쪽 화면', 'left monitor', 'left display'],
    'monitor-right': ['오른쪽 모니터', '오른쪽 화면', 'right monitor', 'right display'],
    ssd: ['ssd', '외장 드라이브', 'external drive'],
    router: ['공유기', 'router'],
    keyboard: ['키보드', 'keyboard'],
    mouse: ['마우스', 'mouse'],
  };
  const mentioned = workspace.devices.filter((d) =>
    [d.name.toLowerCase(), d.id.toLowerCase(), ...(aliases[d.id] || [])].some(
      (a) => a.length > 1 && text.includes(a),
    ),
  );
  const focused = workspace.devices.find((device) => device.id === focusDeviceId);
  if (
    focused &&
    !mentioned.some((device) => device.id === focused.id) &&
    /\b(?:this (?:device|monitor|display)|it)\b|이 (?:기기|모니터|화면)/.test(text)
  )
    mentioned.push(focused);
  const respond = (message: string, proposals: Proposal[] = []): AssistantResponse => ({
    message,
    proposals,
    mode: 'demo',
  });
  function savedGuidance(deviceId: string): string | null {
    const latest = (workspace.diagnoses ?? [])
      .filter((session) => session.deviceId === deviceId)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .at(-1);
    if (!latest) return null;
    const labels = {
      fixed: 'screen reported working',
      'not-fixed': 'still no display',
      skip: 'not checked',
      confirmed: 'prerequisite confirmed by user',
      'not-confirmed': 'prerequisite not confirmed',
      'not-supported': 'compatibility not supported',
    };
    const history = latest.answers.length
      ? `Saved user checks: ${latest.answers.map((answer) => `${diagnosticStepTitles[answer.kind]} — ${labels[answer.answer]}`).join('; ')}.`
      : 'A guided check is already open; no answers have been saved yet.';
    if (!diagnosticContextMatches(latest, workspace))
      return `${history}\n\nThe recorded connection path changed after this check started. Review the current connections and start a new guided check before using the old steps.`;
    if (latest.result === 'active') {
      const next = diagnosticStep(latest, workspace);
      return `${history}\n\nCurrent unanswered check: ${next.title}. ${next.text} ${next.note}\nUse the guided check buttons to record what you observe. The local demo does not mark a test completed from this conversation.`;
    }
    return `${history}\n\n${diagnosisNote(latest)} ${latest.result === 'resolved' ? 'If the issue has returned, start a new guided check; the earlier result is historical.' : 'Review the unresolved or skipped prerequisite before starting another check. No failed component has been established.'}`;
  }
  const problem =
    /안\s*나와|안\s*나오|안\s*켜|안\s*돼|안\s*되|인식.*않|no signal|not working|not displaying|not display|isn['’]t displaying|doesn['’]t display|does not display|no display|black screen|문제/.test(
      text,
    );
  if (problem) {
    const d = mentioned.find((d) => d.kind === 'monitor') || mentioned[0] || focused;
    if (!d)
      return respond(
        'Which device has an issue? For example: “The right monitor is not displaying.” I have not detected the actual display or connection status.',
      );
    const peers = workspace.connections
      .filter((c) => c.from === d.id || c.to === d.id)
      .map(
        (c) =>
          workspace.devices.find((item) => item.id === (c.from === d.id ? c.to : c.from))?.name,
      )
      .filter(Boolean);
    const guidance = savedGuidance(d.id);
    return respond(
      `I can record the issue with ${d.name} as user-reported. ${peers.length ? `The saved workspace lists connections to ${peers.join(', ')}. These records do not prove that they are working.` : 'There are no saved connections yet.'}\n\n${guidance ?? 'First, check the device’s power and input source. For a monitor, check that the selected HDMI or DisplayPort input matches the cable, then let me know what you observe.'}`,
      [
        {
          type: 'set-status',
          deviceId: d.id,
          status: 'reported-issue',
          note: message.slice(0, 300),
          reason: 'The user reported an issue. This is not an automatic diagnosis.',
        },
      ],
    );
  }
  const working = /정상|해결|잘\s*나와|이제.*나와|작동해|working now/.test(text);
  if (/연결|꽂|connect/.test(text) && !(working && mentioned.length === 1)) {
    if (
      mentioned.length < 2 ||
      /어떻게|추천|할까|할 수|\b(?:how|should|could|would|can i|what|which)\b|\?/.test(text)
    )
      return respond(
        'Tell me which two devices you connected and the cable type. For example: “I connected my MacBook to the dock with USB-C.” I will not guess unknown port specifications.',
      );
    if (mentioned.length > 2)
      return respond(
        'You mentioned several devices. The local demo can record one connection between two devices at a time. Please describe each connection separately.',
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
      `Record the connection between ${mentioned[0].name} and ${mentioned[1].name} as ${type === 'Unknown' ? 'an unknown type' : type}? You must confirm below before the workspace changes. Cable capabilities and current operation have not been verified.`,
      [
        {
          type: 'connect',
          from: mentioned[0].id,
          to: mentioned[1].id,
          connector: type,
          reason: 'The user described this connection in the conversation.',
        },
      ],
    );
  }
  if (working) {
    const d: Device | undefined = mentioned[0] ?? focused;
    if (!d)
      return respond(
        'Which device did you test, and how? For example: “The right monitor is working now with a direct connection.” I can record the result as a user test.',
      );
    return respond(
      `Record ${d.name} as working based on your test? This will not be shown as independent system verification.`,
      [
        {
          type: 'set-status',
          deviceId: d.id,
          status: 'reported-working',
          note: message.slice(0, 300),
          reason: 'The user reported a successful test.',
        },
      ],
    );
  }
  if (focused) {
    const guidance = savedGuidance(focused.id);
    if (guidance) return respond(`Local demo context for ${focused.name}.\n\n${guidance}`);
  }
  return respond(
    'This is a local demo and does not send data externally. A full natural-language LLM is not currently connected.\n\nDescribe a connection, such as “I connected the right monitor to the dock with HDMI,” or report a problem, such as “The right monitor is not displaying.” You can configure a Meta API key to talk to a model.',
  );
}
