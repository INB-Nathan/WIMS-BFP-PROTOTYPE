Add-Type -AssemblyName System.Net.Http
$rsa = [System.Security.Cryptography.RSA]::Create(4096)
$certReq = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new("CN=localhost,O=WIMS-BFP,C=PH", $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
$eku = [System.Security.Cryptography.X509Certificates.OidCollection]::new()
$eku.Add([System.Security.Cryptography.X509Certificates.Oid]::new("1.3.6.1.5.5.7.3.1")) | Out-Null
$cert = $certReq.CreateSelfSigned([System.DateTimeOffset]::Now, [System.DateTimeOffset]::Now.AddYears(10), $eku)
$keyPem = $rsa.ExportRSAPrivateKeyPem()
$certPem = "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert), [Base64FormattingOptions]::InsertLineBreaks) + "`n-----END CERTIFICATE-----"
Set-Content -Path "E:\WIMS-GIT\WIMS-BFP-PROTOTYPE\src\nginx\certs\nginx.key" -Value $keyPem -NoNewline
Set-Content -Path "E:\WIMS-GIT\WIMS-BFP-PROTOTYPE\src\nginx\certs\nginx.crt" -Value $certPem -NoNewline
Write-Output "Done"
Get-ChildItem "E:\WIMS-GIT\WIMS-BFP-PROTOTYPE\src\nginx\certs"