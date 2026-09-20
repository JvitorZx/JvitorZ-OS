param(
    [string]$ProjectRef = 'mnkbrgqzntpqwrobrsif',
    [string]$PoolerHost = 'aws-0-sa-east-1.pooler.supabase.com'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root 'backend\.env'

if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Arquivo backend/.env nao encontrado."
}

function Set-EnvValue {
    param(
        [string]$Content,
        [string]$Name,
        [string]$Value
    )

    $line = "$Name=$Value"
    $pattern = "(?m)^$([regex]::Escape($Name))=.*$"
    if ($Content -match $pattern) {
        return [regex]::Replace($Content, $pattern, $line)
    }

    return $Content.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine
}

$securePassword = Read-Host 'Digite a senha do banco JvitorZ OS no Supabase' -AsSecureString
$password = [System.Net.NetworkCredential]::new('', $securePassword).Password

if ([string]::IsNullOrWhiteSpace($password)) {
    throw 'A senha nao pode ficar vazia.'
}

$encodedPassword = [Uri]::EscapeDataString($password)
$username = "postgres.$ProjectRef"
$sessionUrl = "postgresql://${username}:${encodedPassword}@${PoolerHost}:5432/postgres?uselibpqcompat=true&sslmode=require"
$transactionUrl = "postgresql://${username}:${encodedPassword}@${PoolerHost}:6543/postgres?pgbouncer=true&uselibpqcompat=true&sslmode=require"

$content = Get-Content -LiteralPath $envPath -Raw
$content = Set-EnvValue -Content $content -Name 'POSTGRES_DATABASE_URL' -Value $sessionUrl
$content = Set-EnvValue -Content $content -Name 'POSTGRES_TRANSACTION_URL' -Value $transactionUrl
Set-Content -LiteralPath $envPath -Value $content -NoNewline

$password = $null
$encodedPassword = $null
$sessionUrl = $null
$transactionUrl = $null

Write-Host 'Configuracao do Supabase salva localmente em backend/.env.' -ForegroundColor Green
Write-Host 'Nenhum segredo foi enviado ao Git.'
Read-Host 'Pressione Enter para fechar'
