# Fix: Cannot access http://localhost (only port 8090 works)

## Problem

Chrome and Edge cache HSTS (HTTP Strict Transport Security) for `localhost`, forcing every
request to upgrade to HTTPS. Since the WIMS dev stack only serves plain HTTP on port 80,
the browser rejects the connection. Port 8090 works because it is not in the HSTS cache.

This happens silently — the browser shows a connection error with no explanation.

## Automated fix (run as AI or paste into PowerShell)

Close Edge/Chrome first, then run this script:

```powershell
# Fix-LocalhostHSTS.ps1
# Removes the localhost HSTS entry from Edge and Chrome so http://localhost works again.
# REQUIRES: Edge and Chrome must be fully closed before running.

$browserProfiles = @(
    "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Network\TransportSecurity",
    "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\TransportSecurity",
    "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Network\TransportSecurity"
)

foreach ($filePath in $browserProfiles) {
    if (-not (Test-Path $filePath)) { continue }

    $raw = Get-Content $filePath -Raw -ErrorAction SilentlyContinue
    if (-not $raw) { continue }

    try {
        $data = $raw | ConvertFrom-Json
    } catch {
        Write-Warning "Could not parse $filePath — skipping"
        continue
    }

    # HSTS entries are keyed by a hash of the domain name, not the domain itself.
    # The easiest safe approach: remove any entry whose value contains "localhost"
    # (Edge/Chrome store the host in a 'host' sub-field on some versions).
    # Fall back to wiping the whole file if the structure is opaque.
    $props = $data.PSObject.Properties
    $removed = 0
    foreach ($prop in @($props)) {
        $val = $prop.Value | ConvertTo-Json -Compress -ErrorAction SilentlyContinue
        if ($val -match '"localhost"') {
            $data.PSObject.Properties.Remove($prop.Name)
            $removed++
        }
    }

    if ($removed -gt 0) {
        $data | ConvertTo-Json -Depth 10 | Set-Content $filePath -Encoding utf8
        Write-Output "Removed $removed localhost HSTS entry/entries from: $filePath"
    } else {
        # Hash-keyed format — safest fix is to delete the whole file; browser recreates it clean.
        Remove-Item $filePath -Force
        Write-Output "Deleted (will be recreated clean): $filePath"
    }
}

Write-Output "Done. Open http://localhost in your browser."
```

## Quick manual fix (browser UI)

1. Open **Edge** → `edge://net-internals/#hsts`  
   **or Chrome** → `chrome://net-internals/#hsts`
2. Scroll to **"Delete domain security policies"**
3. Type `localhost` → click **Delete**
4. Open `http://localhost`

## Permanent workaround (no fix needed)

Use **http://localhost:8090** — nginx forwards it to the same app. Port 8090 is never
added to the HSTS cache so it always works.

## Why this keeps happening

Some pages on the stack (or a prior Keycloak redirect) send a
`Strict-Transport-Security` response header, which tells the browser to always use HTTPS
for `localhost`. The next fresh browser session reads that cached policy and blocks HTTP.

## WIMS dev stack ports

| URL | Service |
|---|---|
| `http://localhost` | Main app (may need HSTS fix) |
| `http://localhost:8090` | Main app (always works) |
| `http://localhost/auth` | Keycloak admin console |
| `http://localhost:8025` | Mailhog (email testing) |
