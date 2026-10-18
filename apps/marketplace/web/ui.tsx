import React, { useEffect, useRef, useState } from "react";
export type Locale = "zh" | "en";
export function Icon({
  name,
  size = 20,
}: {
  name:
    | "search"
    | "arrow"
    | "close"
    | "filter"
    | "download"
    | "copy"
    | "check"
    | "plus"
    | "upload"
    | "grid"
    | "text"
    | "smile";
  size?: number;
}) {
  const paths = {
    text: <path d="M4 5h16M4 10h16M4 15h10M4 20h6" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    filter: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="2" />
        <circle cx="15" cy="17" r="2" />
      </>
    ),
    download: <path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5" />,
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    upload: <path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" />,
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    smile: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 14q4 5 8 0M8 8h.01M16 8h.01" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function Modal({
  title,
  locale,
  close,
  children,
}: {
  title: string;
  locale: Locale;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [closing, setClosing] = useState(false);
  function dismiss() {
    if (closeTimer.current) return;
    if (
      !window.matchMedia?.("(prefers-reduced-motion: no-preference)").matches
    ) {
      close();
      return;
    }
    setClosing(true);
    closeTimer.current = setTimeout(close, 160);
  }
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      clearTimeout(closeTimer.current);
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      data-closing={closing || undefined}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="modal-content">
        <div className="section-heading">
          <h2 id="modal-title">{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={locale === "zh" ? "关闭" : "Close"}
            onClick={dismiss}
          >
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function CopyButton({
  value,
  locale,
  label,
}: {
  value: string;
  locale: Locale;
  label: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 3000);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <>
      <button
        type="button"
        className="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setState("copied");
          } catch {
            setState("failed");
          }
        }}
      >
        <Icon name={state === "copied" ? "check" : "copy"} />
        {state === "copied" ? (locale === "zh" ? "已复制" : "Copied") : label}
      </button>
      <span className="sr-only" role="status">
        {state === "copied" ? (locale === "zh" ? "已复制" : "Copied") : ""}
      </span>
      {state === "failed" && (
        <p className="note" role="alert">
          {locale === "zh"
            ? "无法访问剪贴板，请手动复制："
            : "Clipboard unavailable. Copy manually:"}{" "}
          <code>{value}</code>
        </p>
      )}
    </>
  );
}
export function EmptyState({
  title,
  children,
  icon = "smile",
}: {
  title: string;
  children?: React.ReactNode;
  icon?: "smile" | "search" | "upload";
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={28} />
      </span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
