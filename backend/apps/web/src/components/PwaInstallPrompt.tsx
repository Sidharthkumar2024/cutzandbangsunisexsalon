"use client";

import { useEffect, useMemo, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator && Boolean(window.navigator.standalone)));

export function PwaInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.warn("PWA service worker registration failed", error);
      });
    });
  }, []);

  useEffect(() => {
    setInstalled(isStandalone());

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      window.localStorage.setItem("cutz-pwa-install-dismissed", "1");
    };

    setDismissed(window.localStorage.getItem("cutz-pwa-install-dismissed") === "1");
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const showPrompt = useMemo(() => {
    if (installed || dismissed || !installPrompt) return false;
    return window.location.pathname.startsWith("/admin");
  }, [dismissed, installPrompt, installed]);

  if (!showPrompt) return null;

  const install = async () => {
    const prompt = installPrompt;
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstalled(true);
    }
    setInstallPrompt(null);
  };

  const dismiss = () => {
    window.localStorage.setItem("cutz-pwa-install-dismissed", "1");
    setDismissed(true);
  };

  return (
    <aside className="pwa-install" aria-label="Install Cutz & Bangs app">
      <div>
        <strong>Install salon app</strong>
        <span>Fast access to POS, customers and campaigns.</span>
      </div>
      <button type="button" className="btn" onClick={install}>
        Install
      </button>
      <button type="button" className="btn secondary" onClick={dismiss} aria-label="Dismiss install prompt">
        Later
      </button>
    </aside>
  );
}
