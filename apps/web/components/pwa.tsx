'use client';

import { useEffect, useState } from 'react';
import { Icon } from './ui';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Registers /sw.js in production only (it caches static files, never personal data).
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Without a service worker the app still works online; nothing to report.
    });
  }, []);
  return null;
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

// "Instalar app" when the browser offers it; on iPhone/iPad, the manual steps.
export function InstallAppButton({ className = '', onDark = false }: { className?: string; onDark?: boolean }) {
  const look = onDark ? 'btn btn-ghost-on-dark' : 'btn btn-secondary';
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    // Safari on iOS never fires beforeinstallprompt.
    const timer = window.setTimeout(() => setIosHint(isIos()), 0);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.clearTimeout(timer);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  }

  if (prompt) {
    return (
      <button type="button" onClick={() => void install()} className={`${look} ${className}`}>
        <Icon name="plus" size={18} />Instalar app
      </button>
    );
  }

  if (iosHint) {
    return (
      <div className={className}>
        <button type="button" onClick={() => setShowIosSteps((value) => !value)} aria-expanded={showIosSteps} className={`${look} w-full`}>
          <Icon name="plus" size={18} />Instalar app
        </button>
        {showIosSteps && (
          <p className="mt-2 rounded-xl bg-mint px-3 py-2 text-sm text-forest-deep" role="status">
            En Safari toca <strong>Compartir</strong> y luego <strong>Agregar a pantalla de inicio</strong>.
          </p>
        )}
      </div>
    );
  }

  return null;
}
