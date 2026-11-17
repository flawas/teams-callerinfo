<#
.SYNOPSIS
    Legt die minimale Entra-ID-App-Registrierung für "Caller Info" an.

.DESCRIPTION
    Teams verlangt für die Anruf-Berechtigung (RSC: OnlineMeeting.ReadBasic.Chat,
    OnlineMeetingParticipant.Read.Chat) eine Application (Client) ID im Manifest
    (webApplicationInfo.id). Die App selbst ruft keine API auf – darum braucht die
    Registrierung weder Secrets noch Berechtigungen, Rollen oder Redirect-URIs.

.EXAMPLE
    ./New-CallerInfoAppRegistration.ps1 -TenantId <tenant-id>
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$TenantId,

    [string]$DisplayName = 'Caller Info'
)

$ErrorActionPreference = 'Stop'
Import-Module Microsoft.Graph.Applications -ErrorAction Stop

Connect-MgGraph -TenantId $TenantId -Scopes 'Application.ReadWrite.All' -NoWelcome

Write-Host "Erstelle App-Registrierung '$DisplayName' …"
$app = New-MgApplication -DisplayName $DisplayName -SignInAudience 'AzureADMyOrg' `
    -Notes 'Teams-App Caller Info – nur für RSC (webApplicationInfo.id), ohne Secrets oder API-Berechtigungen.'

Write-Host ''
Write-Host 'Fertig. Wert für .env:' -ForegroundColor Green
Write-Host "CLIENT_ID=$($app.AppId)"
