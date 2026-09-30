"use client";

import { useEffect, useRef, useState } from "react";

export const SUCCESS_NOTICE_EVENT = "cutz-bangs:success";

type SuccessNoticeDetail = { message?: string };

/** Global feedback for successful API mutations across every portal. */
export function SuccessNotifier() {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<SuccessNoticeDetail>).detail;
      setNotice(detail?.message?.trim() || "Changes saved successfully.");
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setNotice(null), 4200);
    };
    window.addEventListener(SUCCESS_NOTICE_EVENT, show);
    return () => {
      window.removeEventListener(SUCCESS_NOTICE_EVENT, show);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  if (!notice) return null;
  return (
    <div className="success-toast" role="status" aria-live="polite">
      <span aria-hidden="true">✓</span>
      <p>{notice}</p>
      <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss success notification">×</button>
    </div>
  );
}
