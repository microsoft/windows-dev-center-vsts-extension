function Set-EndPointAuthentication
{
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string] $TenantId,

        [Parameter(Mandatory)]
        [string] $ClientId,

        [Parameter(Mandatory)]
        [string] $ClientSecret
    )

    [boolean]$useVerbose = $($VerbosePreference -eq "Continue")
    $securityPassword = ConvertTo-SecureString $ClientSecret -AsPlainText -Force
    $myCreds = New-Object System.Management.Automation.PSCredential $ClientId, $securityPassword
    Set-StoreBrokerAuthentication -TenantId $TenantId -Credential $myCreds -Verbose:$useVerbose
}

function Set-ProxyAuthentication
{
    [CmdletBinding()]
    param(
        [Parameter(ParameterSetName="TenantId", Mandatory)]
        [string] $TenantId,

        [Parameter(ParameterSetName="TenantName", Mandatory)]
        [string] $TenantName,

        [Parameter(Mandatory)]
        [string] $ProxyUrl
    )

    [boolean]$useVerbose = $($VerbosePreference -eq "Continue")
    if ($PSCmdlet.ParameterSetName -eq "TenantId")
    {
        Set-StoreBrokerAuthentication -TenantId $TenantId -UseProxy -ProxyEndpoint $ProxyUrl -Verbose:$useVerbose
    }
    else
    {
        Set-StoreBrokerAuthentication -TenantName $TenantName -UseProxy -ProxyEndpoint $ProxyUrl -Verbose:$useVerbose
    }
}

function Set-StoreBrokerSettings 
{
    [CmdletBinding()]
    param (
        [string] $LogPath,

        [string] $NugetPath,

        [boolean] $DisableTelemetry
    )

    $global:SBAlternateAssemblyDir = $NugetPath
    $global:SBWebRequestTimeoutSec = 300
    $global:SBStoreBrokerClientName = "Office_RDX_Windows_Store_Extension"
    $disablePiiProtection = $false
    $useInt = $false

    if (-not [string]::IsNullOrWhiteSpace($logPath))
    {
        $global:SBLogPath = $LogPath
    }

    if($DisableTelemetry)
    {
        Write-Verbose "Disable Telemetry"
        $global:SBDisableTelemetry = $true
    }

    if([boolean]::TryParse($Env:disablePiiProtection, [ref]$disablePiiProtection) -and $disablePiiProtection)
    {
        Write-Verbose "Disable PII Protection"
        $global:SBDisablePiiProtection = $true
    }

    if (-not ([string]::IsNullOrWhiteSpace($Env:applicationInsightKey)))
    {
        Write-Verbose "Set StoreBroker Application Insight Key"
        $global:SBApplicationInsightsKey = $Env:applicationInsightKey
    }

    if([boolean]::TryParse($Env:useInt, [ref]$useInt) -and $useInt)
    {
        Write-Verbose "Use INT environment"
        $global:SBUseInt = $true
    }
}

function Set-StoreBrokerAuthCredentials
{
    [CmdletBinding()]
    param (
        [Parameter(Mandatory)]
        [PSCustomObject] $EndPointObj
    )

    if ($EndPointObj.Auth.scheme -eq "UsernamePassword")
    {
        Set-EndPointAuthentication -TenantId $EndPointObj.Auth.parameters.tenantIdPassword -ClientId $EndPointObj.Auth.parameters.username -ClientSecret $EndPointObj.Auth.parameters.password
    }
    elseif ($EndPointObj.Auth.scheme -eq "None")
    {
        Set-ProxyAuthentication -TenantId $EndPointObj.Auth.parameters.tenantIdProxy -ProxyUrl $EndPointObj.Auth.parameters.proxyUrlTenantId
    }
    else
    {
        Set-ProxyAuthentication -TenantName $EndPointObj.Auth.parameters.apitoken -ProxyUrl $EndPointObj.Auth.parameters.proxyUrlTenantName
    }
}