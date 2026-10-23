# The Clerk, an add-on for Godspeed Mission Control: the installer for Windows.
#
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/MichaelZelbel/godspeed-clerk/main/install.ps1))) --paperless https://paperless.example --user <your account>
#
# On Windows the Clerk works with a Paperless that already runs somewhere (a home server, a NAS):
# installing Paperless itself is for a Linux server (install.sh).
#
# What it does:
#   1. Finds Node.js 22 or newer: on the PATH, the one Godspeed Mission Control brings
#      (%LOCALAPPDATA%\Godspeed Mission Control*\payload\runtime), the Node that Hermes brings
#      (%LOCALAPPDATA%\hermes\node), or C:\Program Files\nodejs. It installs nothing of its own.
#   2. Downloads the newest release of the Clerk from GitHub (main, when there is no release yet)
#      into a temporary folder. GODSPEED_CLERK_REF=<tag or branch> picks another one.
#   3. Runs the Clerk's setup with your options. The setup copies the program to
#      %USERPROFILE%\.godspeed\addons\godspeed-clerk, adds the godspeed-clerk command to
#      %USERPROFILE%\.godspeed\bin, makes the private folder %USERPROFILE%\.godspeed\clerk, connects
#      to your Paperless (reading only, nothing in it changes), names the AI that will read your
#      documents, and adds the scheduled task "Godspeed Clerk" that starts the worker when you log in.
#      The Clerk starts paused.
#   4. Deletes the temporary folder.
#
# What it asks: your Paperless password, once, to read the account's existing key (it is not kept).
# PAPERLESS_PASSWORD in the environment answers it.
#
# Safe to run again: it is also the update. To take it out: godspeed-clerk uninstall

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $Repo = 'MichaelZelbel/godspeed-clerk'
  $setupArgs = @($args)

  function Say([string]$text) { Write-Host $text }
  function Fail([string]$text) { Write-Host $text -ForegroundColor Red }

  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

  # 1. Node.js 22 or newer.
  function NodeMajor([string]$exe) {
    try {
      $v = (& $exe --version 2>$null | Select-Object -First 1)
      if ($v -match '^v(\d+)\.') { return [int]$Matches[1] }
    } catch { }
    return 0
  }
  $local = $env:LOCALAPPDATA
  if (-not $local) { $local = Join-Path $env:USERPROFILE 'AppData\Local' }
  $candidates = New-Object System.Collections.Generic.List[string]
  $onPath = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($onPath) { $candidates.Add($onPath.Source) }
  Get-ChildItem -Path $local -Directory -Filter 'Godspeed Mission Control*' -ErrorAction SilentlyContinue | ForEach-Object {
    $candidates.Add((Join-Path $_.FullName 'payload\runtime\node.exe'))
  }
  $candidates.Add((Join-Path $local 'hermes\node\node.exe'))
  if ($env:USERPROFILE) {
    Get-ChildItem -Path (Join-Path $env:USERPROFILE '.hermes\tools') -Directory -Filter 'node-*' -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending | ForEach-Object { $candidates.Add((Join-Path $_.FullName 'node.exe')) }
  }
  if ($env:ProgramFiles) { $candidates.Add((Join-Path $env:ProgramFiles 'nodejs\node.exe')) }
  $node = $null
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c -PathType Leaf) -and ((NodeMajor $c) -ge 22)) { $node = $c; break }
  }
  if (-not $node) {
    Fail 'The Clerk needs Node.js 22 or newer, and none was found on this computer.'
    Say 'Install Godspeed Mission Control first (it brings its own Node), or Node.js LTS from https://nodejs.org'
    Say '(or in PowerShell: winget install OpenJS.NodeJS.LTS), then run this line again in a new window.'
    return
  }

  # 2. The newest release, or main.
  $ref = $env:GODSPEED_CLERK_REF
  if (-not $ref) {
    try {
      $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'godspeed-clerk-installer' } -TimeoutSec 30
      $ref = $rel.tag_name
    } catch { $ref = $null }
    if (-not $ref) { $ref = 'main' }
  }

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("godspeed-clerk-" + [Guid]::NewGuid().ToString('N').Substring(0, 12))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $zip = Join-Path $tmp 'clerk.zip'
    try {
      Invoke-WebRequest -Uri "https://codeload.github.com/$Repo/zip/$ref" -OutFile $zip -UseBasicParsing -TimeoutSec 120
    } catch {
      Fail "Could not download the Clerk ($ref) from GitHub: $($_.Exception.Message)"
      Say 'Check the internet connection and run this line again.'
      return
    }
    $unpacked = Join-Path $tmp 'src'
    Expand-Archive -LiteralPath $zip -DestinationPath $unpacked -Force
    $pkg = Get-ChildItem -LiteralPath $unpacked -Directory | Select-Object -First 1
    $script = if ($pkg) { Join-Path $pkg.FullName 'bin\godspeed-clerk.mjs' } else { $null }
    if (-not $script -or -not (Test-Path -LiteralPath $script)) {
      Fail 'The download did not hold the Clerk. Run this line again in a few minutes.'
      return
    }
    Say "The Clerk ($ref), with Node $(& $node --version) at $node"

    # 3. The setup (the scheduled task is ended and started again by it, so an update takes effect).
    & $node $script setup @setupArgs
    if ($LASTEXITCODE -ne 0) {
      Fail "The setup stopped (exit $LASTEXITCODE). What it printed above says why; run this line again once that is fixed."
      return
    }
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
