'use client';

import { useEffect, useState } from 'react';
import { listBlockedIps, unblockIp, listBlockedDevices, unblockDevice } from '@/lib/api/securityActions';
import type { BlockedIp, BlockedDevice } from '@/types/api';
import { ShieldAlert, AlertTriangle, RefreshCw } from 'lucide-react';

interface BlockedIpsPanelProps {
  onUnblocked?: () => void;
}

/**
 * BlockedIpsPanel — two-tab blocklist panel: Blocked IPs / Blocked Devices
 * (Wayfinder device abuse controls — issue #571).
 *
 * Aesthetic: Operations-console / SOC triage panel. Serious, authoritative.
 * Repeat-offender (block_count >= 3) rows get a red left danger accent +
 * "Confirmed Attacker" badge. Normal rows get a maroon left accent matching
 * the BFP brand. Unblock is an outline secondary action — visually quieter
 * than primary maroon buttons.
 */
export function BlockedIpsPanel({ onUnblocked }: BlockedIpsPanelProps) {
  const [activeTab, setActiveTab] = useState<'ips' | 'devices'>('ips');

  return (
    <div className="card" data-testid="blocked-ips-panel">
      <div className="card-body">
        <div className="flex items-center gap-1 mb-3" style={{ borderBottom: '1px solid var(--table-header-bg)' }}>
          <button
            data-testid="tab-blocked-ips"
            onClick={() => setActiveTab('ips')}
            className="px-3 py-2 text-xs font-bold tracking-tight transition-colors"
            style={{
              color: activeTab === 'ips' ? 'var(--bfp-maroon)' : 'var(--text-muted)',
              borderBottom: activeTab === 'ips' ? '2px solid var(--bfp-maroon)' : '2px solid transparent',
              marginBottom: '-1px',
            }}
          >
            Blocked IPs
          </button>
          <button
            data-testid="tab-blocked-devices"
            onClick={() => setActiveTab('devices')}
            className="px-3 py-2 text-xs font-bold tracking-tight transition-colors"
            style={{
              color: activeTab === 'devices' ? 'var(--bfp-maroon)' : 'var(--text-muted)',
              borderBottom: activeTab === 'devices' ? '2px solid var(--bfp-maroon)' : '2px solid transparent',
              marginBottom: '-1px',
            }}
          >
            Blocked Devices
          </button>
        </div>

        {activeTab === 'ips' ? (
          <IpBlocklistTab onUnblocked={onUnblocked} />
        ) : (
          <DeviceBlocklistTab onUnblocked={onUnblocked} />
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Blocked IPs tab
// ═══════════════════════════════════════════════════════════════════════════

function IpBlocklistTab({ onUnblocked }: BlockedIpsPanelProps) {
  const [blocks, setBlocks] = useState<BlockedIp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listBlockedIps();
      setBlocks(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to load blocked IPs'
      );
      setBlocks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleUnblock = async (b: BlockedIp) => {
    const expiryLabel = b.is_permanent
      ? 'permanent'
      : b.expires_at
        ? new Date(b.expires_at).toLocaleString('en-PH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'unknown';

    if (
      !window.confirm(
        `Unblock ${b.source_ip} (${b.block_count} block episodes, ${expiryLabel})?`
      )
    ) {
      return;
    }

    try {
      await unblockIp(b.source_ip);
      await load();
      onUnblocked?.();
    } catch {
      // Production: surface via toast. Prototype: silent.
    }
  };

  const handleRetry = () => {
    load();
  };

  function formatExpiry(b: BlockedIp): string {
    if (b.is_permanent) return 'Permanent';
    if (!b.expires_at) return '—';
    const now = Date.now();
    const expiry = new Date(b.expires_at).getTime();
    const remaining = expiry - now;
    if (remaining <= 0) return 'Expired';
    const hours = Math.floor(remaining / 3600_000);
    const minutes = Math.floor((remaining % 3600_000) / 60_000);
    if (hours >= 24) return new Date(b.expires_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  // ── Loading state ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-2">
        <span
          className="inline-block w-4 h-4 rounded-full border-2 animate-spin"
          style={{
            borderColor: 'var(--bfp-maroon)',
            borderTopColor: 'transparent',
          }}
        />
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Loading blocked IPs…
        </span>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────

  if (error) {
    return (
      <div style={{ borderLeft: '3px solid #dc2626' }}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-red-700">
              Unable to load blocked IPs
            </div>
            <div className="text-xs text-red-600 mt-1">{error}</div>
          </div>
          <button
            onClick={handleRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap"
            style={{
              backgroundColor: 'var(--bfp-maroon)',
              color: '#ffffff',
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Empty state ──────────────────────────────────────────────────────

  if (blocks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <ShieldAlert
          className="w-8 h-8 mb-2"
          style={{ color: 'var(--text-muted)' }}
        />
        <div
          className="text-sm font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          No IPs currently blocked.
        </div>
        <div
          className="text-xs mt-1 max-w-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          Blocked IPs from threat-log actions will appear here. All clear
          for now.
        </div>
      </div>
    );
  }

  // ── Blocked IP rows ──────────────────────────────────────────────────

  const repeatOffenderCount = blocks.filter((b) => b.block_count >= 3).length;

  return (
    <div>
      {/* Panel header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldAlert
            className="w-4 h-4"
            style={{ color: 'var(--bfp-maroon)' }}
          />
          <span
            className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded text-[11px] font-bold leading-none"
            style={{
              backgroundColor: 'var(--bfp-maroon)',
              color: '#ffffff',
            }}
          >
            {blocks.length}
          </span>
          {repeatOffenderCount > 0 && (
            <span className="text-[11px] font-semibold text-red-600 ml-1">
              {repeatOffenderCount} repeat offender
              {repeatOffenderCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Row list */}
      <div className="space-y-1.5">
        {blocks.map((b) => {
          const isRepeatOffender = b.block_count >= 3;

          return (
            <div
              key={b.source_ip}
              data-testid="blocked-ip-row"
              data-repeat-offender={isRepeatOffender ? 'true' : 'false'}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors"
              style={{
                backgroundColor: 'var(--table-header-bg)',
                borderLeft: `3px solid ${
                  isRepeatOffender ? '#dc2626' : 'var(--bfp-maroon)'
                }`,
              }}
            >
              {/* Source IP — monospace */}
              <span className="font-mono text-sm font-bold min-w-[8rem]" style={{ color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                {b.source_ip}
              </span>

              {/* Repeat-offender badge */}
              {isRepeatOffender ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold leading-none whitespace-nowrap" style={{ backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                  <AlertTriangle className="w-3 h-3" />
                  Confirmed Attacker
                </span>
              ) : (
                <span
                  className="text-[11px] font-semibold whitespace-nowrap px-2 py-0.5 rounded"
                  style={{
                    backgroundColor: 'rgba(128, 128, 128, 0.1)',
                    color: 'var(--text-muted)',
                  }}
                >
                  {b.block_count} {b.block_count === 1 ? 'episode' : 'episodes'}
                </span>
              )}

              {/* Expiry / Permanent */}
              <span
                className={`text-[11px] font-medium whitespace-nowrap ${
                  b.is_permanent ? 'text-red-600 font-bold' : ''
                }`}
                style={{
                  color: b.is_permanent ? '#dc2626' : 'var(--text-muted)',
                }}
              >
                {formatExpiry(b)}
              </span>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Unblock button — secondary/outline style */}
              <button
                onClick={() => handleUnblock(b)}
                className="px-3 py-1.5 text-[11px] font-semibold rounded-md transition-all whitespace-nowrap border"
                style={{
                  borderColor: 'var(--bfp-maroon)',
                  color: 'var(--bfp-maroon)',
                  backgroundColor: 'transparent',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(128, 0, 0, 0.06)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                Unblock
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Blocked Devices tab (Wayfinder — issue #571)
// ═══════════════════════════════════════════════════════════════════════════

function truncateHash(hash: string, len = 12): string {
  return hash.length > len ? `${hash.slice(0, len)}…` : hash;
}

function truncateUserAgent(ua: string | null, len = 60): string {
  if (!ua) return '—';
  return ua.length > len ? `${ua.slice(0, len)}…` : ua;
}

function DeviceBlocklistTab({ onUnblocked }: BlockedIpsPanelProps) {
  const [blocks, setBlocks] = useState<BlockedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listBlockedDevices();
      setBlocks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load blocked devices');
      setBlocks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleUnblock = async (b: BlockedDevice) => {
    if (
      !window.confirm(
        `Unblock device ${truncateHash(b.device_token_hash)} (${b.block_count} block episodes)?`
      )
    ) {
      return;
    }
    try {
      await unblockDevice(b.device_token_hash);
      await load();
      onUnblocked?.();
    } catch {
      // Production: surface via toast. Prototype: silent.
    }
  };

  function formatExpiry(b: BlockedDevice): string {
    if (b.is_permanent) return 'Permanent';
    if (!b.expires_at) return '—';
    const remaining = new Date(b.expires_at).getTime() - Date.now();
    if (remaining <= 0) return 'Expired';
    const hours = Math.floor(remaining / 3600_000);
    const minutes = Math.floor((remaining % 3600_000) / 60_000);
    if (hours >= 24) {
      return new Date(b.expires_at).toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-2">
        <span
          className="inline-block w-4 h-4 rounded-full border-2 animate-spin"
          style={{ borderColor: 'var(--bfp-maroon)', borderTopColor: 'transparent' }}
        />
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Loading blocked devices…
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ borderLeft: '3px solid #dc2626' }}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-red-700">Unable to load blocked devices</div>
            <div className="text-xs text-red-600 mt-1">{error}</div>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap"
            style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (blocks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <ShieldAlert className="w-8 h-8 mb-2" style={{ color: 'var(--text-muted)' }} />
        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          No devices blocked
        </div>
        <div className="text-xs mt-1 max-w-xs" style={{ color: 'var(--text-muted)' }}>
          Blocked devices from threat-log actions will appear here. All clear for now.
        </div>
      </div>
    );
  }

  const repeatOffenderCount = blocks.filter((b) => b.block_count >= 3).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" style={{ color: 'var(--bfp-maroon)' }} />
          <span
            className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded text-[11px] font-bold leading-none"
            style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
          >
            {blocks.length}
          </span>
          {repeatOffenderCount > 0 && (
            <span className="text-[11px] font-semibold text-red-600 ml-1">
              {repeatOffenderCount} repeat offender{repeatOffenderCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        {blocks.map((b) => {
          const isRepeatOffender = b.block_count >= 3;

          return (
            <div
              key={b.device_token_hash}
              data-testid="blocked-device-row"
              data-repeat-offender={isRepeatOffender ? 'true' : 'false'}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors"
              style={{
                backgroundColor: 'var(--table-header-bg)',
                borderLeft: `3px solid ${isRepeatOffender ? '#dc2626' : 'var(--bfp-maroon)'}`,
              }}
            >
              <span
                className="font-mono text-sm font-bold min-w-[8rem]"
                style={{ color: 'var(--text-primary)', letterSpacing: '-0.01em' }}
                title={b.device_token_hash}
              >
                {truncateHash(b.device_token_hash)}
              </span>

              <span
                className="text-[11px] whitespace-nowrap max-w-[16rem] truncate"
                style={{ color: 'var(--text-muted)' }}
                title={b.user_agent ?? undefined}
              >
                {truncateUserAgent(b.user_agent)}
              </span>

              {b.authenticated_user_id && (
                <span
                  className="text-[11px] font-semibold whitespace-nowrap px-2 py-0.5 rounded"
                  style={{ backgroundColor: 'rgba(128, 128, 128, 0.1)', color: 'var(--text-muted)' }}
                >
                  user: {b.authenticated_user_id.slice(0, 8)}
                </span>
              )}

              {isRepeatOffender ? (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold leading-none whitespace-nowrap"
                  style={{ backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}
                >
                  <AlertTriangle className="w-3 h-3" />
                  Confirmed Attacker
                </span>
              ) : (
                <span
                  className="text-[11px] font-semibold whitespace-nowrap px-2 py-0.5 rounded"
                  style={{ backgroundColor: 'rgba(128, 128, 128, 0.1)', color: 'var(--text-muted)' }}
                >
                  {b.block_count} {b.block_count === 1 ? 'episode' : 'episodes'}
                </span>
              )}

              <span
                className={`text-[11px] font-medium whitespace-nowrap ${b.is_permanent ? 'text-red-600 font-bold' : ''}`}
                style={{ color: b.is_permanent ? '#dc2626' : 'var(--text-muted)' }}
              >
                {formatExpiry(b)}
              </span>

              <div className="flex-1" />

              <button
                onClick={() => handleUnblock(b)}
                className="px-3 py-1.5 text-[11px] font-semibold rounded-md transition-all whitespace-nowrap border"
                style={{ borderColor: 'var(--bfp-maroon)', color: 'var(--bfp-maroon)', backgroundColor: 'transparent' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(128, 0, 0, 0.06)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                title={`Unblock device ${truncateHash(b.device_token_hash)}`}
              >
                Unblock
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
