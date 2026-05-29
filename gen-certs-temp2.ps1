$cert = New-SelfSignedCertificate -DnsName "localhost","127.0.0.1" -CertStoreLocation "Cert:\CurrentUser\My" -KeyAlgorithm RSA -KeyLength 4096 -KeyExportPolicy Exportable -NotAfter (Get-Date).AddYears(10)
$securePassword = ConvertTo-SecureString -String "wims-dev" -Force -AsPlainText
$cert | Export-PfxCertificate -FilePath "E:\WIMS-GIT\WIMS-BFP-PROTOTYPE\src\nginx\certs\nginx.pfx" -Password $securePassword | Out-Null
Export-Certificate -Type CERT -Cert $cert -FilePath "E:\WIMS-GIT\WIMS-BFP-PROTOTYPE\src\nginx\certs\nginx.crt" | Out-Null
Write-Output "Exported cert and pfx"

$cert2 = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -like "*localhost*" } | Select-Object -First 1
$rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert2)
$cng = $rsa -as [System.Security.Cryptography.RSACng]
$keyBytes = $cng.Key.ExportRSAPrivateKey()
$pem = "-----BEGIN RSA PRIVATE KEY-----`n" + [Convert]::ToBase64String($keyBytes, [Base64FormattingOptions]::InsertLineBreaks) + "`n-----END RSA PRIVATE KEY-----"
Set-Content -Path "E:\WIMS-GIT\WIMS-BFP-PROTOTYPE\src\nginx\certs\nginx.key" -Value $pem -NoNewline
Write-Output "Key exported via RSACng"
Get-ChildItem "E:\WIMS-GIT\WIMS-BFP-PROTOTYPE\src\nginx\certs"