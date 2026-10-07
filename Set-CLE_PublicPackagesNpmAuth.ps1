<#
.SYNOPSIS
    Authenticates your local npm client to the CFS-backed CLE_PublicPackages Azure Artifacts feed.

.DESCRIPTION
    Under 1ES Network Isolation the public npm registry (registry.npmjs.org) is blocked,
    and the checked-in repo .npmrc points npm at the internal CLE_PublicPackages feed
    (https://office.pkgs.visualstudio.com/CLE/_packaging/CLE_PublicPackages/npm/registry/). That feed
    requires authentication, which CI provides via the npmAuthenticate@0 task. On a local
    dev box there is no such task, so `npm install` fails with an E401.

    This script mints a short-lived Microsoft Entra (AAD) access token for the Azure
    DevOps resource using the Azure CLI - the same corporate identity your Azure DevOps
    MCP servers and `az` use - and writes it as an `_authToken` entry into your
    user-level %USERPROFILE%\.npmrc. It never modifies the repo-tracked .npmrc.

    Note: the RoqCdn gulp/extension build authenticates to the feed's PowerShell
    repository separately by minting its own fresh token via the Azure CLI at build time
    (it does not use SYSTEM_ACCESSTOKEN locally), so this script only handles npm auth.
    You still need to be signed in with `az login`.

    The token is short-lived (typically ~1 hour). Re-run this script whenever npm starts
    returning 401s again.

.PARAMETER FeedRegistry
    The CLE_PublicPackages npm feed registry URL. Defaults to the value used by the repo .npmrc.

.PARAMETER Tenant
    Optional Entra tenant id to authenticate against (passed to `az login`).

.EXAMPLE
    ./Set-CLE_PublicPackagesNpmAuth.ps1
    Signs in if needed, mints a token, and updates %USERPROFILE%\.npmrc.
#>
[CmdletBinding()]
param(
    [string]$FeedRegistry = 'https://office.pkgs.visualstudio.com/CLE/_packaging/CLE_PublicPackages/npm/registry/',
    [string]$Tenant
)

$ErrorActionPreference = 'Stop'

# Azure DevOps first-party application id. Tokens issued for this resource authenticate
# against Azure Artifacts feeds (npm, NuGet, etc.).
$AdoResourceId = '499b84ac-1321-427f-aa17-267ca6975798'

function Assert-AzCli {
    if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
        throw 'Azure CLI (az) is not installed or not on PATH. Install it from https://aka.ms/installazurecliwindows and re-run.'
    }
}

function Ensure-AzLogin {
    param([string]$Tenant)

    $loggedIn = $false
    try {
        az account show --only-show-errors 1>$null 2>$null
        $loggedIn = ($LASTEXITCODE -eq 0)
    } catch {
        $loggedIn = $false
    }

    if (-not $loggedIn) {
        Write-Host 'Not signed in to Azure CLI. Launching interactive sign-in...' -ForegroundColor Yellow
        if ($Tenant) {
            az login --tenant $Tenant --allow-no-subscriptions --only-show-errors 1>$null
        } else {
            az login --allow-no-subscriptions --only-show-errors 1>$null
        }
        if ($LASTEXITCODE -ne 0) {
            throw 'az login failed. Ensure you are on the corporate network or VPN and try again.'
        }
    }
}

function Get-AdoAccessToken {
    param([string]$Tenant)

    $args = @('account', 'get-access-token', '--resource', $AdoResourceId, '--query', 'accessToken', '-o', 'tsv', '--only-show-errors')
    if ($Tenant) { $args += @('--tenant', $Tenant) }

    $token = (& az @args).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($token)) {
        throw 'Failed to obtain an Azure DevOps access token. Try running `az login` manually, then re-run this script.'
    }
    return $token
}

# Derives the npm auth key(s) from a registry URL. npm matches credentials by the
# protocol-less "//host/path" prefix, so we emit an entry for the registry path and its
# parent (the packaging root) to cover both install and publish operations.
function Get-NpmAuthKeys {
    param([string]$Registry)

    $uri = [System.Uri]$Registry
    $path = $uri.AbsolutePath.TrimEnd('/')
    $registryKey = "//$($uri.Authority)$path/"

    $keys = @($registryKey)
    # Parent path (e.g. .../CLE_PublicPackages/npm/) is used by some npm operations such as publish.
    $parent = $path -replace '/registry$', ''
    if ($parent -ne $path) {
        $keys += "//$($uri.Authority)$parent/"
    }
    return $keys
}

function Update-UserNpmrc {
    param(
        [string[]]$AuthKeys,
        [string]$Token,
        [string]$Registry
    )

    $npmrcPath = Join-Path $env:USERPROFILE '.npmrc'

    $existing = @()
    if (Test-Path $npmrcPath) {
        $existing = Get-Content -LiteralPath $npmrcPath
    }

    # Remove any previous entries we manage (registry / auth token / always-auth) so the
    # file stays idempotent and free of stale tokens. The registry line is managed so that
    # global installs (npm install -g), which ignore the repo-level .npmrc, also resolve
    # through the internal CLE_PublicPackages feed instead of the public registry.
    $managedSuffixes = @(':_authToken=', ':always-auth=')
    $filtered = foreach ($line in $existing) {
        $isManaged = $false
        if ($line -match '^\s*registry\s*=') { $isManaged = $true }
        if (-not $isManaged) {
            foreach ($key in $AuthKeys) {
                foreach ($suffix in $managedSuffixes) {
                    if ($line.StartsWith("$key$suffix")) { $isManaged = $true; break }
                }
                if ($isManaged) { break }
            }
        }
        if (-not $isManaged) { $line }
    }

    $newLines = New-Object System.Collections.Generic.List[string]
    # Registry override first so global installs use the CLE_PublicPackages feed.
    $newLines.Add("registry=$Registry")
    if ($filtered) { $filtered | ForEach-Object { $newLines.Add($_) } }
    foreach ($key in $AuthKeys) {
        $newLines.Add("${key}:_authToken=$Token")
        $newLines.Add("${key}:always-auth=true")
    }

    Set-Content -LiteralPath $npmrcPath -Value $newLines -Encoding UTF8
    return $npmrcPath
}

Assert-AzCli
Ensure-AzLogin -Tenant $Tenant
$token = Get-AdoAccessToken -Tenant $Tenant
$authKeys = Get-NpmAuthKeys -Registry $FeedRegistry
$npmrcPath = Update-UserNpmrc -AuthKeys $authKeys -Token $token -Registry $FeedRegistry

# Remove any previously baked SYSTEM_ACCESSTOKEN. Earlier versions of this script set it
# for the gulp build, but a ~1 hour token persisted in the User environment goes stale and
# is captured for the lifetime of a long-running Visual Studio / shell session. The gulp
# build now mints its own fresh token via Azure CLI for local builds, so this is no longer
# needed - clear it to avoid stale-token build failures.
if ([Environment]::GetEnvironmentVariable('SYSTEM_ACCESSTOKEN', 'User')) {
    [Environment]::SetEnvironmentVariable('SYSTEM_ACCESSTOKEN', $null, 'User')
}

Write-Host ''
Write-Host "npm is now authenticated to the CLE_PublicPackages feed." -ForegroundColor Green
Write-Host "  Registry : $FeedRegistry"
Write-Host "  Updated  : $npmrcPath"
Write-Host ''
Write-Host 'The token is short-lived (~1 hour). Re-run this script if npm starts returning 401 errors.' -ForegroundColor DarkGray
