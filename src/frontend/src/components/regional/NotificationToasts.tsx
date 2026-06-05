"use client";

import { X } from "lucide-react";

interface Props {
  pendingActionedBanner: boolean;
  rejectedCount: number;
  rejectionNoticeDismissed: boolean;
  onDismissPendingActioned: () => void;
  onRefreshAndDismiss: () => void;
  onDismissRejection: () => void;
  onShowRejected: () => void;
}

export function NotificationToasts({
  pendingActionedBanner,
  rejectedCount,
  rejectionNoticeDismissed,
  onDismissPendingActioned,
  onRefreshAndDismiss,
  onDismissRejection,
  onShowRejected,
}: Props) {
  if (!pendingActionedBanner && !(rejectedCount > 0 && !rejectionNoticeDismissed)) return null;

  return (
    <div className="sticky top-0 z-40 space-y-2">
      {pendingActionedBanner && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 shadow-md" role="alert">
          <span>
            <span className="font-semibold">A pending submission was actioned by a validator.</span>{' '}
            Refresh to see what changed.
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={onRefreshAndDismiss}
              className="rounded-lg px-3 py-1 text-xs font-semibold text-white"
              style={{ backgroundColor: '#1D4ED8' }}
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={onDismissPendingActioned}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-blue-700 transition-colors hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-300"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      )}
      {rejectedCount > 0 && !rejectionNoticeDismissed && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-md" role="alert">
          <div>
            <span className="font-semibold">
              {rejectedCount} incident{rejectedCount > 1 ? 's were' : ' was'} rejected by a validator.
            </span>{' '}
            Review the rejection reasons and resubmit.{' '}
            <button
              type="button"
              className="ml-1 underline font-medium hover:text-red-700"
              onClick={onShowRejected}
            >
              Show rejected
            </button>
          </div>
          <button
            type="button"
            onClick={onDismissRejection}
            className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-red-700 transition-colors hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-300"
            aria-label="Dismiss rejection notice"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
