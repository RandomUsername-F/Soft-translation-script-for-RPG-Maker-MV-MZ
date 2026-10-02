$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# NOTE: this script intentionally avoids Test-Path / Get-Content / Set-Content /
# Copy-Item / Remove-Item / Get-ChildItem. Those cmdlets treat "[" and "]" in a
# path as wildcard characters, so any game folder or title containing brackets
# (common in Japanese releases, e.g. "【体験版】") silently fails to match even
# though the file exists. The [System.IO] methods below take literal paths and
# never do wildcard expansion, and reads/writes are explicit UTF-8 so Unicode /
# Japanese text in plugins.js or translation.json is not corrupted by the
# system's default (e.g. Shift-JIS) codepage.
#
# js/plugins.js is edited surgically: we locate only our own "Translation"
# entry (by scanning for its top-level JSON object) and splice it in or out
# as raw text. We never parse-and-reserialize the whole plugin array, so
# every other installed plugin's entry is left completely untouched — a
# full round-trip through ConvertFrom-Json/ConvertTo-Json can silently
# reformat or corrupt other plugins' parameter data, which is a much worse
# problem than anything this plugin needs to solve.

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Find-EngineBase($root) {
    $checks = @(
        @{ Base = $root;                   Rel = 'js\rmmz_core.js'; Engine = 'MZ' },
        @{ Base = $root;                   Rel = 'js\rpg_core.js';  Engine = 'MV' },
        @{ Base = (Join-Path $root 'www'); Rel = 'js\rmmz_core.js'; Engine = 'MZ' },
        @{ Base = (Join-Path $root 'www'); Rel = 'js\rpg_core.js';  Engine = 'MV' }
    )
    foreach ($c in $checks) {
        $full = Join-Path $c.Base $c.Rel
        if ([System.IO.File]::Exists($full)) {
            return @{ Base = $c.Base; Engine = $c.Engine }
        }
    }

    # Fallback: find the .exe, then infer layout from folder structure.
    $exeFound = $false
    if ([System.IO.Directory]::Exists($root)) {
        $exes = [System.IO.Directory]::GetFiles($root, '*.exe')
        if ($exes.Length -gt 0) { $exeFound = $true }
    }
    if ($exeFound) {
        $wwwPath = Join-Path $root 'www'
        $jsPath  = Join-Path $root 'js'
        if ([System.IO.Directory]::Exists($wwwPath)) {
            return @{ Base = $wwwPath; Engine = 'MV' }
        } elseif ([System.IO.Directory]::Exists($jsPath)) {
            return @{ Base = $root; Engine = 'MZ' }
        }
    }

    return $null
}

