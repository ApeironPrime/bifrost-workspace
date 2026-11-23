import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export type ToastType = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  closeLabel?: string;
  regionLabel?: string;
}

export function ToastContainer({
  toasts,
  onDismiss,
  closeLabel = "Đóng",
  regionLabel,
}: ToastContainerProps) {
  if (toasts.length === 0) return null;
  const label = regionLabel ?? (closeLabel === "Close" ? "Notifications" : closeLabel === "閉じる" ? "通知" : "Thông báo");

  return (
    <div
      className="toast-container"
      role="region"
      aria-label={label}
    >
      {toasts.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          onDismiss={onDismiss}
          closeLabel={closeLabel}
        />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
  closeLabel,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  closeLabel: string;
}) {
  const { id, type, message, duration = 4000 } = toast;

  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const remaining = useRef(duration);
  useEffect(() => {
    if (hovered || focused) return;
    const started = performance.now();
    const timer = window.setTimeout(() => {
      onDismiss(id);
    }, remaining.current);

    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [id, duration, onDismiss, hovered, focused]);

  const icons: Record<ToastType, string> = {
    success: "✓",
    error: "✕",
    info: "ℹ",
  };

  return (
    <div
      className={`toast-card toast-${type}`}
      role={type === "error" ? "alert" : "status"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <span className="toast-icon" aria-hidden="true">
        {icons[type]}
      </span>
      <p className="toast-message">{message}</p>
      <button
        type="button"
        className="toast-close"
        onClick={() => onDismiss(id)}
        aria-label={closeLabel}
        title={closeLabel}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
