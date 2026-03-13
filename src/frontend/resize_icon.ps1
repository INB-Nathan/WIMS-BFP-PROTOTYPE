
Add-Type -AssemblyName System.Drawing
$inputFile = "C:\Users\Earl\Documents\WIMS-BFP\frontend\public\bfp-logo.png"
$outputFile = "C:\Users\Earl\Documents\WIMS-BFP\frontend\public\apple-touch-icon.png"

if (-not (Test-Path $inputFile)) {
    Write-Host "Input file not found!"
    exit 1
}

try {
    $img = [System.Drawing.Image]::FromFile($inputFile)
    $newImg = new-object System.Drawing.Bitmap(180, 180)
    $g = [System.Drawing.Graphics]::FromImage($newImg)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($img, 0, 0, 180, 180)
    $newImg.Save($outputFile, [System.Drawing.Imaging.ImageFormat]::Png)
    
    $img.Dispose()
    $newImg.Dispose()
    $g.Dispose()
    Write-Host "Success: Created $outputFile"
} catch {
    Write-Host "Error: $_"
    exit 1
}
