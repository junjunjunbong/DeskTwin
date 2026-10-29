import type { ReactNode } from 'react';
import {
  CheckCircle,
  Question,
  WarningCircle,
  Desktop,
  ShareNetwork,
  Plus,
  ArrowRight,
  Cube,
} from '@phosphor-icons/react';
import { DeviceIcon } from './ui';
import { kindLabels, sourceLabels, type Device, type Workspace } from '../domain/workspace';

export function ReportedStatus({ status }: { status: Device['status'] }) {
  const Icon =
    status === 'reported-working'
      ? CheckCircle
      : status === 'reported-issue'
        ? WarningCircle
        : Question;
  return (
    <span className={`reported-status ${status}`}>
      <Icon size={14} aria-hidden="true" />
      {status === 'reported-working'
        ? 'User reports working'
        : status === 'reported-issue'
          ? 'User reports an issue'
          : 'Needs a user check'}
    </span>
  );
}

export function WorkspaceOverview({
  workspace,
  mode,
  onSelect,
  onAdd,
  onAddObject,
  onConnect,
  hardwareSummary,
  renderHardwareStatus,
}: {
  workspace: Workspace;
  mode: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onAddObject: () => void;
  onConnect: () => void;
  hardwareSummary?: ReactNode;
  renderHardwareStatus?: (device: Device) => ReactNode;
}) {
  const issues = workspace.devices.filter((device) => device.status === 'reported-issue');
  const working = workspace.devices.filter((device) => device.status === 'reported-working').length;
  const unknown = workspace.devices.filter((device) => device.status === 'unknown').length;
  return (
    <aside className="floating-panel workspace-overview" aria-label="Workspace overview">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            {mode === 'edit' ? 'MAKE IT YOURS' : 'YOUR DESK AT A GLANCE'}
          </span>
          <h2>{mode === 'edit' ? 'Edit your workspace' : 'Workspace overview'}</h2>
        </div>
        <Cube size={24} className="overview-mark" aria-hidden="true" />
      </div>
      <div className="panel-scroll">
        <p className="overview-intro">
          {mode === 'edit'
            ? 'Select an object to move it, adjust its shape, or change its color. Drag directly in the scene.'
            : 'Select a device to inspect its evidence, recorded connections, and user reports.'}
        </p>
        <div className="overview-totals" aria-label="Workspace counts">
          <div>
            <Desktop size={19} aria-hidden="true" />
            <strong>{workspace.devices.length}</strong>
            <span>devices</span>
          </div>
          <div>
            <ShareNetwork size={19} aria-hidden="true" />
            <strong>{workspace.connections.length}</strong>
            <span>recorded links</span>
          </div>
        </div>
        {hardwareSummary}
        <section className="overview-reports" aria-label="User report summary">
          <h3>User reports</h3>
          <div className="report-counts">
            <span>
              <CheckCircle size={16} aria-hidden="true" />
              <strong>{working}</strong> working
            </span>
            <span>
              <WarningCircle size={16} aria-hidden="true" />
              <strong>{issues.length}</strong> issues
            </span>
            <span>
              <Question size={16} aria-hidden="true" />
              <strong>{unknown}</strong> to check
            </span>
          </div>
          <p className="micro-note">
            User reports and OS recognition are separate evidence. Recognition alone does not verify
            that a device works.
          </p>
        </section>
        {issues.length > 0 && (
          <section className="attention-list" aria-label="Devices with reported issues">
            <h3>
              <WarningCircle size={17} aria-hidden="true" /> Needs attention
            </h3>
            {issues.map((device) => (
              <button key={device.id} onClick={() => onSelect(device.id)}>
                <span>
                  <strong>{device.name}</strong>
                  <small>{device.statusNote || 'Open the recorded connections and checks.'}</small>
                </span>
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            ))}
          </section>
        )}
        <section className="overview-devices" aria-label="Workspace devices">
          <div className="section-heading">
            <h3>Devices</h3>
            <span className="count">{workspace.devices.length}</span>
          </div>
          {workspace.devices.map((device) => (
            <button
              className="device-list-row overview-device"
              key={device.id}
              onClick={() => onSelect(device.id)}
            >
              <span className="list-device-glyph">
                <DeviceIcon kind={device.kind} size={22} />
              </span>
              <span>
                <strong>{device.name}</strong>
                <small>
                  {kindLabels[device.kind]} · {sourceLabels[device.source]}
                </small>
                <ReportedStatus status={device.status} />
                {renderHardwareStatus?.(device)}
              </span>
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          ))}
          {!workspace.devices.length && (
            <p className="empty-copy">
              Add a device manually, or link a device recognized by your Mac.
            </p>
          )}
        </section>
        <div className="overview-actions">
          <button
            className="button secondary full"
            onClick={onAdd}
            disabled={workspace.devices.length >= 40}
          >
            <Plus size={16} />
            Add a device manually
          </button>
          {mode === 'edit' && (
            <button
              className="button secondary full"
              onClick={onAddObject}
              disabled={workspace.objects.length >= 60}
            >
              <Cube size={16} />
              Add an object
            </button>
          )}
          <button
            className="text-button"
            onClick={onConnect}
            disabled={workspace.devices.length < 2}
          >
            <ShareNetwork size={16} />
            {mode === 'edit' ? 'Record a connection' : 'Edit connections'}
          </button>
        </div>
        <p className="micro-note">
          Example data, photo estimates, and user records keep their own sources. Recorded links
          include Bluetooth and do not establish physical cable routes.
        </p>
      </div>
    </aside>
  );
}
