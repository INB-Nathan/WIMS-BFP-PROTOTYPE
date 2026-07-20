import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Data Privacy and Retention Policy — WIMS-BFP',
  description: 'Data Privacy and Retention Policy for the WIMS-BFP Web Incident Management System',
};

export default function PrivacyPage() {
  return (
    <div className="ps-has-mesh min-h-screen">
      {/* ── Hero ────────────────────────────────────────────────────── */}
      <header
        className="relative overflow-hidden border-b px-4 py-8 text-center"
        style={{
          background: 'linear-gradient(160deg, var(--bg-elevated), var(--bg-base))',
          borderColor: 'var(--border)',
        }}
      >
        <div
          className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: 'var(--red-bg)', color: 'var(--red-light)' }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-7 h-7"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <p className="mb-1 text-xs uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
          Bureau of Fire Protection
        </p>
        <h1 className="text-[1.625rem] font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
          Data Privacy and Retention Policy
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          WIMS-BFP — Web Incident Management System
        </p>
        <span
          className="mt-3 inline-block rounded-full px-3 py-1 text-[0.675rem] font-medium tracking-wider"
          style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
        >
          Last updated: June 2026
        </span>
      </header>

      {/* ── Card ────────────────────────────────────────────────────── */}
      <main>
        <div className="max-w-3xl mx-auto px-4 -mt-6 pb-8">
          <div
            className="ps-card relative z-10 overflow-hidden shadow-[var(--shadow-soft)]"
            style={{ padding: 0 }}
          >
            <div className="p-6 sm:p-8 space-y-8">

              {/* Section 1 */}
              <Section num={1} title="Applicable Standards">
                <p>This policy is governed by:</p>
                <BulletList
                  items={[
                    'Republic Act 10173 (Data Privacy Act of 2012)',
                    'IRR of RA 10173',
                    'NPC Circular 16-01 (Security of Personal Data in Government Agencies)',
                    'RA 9470 (National Archives of the Philippines Act of 2007)',
                    'NPC guidance on Records of Processing Activities (RoPA)',
                  ]}
                />
              </Section>

              {/* Section 2 */}
              <Section num={2} title="Scope">
                <p>
                  Applies to all personal and sensitive personal information collected,
                  processed, or stored by the WIMS-BFP system, including:
                </p>
                <BulletList
                  items={[
                    'Civilian reporter identifying information (name, contact, device/network metadata)',
                    'Incident data (both sensitive and non-sensitive details tables)',
                    'Authentication session data',
                    'System audit trail entries',
                  ]}
                />
              </Section>

              {/* Section 3 — Consent Notice */}
              <Section num={3} title="Consent Notice">
                <p className="mb-2">
                  Displayed on the WIMS-BFP report page (wimsbfp.tech) before the user
                  starts the report wizard.
                </p>
                <div
                  className="mt-3 rounded-lg border border-l-4 p-4"
                  style={{
                    background: 'var(--yellow-bg)',
                    borderColor: 'var(--yellow)',
                  }}
                >
                  <p
                    className="text-[0.675rem] font-bold uppercase tracking-[0.08em] mb-2"
                    style={{ color: 'var(--yellow-light)' }}
                  >
                    Consent Fineprint
                  </p>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                    By submitting a fire report through this application, you consent to
                    the collection, processing, and retention of your personal data in
                    accordance with this Data Retention Policy. Submission implies
                    agreement — no separate checkbox required. This application operates
                    under the legitimate interest of the Bureau of Fire Protection for
                    incident response, investigation, and national fire statistics in
                    compliance with RA 10173.
                  </p>
                </div>
              </Section>

              {/* Section 4 — Data Categories & Retention */}
              <Section num={4} title="Data Categories &amp; Retention Periods">
                <SubSection title="A. Civilian Reports">
                  <p className="mb-2">
                    <Code>incident_nonsensitive_details</Code> +{' '}
                    <Code>incident_sensitive_details</Code>
                  </p>
                  <Table
                    headers={['Status', 'Retention']}
                    rows={[
                      ['Active / PENDING / UNDER_REVIEW', 'Indefinite (until final disposition)'],
                      ['DISMISSED / FALSE_ALARM', '3 years from disposition date'],
                      ['CONFIRMED / CLOSED', '7 years from closure date (RA 9470 alignment)'],
                    ]}
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Authoritative basis: RA 9470 Sec. 4 (permanent records of significant
                    events); IRR allowable retention for operational necessity.
                  </p>
                </SubSection>

                <SubSection title="B. Civilian Reporter Identifying Data">
                  <p className="mb-2">
                    Email, name, phone in auth / report breadcrumb.
                  </p>
                  <Table
                    headers={['Condition', 'Retention']}
                    rows={[
                      ['Linked to a CONFIRMED incident', '7 years'],
                      ['Linked only to DISMISSED / FALSE_ALARM', '3 years'],
                      [
                        'User requests erasure (DPO process)',
                        'Anonymized within 30 days (Sec. 6, RA 10173)',
                      ],
                    ]}
                  />
                </SubSection>

                <SubSection title="C. Device / Network Metadata">
                  <p className="mb-2">
                    <Code>sender_ip</Code>, <Code>user_agent</Code>, parsed browser / OS / device
                  </p>
                  <BulletList
                    items={[
                      'Retained for the same period as the incident record it is attached to',
                      'Treated as SPI (Sensitive Personal Information) under RA 10173 Sec. 3(b) — IP + UA combination can identify a natural person',
                      'Not stored separately or indefinitely as a profile or tracking set',
                    ]}
                  />
                </SubSection>

                <SubSection title="D. System Audit Trails">
                  <p className="mb-2">
                    <Code>system_audit_trails</Code>
                  </p>
                  <BulletList
                    items={[
                      '7 years (NPC Circular 16-01 recommendation; already enforced by no_delete_audit rule)',
                      'Authoritative basis: RA 9470 for government records management',
                    ]}
                    strongFirst
                  />
                </SubSection>

                <SubSection title="E. Authentication Sessions">
                  <p className="mb-2">Tokens, refresh attempts, Keycloak events</p>
                  <Table
                    headers={['Type', 'Retention']}
                    rows={[
                      ['Active session', 'Until expiry or logout'],
                      ['Failed auth audit entries', '7 years'],
                      ['Successful login audit entries', '3 years'],
                    ]}
                  />
                </SubSection>
              </Section>

              {/* Section 5 */}
              <Section num={5} title="Post-Retention Disposal">
                <p>After the retention period expires:</p>
                <ol
                  className="pl-5 mt-2 space-y-1 text-sm leading-relaxed list-decimal"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <li>
                    Records are soft-deleted (<Code>deleted_at</Code> timestamp) for 6 months
                  </li>
                  <li>
                    Physical / actual deletion follows in the next quarterly purge cycle
                  </li>
                  <li>
                    Audit log of deletion is retained permanently (who deleted, when, record
                    count)
                  </li>
                  <li>
                    No backup archive is retained beyond the primary retention window
                  </li>
                </ol>
              </Section>

              {/* Section 6 */}
              <Section num={6} title="Rights of the Data Subject">
                <p>Reporters may request:</p>
                <BulletList
                  items={[
                    'Access / data portability: copy of their submitted reports and metadata',
                    'Rectification: correction of erroneous incident data',
                    'Erasure: deletion of reporter identity from a record, subject to statutory retention requirements (erasure deferred if record is under active investigation or within mandatory retention window)',
                    'Complaint: to the Bureau\'s Data Protection Officer or directly to the NPC',
                  ]}
                  strongPrefix
                />
                <p className="mt-3">
                  All requests are processed within 30 days by the DPO. The system shall log
                  every request as a <Code>system_audit_trail</Code> entry (7-year retention).
                </p>
              </Section>

              {/* Section 7 */}
              <Section num={7} title="Data Protection Officer (DPO)">
                <BulletList
                  items={[
                    'Role: receives and processes all data subject requests, breach notifications, and retention waiver requests',
                    'Contact: [TO BE ASSIGNED — must be designated per NPC Circular 16-01]',
                    'Review cycle: this retention policy is reviewed annually or after any material system change',
                  ]}
                  strongPrefix
                />
              </Section>

            </div>
          </div>
        </div>
      </main>

      <div className="px-4 pb-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
        <Link href="/" className="font-semibold underline underline-offset-2" style={{ color: 'var(--primary)' }}>
          Return home
        </Link>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Section({
  num,
  title,
  children,
}: {
  num: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2
        className="flex items-center gap-2 text-lg font-bold pb-2 mb-4"
        style={{
          color: 'var(--text-primary)',
          borderBottom: '2px solid var(--red-bg)',
        }}
      >
        <span
          className="inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-bold flex-shrink-0"
          style={{ background: 'var(--red)', color: '#fff' }}
        >
          {num}
        </span>
        {title}
      </h2>
      <div className="text-sm leading-relaxed space-y-2" style={{ color: 'var(--text-secondary)' }}>
        {children}
      </div>
    </section>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="text-[0.95rem] font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function BulletList({
  items,
  strongFirst,
  strongPrefix,
}: {
  items: string[];
  strongFirst?: boolean;
  strongPrefix?: boolean;
}) {
  return (
    <ul className="mt-1 space-y-1">
      {items.map((item, i) => {
        let content: React.ReactNode = item;
        if (strongFirst && i === 0) {
          const match = item.match(/^(\*\*.*?\*\*)(.*)$/);
          if (!match) {
            const boldEnd = item.indexOf(':') > 0 ? item.indexOf(':') + 1 : item.indexOf(' ');
            if (boldEnd > 0) {
              content = (
                <>
                  <strong>{item.slice(0, boldEnd)}</strong>
                  {item.slice(boldEnd)}
                </>
              );
            } else {
              content = <strong>{item}</strong>;
            }
          }
        } else if (strongPrefix) {
          const colonIdx = item.indexOf(':');
          if (colonIdx > 0) {
            content = (
              <>
                <strong>{item.slice(0, colonIdx + 1)}</strong>
                {item.slice(colonIdx + 1)}
              </>
            );
          }
        }
        return (
          <li
            key={i}
            className="relative pl-5 text-sm leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span
              className="absolute left-0 top-[0.6rem] w-1.5 h-1.5 rounded-full"
              style={{ background: 'var(--red)', opacity: 0.7 }}
            />
            {content}
          </li>
        );
      })}
    </ul>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div
      className="overflow-x-auto rounded-lg border my-3"
      style={{ borderColor: 'var(--border)' }}
    >
      <table className="w-full border-collapse text-sm">
        <thead style={{ background: 'var(--bg-surface)' }}>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.05em]"
                style={{
                  color: 'var(--text-primary)',
                  borderBottom: '2px solid var(--border-strong)',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  className="px-4 py-2.5 align-top"
                  style={{
                    color: 'var(--text-secondary)',
                    borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code
      className="text-xs px-1.5 py-0.5 rounded"
      style={{
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        background: 'var(--red-bg)',
        color: 'var(--red-light)',
      }}
    >
      {children}
    </code>
  );
}
