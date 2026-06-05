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
        Remove-Item $filePath -Force
        Write-Output "Deleted (will be recreated clean): $filePath"
    }
}

Write-Output "Done. Open http://localhost in your browser."
