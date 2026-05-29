$cert = New-SelfSignedCertificate -DnsName 'localhost','127.0.0.1' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 4096 -KeyExportPolicy Exportable -NotAfter (Get-Date).AddYears(10)
$pwd = ConvertTo-SecureString -String "wims-dev" -Force -AsPlainText
$cert | Export-PfxCertificate -FilePath "src/nginx/certs/nginx.pfx" -Password $pwd | Out-Null
Export-Certificate -Type CERT -Cert $cert -FilePath "src/nginx/certs/nginx.crt" | Out-Null
Write-Output "PEM cert exported"
$c = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -like "*localhost*" } | Select-Object -First 1
$rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($c)
$bytes = $rsa.Key.ExportRSAPrivateKey()
$pem = "-----BEGIN RSA PRIVATE KEY-----`n" + [Convert]::ToBase64String($bytes, [Base64FormattingOptions]::InsertLineBreaks) + "`n-----END RSA PRIVATE KEY-----"
Set-Content -Path "src/nginx/certs/nginx.key" -Value $pem -NoNewline
Write-Output "Key exported"
Get-ChildItem "src/nginx/certs"