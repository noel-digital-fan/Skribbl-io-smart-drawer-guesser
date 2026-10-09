param([string]$Source = (Join-Path $PSScriptRoot '..\assets\quill-source.png'))

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceImage = [Drawing.Image]::FromFile([IO.Path]::GetFullPath($Source))
try {
    foreach ($size in @(16, 32, 48, 128)) {
        $bitmap = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try {
            # Small toolbar sizes need area filtering; larger icons keep the pixel edges crisp.
            $graphics.InterpolationMode = if ($size -le 32) {
                [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            } else {
                [Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
            }
            $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::Half
            $graphics.DrawImage($sourceImage, [Drawing.Rectangle]::new(0, 0, $size, $size))
            $bitmap.Save((Join-Path $projectRoot "icon$size.png"), [Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
} finally {
    $sourceImage.Dispose()
}
