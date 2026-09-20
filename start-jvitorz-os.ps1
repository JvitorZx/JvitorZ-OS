$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendRoot = Join-Path $projectRoot 'backend'
$frontendRoot = Join-Path $projectRoot 'frontend'

function Test-LocalPort {
    param([int]$Port)

    return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

if (-not (Test-LocalPort 3000)) {
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command', "Set-Location -LiteralPath '$backendRoot'; npm run dev"
    )
}

if (-not (Test-LocalPort 5173)) {
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command', "Set-Location -LiteralPath '$frontendRoot'; node dev-server.mjs"
    )
}

$deadline = (Get-Date).AddSeconds(30)
do {
    if ((Test-LocalPort 3000) -and (Test-LocalPort 5173)) {
        Start-Process 'http://localhost:5173/#/dashboard'
        exit 0
    }

    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)

Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show(
    'O JvitorZ OS nao iniciou em 30 segundos. Verifique Node.js e as configuracoes locais.',
    'JvitorZ OS'
) | Out-Null
exit 1
