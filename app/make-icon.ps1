# app/make-icon.ps1
# Gera o icone do aplicativo a partir do icon.png da raiz do projeto:
#   app/icon.ico  icone do .exe (16 a 256 px), usado pelo npm run build
#   app/icon.png  256 px, usado na janela do painel
# A imagem e centralizada num quadrado transparente, sem distorcer.
# Rode de novo sempre que trocar o icon.png:
#   powershell -ExecutionPolicy Bypass -File app\make-icon.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "icon.png"
if (-not (Test-Path $source)) { throw "Nao achei $source" }
$image = [System.Drawing.Image]::FromFile($source)

function New-SquarePng([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $scale = [math]::Min($size / $image.Width, $size / $image.Height)
    $w = [int][math]::Round($image.Width * $scale)
    $h = [int][math]::Round($image.Height * $scale)
    $g.DrawImage($image, [int](($size - $w) / 2), [int](($size - $h) / 2), $w, $h)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return , $ms.ToArray()
}

# .ico com uma imagem PNG por tamanho
$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = $sizes | ForEach-Object { , (New-SquarePng $_) }
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($out)
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }   # 0 quer dizer 256
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$pngs[$i].Length); $w.Write([uint32]$offset)
    $offset += $pngs[$i].Length
}
foreach ($png in $pngs) { $w.Write($png) }
$w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot "icon.ico"), $out.ToArray())
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot "icon.png"), (New-SquarePng 256))
$image.Dispose()

"Gerados: app\icon.ico ($($sizes -join ', ') px, $([math]::Round($out.Length / 1KB)) KB) e app\icon.png (256 px)"