# Returns the start/end (inclusive) character offsets, within $innerText,
# of every top-level {...} object — i.e. each plugin entry in the array.
# Brace/bracket depth is tracked while ignoring anything inside JSON string
# literals (including escaped quotes), so this is safe even if a plugin's
# own description or parameters contain "{", "}", "[" or "]" characters.
function Get-TopLevelObjects($innerText) {
    $objects = New-Object System.Collections.Generic.List[Object]
    $depth = 0
    $inString = $false
    $escaped = $false
    $objStart = -1
    for ($i = 0; $i -lt $innerText.Length; $i++) {
        $ch = $innerText[$i]
        if ($inString) {
            if ($escaped) { $escaped = $false }
            elseif ($ch -eq '\') { $escaped = $true }
            elseif ($ch -eq '"') { $inString = $false }
            continue
        }
        if ($ch -eq '"') { $inString = $true; continue }
        if ($ch -eq '{' -or $ch -eq '[') {
            if ($depth -eq 0 -and $ch -eq '{') { $objStart = $i }
            $depth++
        } elseif ($ch -eq '}' -or $ch -eq ']') {
            $depth--
            if ($depth -eq 0 -and $ch -eq '}' -and $objStart -ge 0) {
                $objects.Add([PSCustomObject]@{ Start = $objStart; End = $i })
                $objStart = -1
            }
        }
    }
    return $objects
}

try {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $gameRoot  = Split-Path -Parent $scriptDir

    $result = Find-EngineBase $gameRoot
    if (-not $result) {
        throw 'Could not detect an RPG Maker MV or MZ game next to this folder. Make sure "_translation" sits in the same directory as the game executable.'
    }

    $base   = $result.Base
    $engine = $result.Engine
    Write-Host "Detected RPG Maker $engine game at: $base"

    $pluginsDir = Join-Path $base 'js\plugins'
    $pluginsJs  = Join-Path $base 'js\plugins.js'
    $pluginFile = Join-Path $pluginsDir 'Translation.js'
    $srcPlugin  = Join-Path $scriptDir 'Translation.js'
    $backupFile = Join-Path $base 'js\plugins.js.bak'

    if (-not [System.IO.File]::Exists($pluginsJs)) {
        throw 'js\plugins.js not found. This does not look like a valid game folder.'
    }

    $raw = [System.IO.File]::ReadAllText($pluginsJs, [System.Text.Encoding]::UTF8)
    $startIdx = $raw.IndexOf('[')
    $endIdx   = $raw.LastIndexOf(']')
    if ($startIdx -lt 0 -or $endIdx -lt $startIdx) {
        throw 'Could not find the plugin list inside js\plugins.js.'
    }

    $innerText = $raw.Substring($startIdx + 1, $endIdx - $startIdx - 1)
    $objects = Get-TopLevelObjects $innerText

    $ourObj = $null
    foreach ($o in $objects) {
        $text = $innerText.Substring($o.Start, $o.End - $o.Start + 1)
        if ($text -match '"name"\s*:\s*"Translation"') {
            $ourObj = $o
            break
        }
    }

    # One-time backup of the pristine file, made before this plugin ever
    # touches it. Never overwritten, so it's always a safe restore point.
    if (-not [System.IO.File]::Exists($backupFile)) {
        [System.IO.File]::Copy($pluginsJs, $backupFile, $false)
    }

    if ($ourObj) {
        Write-Host ''
        Write-Host 'Translation plugin is currently INSTALLED.'
        $answer = Read-Host 'Uninstall it? (y/n)'
        if ($answer -eq 'y') {
            $absStart = $startIdx + 1 + $ourObj.Start
            $absEnd   = $startIdx + 1 + $ourObj.End

            # Remove one adjacent comma along with our entry: prefer the
            # comma that follows it, or the one before it if ours is last.
            $after = $absEnd + 1
            while ($after -lt $raw.Length -and [char]::IsWhiteSpace($raw[$after])) { $after++ }
            if ($after -lt $raw.Length -and $raw[$after] -eq ',') {
                $removeStart = $absStart
                $removeEnd   = $after
            } else {
                $before = $absStart - 1
                while ($before -ge 0 -and [char]::IsWhiteSpace($raw[$before])) { $before-- }
                if ($before -ge 0 -and $raw[$before] -eq ',') {
                    $removeStart = $before
                } else {
                    $removeStart = $absStart
                }
                $removeEnd = $absEnd
            }

            $newRaw = $raw.Substring(0, $removeStart) + $raw.Substring($removeEnd + 1)
            [System.IO.File]::WriteAllText($pluginsJs, $newRaw, $Utf8NoBom)
            if ([System.IO.File]::Exists($pluginFile)) { [System.IO.File]::Delete($pluginFile) }
            Write-Host 'Translation plugin uninstalled.'
        } else {
            Write-Host 'Cancelled.'
        }
    } else {
        Write-Host ''
        Write-Host 'Translation plugin is NOT installed.'
        $answer = Read-Host 'Install it now? (y/n)'
        if ($answer -eq 'y') {
            if (-not [System.IO.Directory]::Exists($pluginsDir)) {
                [System.IO.Directory]::CreateDirectory($pluginsDir) | Out-Null
            }
            [System.IO.File]::Copy($srcPlugin, $pluginFile, $true)

            $entryJson = '{"name":"Translation","status":true,"description":"Soft translation loader","parameters":{}}'

            if ($objects.Count -gt 0) {
                $lastObj = $objects[$objects.Count - 1]
                $insertPos = $startIdx + 1 + $lastObj.End + 1
                $insertText = ",`n" + $entryJson
            } else {
                $insertPos = $startIdx + 1
                $insertText = "`n" + $entryJson + "`n"
            }

            $newRaw = $raw.Substring(0, $insertPos) + $insertText + $raw.Substring($insertPos)
            [System.IO.File]::WriteAllText($pluginsJs, $newRaw, $Utf8NoBom)
            Write-Host 'Translation plugin installed. Launch the game to see translated text.'
        } else {
            Write-Host 'Cancelled.'
        }
    }
} catch {
    Write-Host ''
    Write-Host 'ERROR:' -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.InvocationInfo -and $_.InvocationInfo.ScriptLineNumber) {
        Write-Host ("At line " + $_.InvocationInfo.ScriptLineNumber)
    }
} finally {
    Write-Host ''
    Read-Host 'Press Enter to exit'
}
