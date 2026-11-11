param([string]$TestRoot)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Collector.psm1') -Force -DisableNameChecking
if(-not $TestRoot){throw 'Provide an isolated workspace TestRoot'}
[IO.Directory]::CreateDirectory($TestRoot)|Out-Null
$script:passed=0
function Check($Ok,[string]$Name){if(-not $Ok){throw ('FAIL: '+$Name)};$script:passed++}
$c=[pscustomobject]@{version=1;baseUrl='https://www.aywa.co.kr';scope='source-evidence-only-v1';tenantId='becaa316-e636-42e9-9d09-08b133e0b094';deviceId='bc746112-23fd-4660-ad12-919230d95bae';token=('bc746112-23fd-4660-ad12-919230d95bae.'+('a'*64));expiresAt=[DateTimeOffset]::UtcNow.AddDays(1).ToString('o')}
$script:posts=0;$script:remote=@{};$script:failOnce=$false;$script:badReceipt=$false;$script:wrongTenant=$false
$request={param($connection,$method,$item)
  if($method -eq 'GET'){return @{connected=$true;tenantId=$(if($script:wrongTenant){'other'}else{$connection.tenantId});deviceId=$connection.deviceId;scope=$connection.scope}}
  $script:posts++;$key=$item.Source+':'+$item.Month+':'+$item.Hash;$duplicate=$script:remote.ContainsKey($key);$script:remote[$key]=$true
  if($script:failOnce){$script:failOnce=$false;throw 'lost_response_after_commit'}
  return @{sourceHash=$(if($script:badReceipt){'bad'}else{$item.Hash});inserted=$(if($duplicate){0}else{1});duplicates=$(if($duplicate){1}else{0});months=@($item.Month);issues=0}
}
function Fixture([string]$Name){$r=Join-Path $TestRoot $Name;$d=Join-Path $r 'inbox/makeedu/2026-10';[IO.Directory]::CreateDirectory($d)|Out-Null;$f=Join-Path $d 'fixture.xlsx';[IO.File]::WriteAllBytes($f,[byte[]](1,2,3,4));[IO.File]::SetLastWriteTimeUtc($f,[DateTime]::UtcNow.AddMinutes(-1));return $r}
$r=Fixture 'success';$result=Invoke-CollectionCycle $r $c $request 0
Check ($result.sent -eq 1 -and $result.failed -eq 0) 'successful acknowledged file'
Check ($script:posts -eq 1) 'single upload'
$result=Invoke-CollectionCycle $r $c $request 0
Check ($result.sent -eq 0 -and $script:posts -eq 1) 'same-day duplicate skipped'
$processed=Get-Content (Join-Path $r 'processed.json') -Raw|ConvertFrom-Json
foreach($p in $processed.PSObject.Properties){$p.Value.day='2000-01-01'}
Write-AtomicJson (Join-Path $r 'processed.json') $processed
$result=Invoke-CollectionCycle $r $c $request 0
Check ($result.sent -eq 1 -and $script:remote.Count -eq 1) 'next-day recompare server idempotency'
$r=Fixture 'lost-ack';$script:failOnce=$true;$result=Invoke-CollectionCycle $r $c $request 0
Check ($result.failed -eq 1 -and -not(Test-Path (Join-Path $r 'processed.json'))) 'lost acknowledgement not marked'
$result=Invoke-CollectionCycle $r $c $request 0
Check ($result.sent -eq 1 -and $result.failed -eq 0) 'retry duplicate acknowledged'
$r=Fixture 'wrong-hash';$script:badReceipt=$true;$result=Invoke-CollectionCycle $r $c $request 0
Check ($result.failed -eq 1 -and -not(Test-Path (Join-Path $r 'processed.json'))) 'wrong receipt hash rejected'
$script:badReceipt=$false;$script:wrongTenant=$true;$r=Fixture 'wrong-tenant';$before=$script:posts;$caught=$false
try{Invoke-CollectionCycle $r $c $request 0|Out-Null}catch{$caught=$true}
Check ($caught -and $script:posts -eq $before) 'wrong destination prevents file transmission'
$script:wrongTenant=$false;$r=Fixture 'locked';$lock=[IO.File]::Open((Join-Path $r 'cycle.lock'),'OpenOrCreate','ReadWrite','None')
try{$result=Invoke-CollectionCycle $r $c $request 0;Check ($result.code -eq 'already_running') 'concurrent process excluded'}finally{$lock.Dispose()}
$r=Fixture 'stable';$f=Join-Path $r 'inbox/makeedu/2026-10/fixture.xlsx';[IO.File]::SetLastWriteTimeUtc($f,[DateTime]::UtcNow);$before=$script:posts;$result=Invoke-CollectionCycle $r $c $request 0
Check ($result.skipped -eq 1 -and $script:posts -eq $before) 'in-progress file skipped'
Check (([IO.File]::ReadAllBytes($f) -join ',') -eq '1,2,3,4') 'source files preserved'
$r=Fixture 'expired';$c.expiresAt='2000-01-01T00:00:00Z';$caught=$false
try{Invoke-CollectionCycle $r $c $request 0|Out-Null}catch{$caught=$true}
Check $caught 'expired connection blocked'
$c.expiresAt=[DateTimeOffset]::UtcNow.AddDays(1).ToString('o');$c.baseUrl='https://elsewhere.example';$caught=$false
try{Assert-Connection $c}catch{$caught=$true}
Check $caught 'other destination blocked before installation or transmission'
foreach($file in Get-ChildItem -LiteralPath $PSScriptRoot -File|Where-Object {$_.Extension -in @('.ps1','.psm1')}){
  $tokens=$null;$errors=$null;[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($file.FullName),[ref]$tokens,[ref]$errors)|Out-Null
  Check ($errors.Count -eq 0) ('Windows PowerShell syntax '+$file.Name)
}
Write-Output ('PASS '+$script:passed+' collector checks; no network, credentials, installation or scheduled tasks created')
