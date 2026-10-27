import { useEffect, useRef, type ReactNode } from 'react';
import {
  X,
  Laptop,
  Monitor,
  HardDrives,
  WifiHigh,
  Keyboard,
  Mouse,
  DesktopTower,
  Usb,
  type IconProps,
} from '@phosphor-icons/react';
import type { DeviceKind } from '../domain/workspace';
export function DeviceIcon({ kind, ...props }: IconProps & { kind: DeviceKind }) {
  const icons = {
    laptop: Laptop,
    monitor: Monitor,
    dock: Usb,
    ssd: HardDrives,
    router: WifiHigh,
    keyboard: Keyboard,
    mouse: Mouse,
    desktop: DesktopTower,
  };
  const Icon = icons[kind];
  return <Icon {...props} />;
}
export function Modal({
  title,
  children,
  onClose,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    function keyboard(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        closeRef.current();
      }
      if (e.key === 'Tab') {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, a[href], [tabindex="0"]',
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', keyboard, true);
    return () => {
      document.removeEventListener('keydown', keyboard, true);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="panel-heading">
          <div>
            <span className="eyebrow">YOUR WORKSPACE</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
