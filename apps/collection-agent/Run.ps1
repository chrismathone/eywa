$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Collector.psm1') -Force -DisableNameChecking
$root=Join-Path $env:LOCALAPPDATA 'AYWA/Collection'
try {
  $secure=Get-Content -LiteralPath (Join-Path $root 'connection.dpapi') -Raw|ConvertTo-SecureString
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try{$connection=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)|ConvertFrom-Json}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
  $result=Invoke-CollectionCycle $root $connection
  if($result.failed -gt 0){exit 1}
}catch{
  if(Test-Path -LiteralPath $root){Write-AtomicJson (Join-Path $root 'status.json') @{checkedAt=[DateTimeOffset]::UtcNow.ToString('o');code='connection_or_state_error';mode='exported_files_only'}}
  exit 1
}
