[CmdletBinding()]
param()
Set-StrictMode -Version 2.0
Write-Verbose "Check if write verbose works"
[boolean]$useVerbose = $($VerbosePreference -eq "Continue")
Set-Variable -Name "NugetPath" -Value "$PSScriptRoot\..\lib\ps_modules\NugetPackages" -Option Constant -Scope Local -Force
Set-Variable -Name "VstsHelperPath" -Value "$PSScriptRoot\..\tasks\ps_common\vstsHelper.psm1" -Option Constant -Scope Local -Force
Set-Variable -Name "OpenSSLPath" -Value "$PSScriptRoot\..\lib\ps_modules\openssl" -Option Constant -Scope Global -Force

Import-Module $VstsHelperPath 6>$null 5>$null 4>$null 3>$null 1>$null
Import-Module "$PSScriptRoot\..\tasks\ps_common\vstsHelper.psm1" 6>$null 5>$null 4>$null 3>$null 1>$null
Import-Module "$PSScriptRoot\..\lib\ps_modules\VstsTaskSdk\VstsTaskSdk.psm1" 6>$null 5>$null 4>$null 3>$null 1>$null
Import-Module "$PSScriptRoot\..\lib\ps_modules\AdoAzureHelper\AdoAzureHelper.psm1" 6>$null 5>$null 4>$null 3>$null 1>$null

# Getting AAD accessToken that would be later used by all the StoreBroker commands to access Partner Center APIs.
Initialize-AdoAzureHelper -msalLibraryDir $NugetPath -adoApiLibraryDir $NugetPath -openSSLExeDir $OpenSSLPath
$resource = "https://manage.devcenter.microsoft.com"

$endpointId = "XXX"
$endPointObj = @{
    'Auth' = @{
        'scheme' = 'UsernamePassword'
        'parameters' = @{
            # This is the tenant Id of Microsoft
            'AuthenticationType' = 'SPNCertificate'
            # This is the client ID of Azure Active Directory Service
            'ServicePrincipalId' = "f8c7a2d2-b9d1-4c63-988a-6e4cceb58b7e"
            # This is the tenant ID of Azure Active Directory
            'TenantId' = "72f988bf-86f1-41af-91ab-2d7cd011db47"
            # This is the certificate used for the service principal
            'ServicePrincipalCertificate' = "XXXX"
        }
    }
}

$sendX5C = $true
$useMSAL = $true
if (($endPointObj.Auth.Scheme -eq 'WorkloadIdentityFederation') -or ($endPointObj.Auth.Parameters.AuthenticationType -ne 'SPNCertificate'))
{
    $sendX5C = $false
}

$aadAccessToken = (Get-AzureRMAccessToken $endPointObj $endpointId $resource $sendX5C $useMSAL).access_token

// Saving access token to output txt file to be used later by other integration tests
Set-Content -Path "./output.txt" -Value $aadAccessToken
