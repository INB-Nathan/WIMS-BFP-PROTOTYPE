"use client";

interface Props {
  selectedCount: number;
  onClose: () => void;
  onConfirm: () => void;
}

export function BulkApproveConfirmModal({ selectedCount, onClose, onConfirm }: Props) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Confirm Bulk Approve</h2>
        <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
          Approve {selectedCount} incident{selectedCount !== 1 ? "s" : ""}? This will set them to VERIFIED and cannot be undone without an explicit rejection.
        </p>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm rounded-lg text-white" style={{ backgroundColor: '#16A34A' }}>
            Confirm ({selectedCount})
          </button>
        </div>
      </div>
    </div>
  );
}
