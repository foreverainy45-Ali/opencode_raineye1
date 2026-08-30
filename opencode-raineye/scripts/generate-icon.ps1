Add-Type -AssemblyName System.Drawing
$size = 128
$bitmap = New-Object System.Drawing.Bitmap($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(18, 16, 28))
$teal = [System.Drawing.Color]::FromArgb(74, 220, 194)
$pen = New-Object System.Drawing.Pen($teal, 7)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$eye = New-Object System.Drawing.Drawing2D.GraphicsPath
$eye.AddBezier(10,64,30,28,98,28,118,64)
$eye.AddBezier(118,64,98,100,30,100,10,64)
$graphics.DrawPath($pen, $eye)
$graphics.DrawEllipse($pen, 48, 48, 32, 32)
$thin = New-Object System.Drawing.Pen($teal, 4)
$thin.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$thin.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($thin, 64, 55, 64, 73)
$graphics.DrawLine($thin, 55, 64, 73, 64)
$graphics.DrawLine($thin, 96, 16, 91, 29)
$graphics.DrawLine($thin, 111, 27, 101, 37)
$graphics.DrawLine($thin, 25, 101, 20, 112)
$bitmap.Save((Join-Path $PSScriptRoot '..\media\icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose(); $bitmap.Dispose()
