'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'wims:install_dismissed';

export function PwaInstallPrompt() {
  const { user } = useAuth();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(DISMISSED_KEY)) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Only show for the field encoder role — they need offline capability most
  const role = (user as { role?: string } | null)?.role;
  if (role !== 'REGIONAL_ENCODER') return null;
  if (!visible || !deferredPrompt) return null;

  const handleInstall = async () => {
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'dismissed') {
        localStorage.setItem(DISMISSED_KEY, '1');
      }
    } catch {
      // prompt() can throw if called twice or in an invalid state — safe to ignore
    }
    setVisible(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setVisible(false);
  };

  return (
    <div
      role="banner"
      className="flex items-center gap-3 border-b border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900"
    >
      <Download className="h-4 w-4 flex-shrink-0 text-blue-600" aria-hidden />
      <span className="flex-1">
        Install WIMS-BFP for offline field encoding — works without internet.
      </span>
      <button
        onClick={handleInstall}
        className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 flex-shrink-0"
      >
        Install
      </button>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss install prompt"
        className="text-blue-500 hover:text-blue-800 flex-shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
