# Hlasky casovace: texty z assets/zvuk/hlasky.json -> WAV ceskym hlasem Windows (OneCore, napr. Jakub).
# Spusteni z korene repa:   powershell -File scripts\hlasky.ps1
# Kazdy klic v JSON = jeden soubor assets/zvuk/<klic>.wav (16 bit mono, ticho na krajich orezane,
# zesilene s mekkym omezenim, aby hlas bylo slyset pres hudbu). Soubor je schvalne bez diakritiky
# (Windows PowerShell 5.1 cte skripty bez BOM jako ANSI); texty hlasek jsou v JSON v UTF-8.
param(
    [string]$Slozka = (Join-Path $PSScriptRoot "..\assets\zvuk"),
    [string]$Jazyk = "cs-CZ",
    [double]$Sila = 2.5          # zesileni pred mekkym omezenim (1 = skoro bez zmeny)
)
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq "AsTask" -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Wait-Operace($op, [Type]$typ) {
    $t = $asTask.MakeGenericMethod($typ).Invoke($null, @($op)); $t.Wait(); $t.Result
}

$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$hlas = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -eq $Jazyk } | Select-Object -First 1
if (-not $hlas) { throw "Hlas pro $Jazyk neni ve Windows nainstalovany (Nastaveni > Cas a jazyk > Rec)." }
$synth.Voice = $hlas
"Hlas: " + $hlas.DisplayName

$texty = Get-Content (Join-Path $Slozka "hlasky.json") -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($p in $texty.PSObject.Properties) {
    $stream = Wait-Operace ($synth.SynthesizeTextToStreamAsync($p.Value)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
    $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
    [void](Wait-Operace ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]))
    $b = New-Object byte[] ([int]$stream.Size)
    $reader.ReadBytes($b)

    # --- hlavicka WAV: najdi bloky "fmt " a "data"
    $pos = 12; $kanaly = 0; $rate = 0; $bity = 0; $od = 0; $delka = 0
    while ($pos + 8 -le $b.Length) {
        $id = [Text.Encoding]::ASCII.GetString($b, $pos, 4); $vel = [BitConverter]::ToUInt32($b, $pos + 4)
        if ($id -eq "fmt ") { $kanaly = [BitConverter]::ToUInt16($b, $pos + 10); $rate = [BitConverter]::ToUInt32($b, $pos + 12); $bity = [BitConverter]::ToUInt16($b, $pos + 22) }
        if ($id -eq "data") { $od = $pos + 8; $delka = [Math]::Min([long]$vel, [long]($b.Length - $od)); break }
        $pos += 8 + $vel + ($vel % 2)
    }
    if ($kanaly -ne 1 -or $bity -ne 16 -or $delka -le 0) { throw "Necekany format WAV ($kanaly kan., $bity bit) u '$($p.Name)'." }

    # --- vzorky, orez ticha, zesileni s mekkym omezenim (tanh), kratky nabeh a dobeh
    $n = [int]($delka / 2); $s = New-Object double[] $n; $spicka = 1.0
    for ($i = 0; $i -lt $n; $i++) { $v = [BitConverter]::ToInt16($b, $od + 2 * $i); $s[$i] = $v; if ([Math]::Abs($v) -gt $spicka) { $spicka = [Math]::Abs($v) } }
    $prah = $spicka * 0.02; $a = 0; $z = $n - 1
    while ($a -lt $n -and [Math]::Abs($s[$a]) -lt $prah) { $a++ }
    while ($z -gt $a -and [Math]::Abs($s[$z]) -lt $prah) { $z-- }
    $a = [Math]::Max(0, $a - [int]($rate * 0.01)); $z = [Math]::Min($n - 1, $z + [int]($rate * 0.05))
    $m = $z - $a + 1; $nabeh = [int]($rate * 0.005); $norma = [Math]::Tanh($Sila)

    $soubor = Join-Path $Slozka ($p.Name + ".wav")
    $w = New-Object IO.BinaryWriter([IO.File]::Create($soubor))
    $w.Write([Text.Encoding]::ASCII.GetBytes("RIFF")); $w.Write([uint32](36 + 2 * $m)); $w.Write([Text.Encoding]::ASCII.GetBytes("WAVEfmt "))
    $w.Write([uint32]16); $w.Write([uint16]1); $w.Write([uint16]1); $w.Write([uint32]$rate); $w.Write([uint32]($rate * 2)); $w.Write([uint16]2); $w.Write([uint16]16)
    $w.Write([Text.Encoding]::ASCII.GetBytes("data")); $w.Write([uint32](2 * $m))
    for ($i = 0; $i -lt $m; $i++) {
        $y = [Math]::Tanh($Sila * $s[$a + $i] / $spicka) / $norma * 0.97
        if ($i -lt $nabeh) { $y *= $i / $nabeh } elseif ($m - 1 - $i -lt $nabeh) { $y *= ($m - 1 - $i) / $nabeh }
        $w.Write([int16][Math]::Round($y * 32767))
    }
    $w.Close()
    "{0,-10} {1,5:N2} s  {2,4:N0} kB  {3} Hz  '{4}'" -f $p.Name, ($m / $rate), ((Get-Item $soubor).Length / 1kb), $rate, $p.Value
}
