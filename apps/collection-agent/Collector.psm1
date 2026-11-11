Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$script:AllowedOrigin='https://www.aywa.co.kr'
function Get-FileDigest([byte[]]$Bytes) {
  $sha=[Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally {$sha.Dispose()}
}
function Assert-Connection($Connection) {
  if($Connection.version -ne 1 -or $Connection.baseUrl -cne $script:AllowedOrigin -or $Connection.scope -cne 'source-evidence-only-v1' -or $Connection.deviceId -notmatch '^[a-f0-9-]{36}$' -or $Connection.tenantId -notmatch '^[a-f0-9-]{36}$' -or $Connection.token -notmatch '^[a-f0-9-]{36}\.[a-f0-9]{64}$' -or $Connection.token.Split('.')[0] -cne $Connection.deviceId){throw 'invalid_connection'}
  if([DateTimeOffset]::Parse($Connection.expiresAt) -le [DateTimeOffset]::UtcNow){throw 'connection_expired'}
}
function Write-AtomicJson([string]$Path,$Value) {
  $temp=$Path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
  [IO.File]::WriteAllText($temp,($Value|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
  if([IO.File]::Exists($Path)){[IO.File]::Replace($temp,$Path,[NullString]::Value)}else{[IO.File]::Move($temp,$Path)}
}
function Invoke-CollectorRequest($Connection,[string]$Method,$Item) {
  Assert-Connection $Connection
  Add-Type -AssemblyName System.Net.Http
  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
  $handler=[Net.Http.HttpClientHandler]::new();$handler.AllowAutoRedirect=$false
  $client=[Net.Http.HttpClient]::new($handler);$client.Timeout=[TimeSpan]::FromSeconds(50)
  $client.DefaultRequestHeaders.Authorization=[Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer',$Connection.token)
  try {
    $url=$script:AllowedOrigin+'/api/management/collector'
    if($Method -eq 'GET'){$response=$client.GetAsync($url).GetAwaiter().GetResult()}else{
      $body=[Net.Http.MultipartFormDataContent]::new()
      foreach($pair in @(@('source',$Item.Source),@('month',$Item.Month),@('sourceHash',$Item.Hash),@('scope','true'),@('fullScope','true'),@('sourceName',[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$Item.Name))))){$body.Add([Net.Http.StringContent]::new($pair[1]),$pair[0])}
      $content=[Net.Http.ByteArrayContent]::new([byte[]]$Item.Bytes);$content.Headers.ContentType=[Net.Http.Headers.MediaTypeHeaderValue]::new('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      # ASCII upload name only: Windows PowerShell 5.1 encodes non-ASCII multipart file names in a form the server cannot read.
      $body.Add($content,'file',($Item.Source+'-'+$Item.Month+'.xlsx'))
      try{$response=$client.PostAsync($url,$body).GetAwaiter().GetResult()}finally{$body.Dispose()}
    }
    try{$text=$response.Content.ReadAsStringAsync().GetAwaiter().GetResult();if(-not $response.IsSuccessStatusCode){throw ('http_'+[int]$response.StatusCode)};return ($text|ConvertFrom-Json)}finally{$response.Dispose()}
  } finally {$client.Dispose();$handler.Dispose()}
}
function Invoke-CollectionCycle([string]$Root,$Connection,[scriptblock]$Request={param($c,$m,$i) Invoke-CollectorRequest $c $m $i},[int]$DelaySeconds=3) {
  Assert-Connection $Connection
  $rootPath=[IO.Path]::GetFullPath($Root);[IO.Directory]::CreateDirectory($rootPath)|Out-Null
  $lockPath=Join-Path $rootPath 'cycle.lock'
  try{$lock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch{return @{code='already_running';sent=0}}
  $statePath=Join-Path $rootPath 'processed.json';$statusPath=Join-Path $rootPath 'status.json'
  try{
    $done=@{};if(Test-Path -LiteralPath $statePath){$stored=Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json;foreach($p in $stored.PSObject.Properties){$done[$p.Name]=$p.Value}}
    $connected=& $Request $Connection 'GET' $null
    if(-not $connected.connected -or $connected.tenantId -cne $Connection.tenantId -or $connected.deviceId -cne $Connection.deviceId -or $connected.scope -cne $Connection.scope){throw 'wrong_destination'}
    $sent=0;$failed=0;$skipped=0;$issues=0;$lastCode='idle'
    foreach($source in @('makeedu','ecount')){
      $sourceDir=Join-Path (Join-Path $rootPath 'inbox') $source
      if(-not(Test-Path -LiteralPath $sourceDir)){continue}
      if((Get-Item -LiteralPath $sourceDir).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'linked_folder_rejected'}
      foreach($monthDir in @(Get-ChildItem -LiteralPath $sourceDir -Directory|Sort-Object Name)){
        if($monthDir.Name -notmatch '^20\d{2}-(0[1-9]|1[0-2])$' -or ($monthDir.Attributes -band [IO.FileAttributes]::ReparsePoint)){continue}
        foreach($file in @(Get-ChildItem -LiteralPath $monthDir.FullName -File -Filter '*.xlsx'|Sort-Object Name)){
          if(($sent+$failed) -ge 20){break}
          if(($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Name.StartsWith('~$') -or $file.Length -gt 4194304 -or $file.LastWriteTimeUtc -gt [DateTime]::UtcNow.AddSeconds(-30)){$skipped++;continue}
          try{
            $bytes=[IO.File]::ReadAllBytes($file.FullName);$hash=Get-FileDigest $bytes;$key=$Connection.deviceId+':'+$source+':'+$monthDir.Name+':'+$hash
            # Recompare unchanged files once per KST day to detect changed AYWA records.
            $kstDay=[DateTime]::UtcNow.AddHours(9).ToString('yyyy-MM-dd')
            if($done.ContainsKey($key) -and $done[$key].day -eq $kstDay){continue}
            if($DelaySeconds -gt 0){Start-Sleep -Seconds $DelaySeconds}
            $result=& $Request $Connection 'POST' @{Source=$source;Month=$monthDir.Name;Hash=$hash;Bytes=$bytes;Name=$file.Name}
            if($result.sourceHash -cne $hash -or $null -eq $result.inserted -or $null -eq $result.duplicates -or $null -eq $result.months -or @($result.months).Count -lt 1 -or ([int]$result.inserted+[int]$result.duplicates) -ne @($result.months).Count){throw 'invalid_receipt'}
            $done[$key]=@{day=$kstDay;at=[DateTimeOffset]::UtcNow.ToString('o');months=@($result.months);issues=[int]$result.issues}
            Write-AtomicJson $statePath $done;$sent++;$issues+=[int]$result.issues;$lastCode='saved'
          }catch{
            $failed++;$lastCode=if($_.Exception.Message -match '^http_(401|403)$'){'connection_denied'}else{'file_or_network_error'};if($lastCode -eq 'connection_denied'){throw 'connection_denied'}
            # A request the server can never accept (400) is retried once per KST day; 409/503 are retried next cycle.
            if($_.Exception.Message -match '^http_400$'){$lastCode='file_rejected';$done[$key]=@{day=$kstDay;at=[DateTimeOffset]::UtcNow.ToString('o');rejected=$true};Write-AtomicJson $statePath $done}
          }
        }
      }
    }
    $status=@{checkedAt=[DateTimeOffset]::UtcNow.ToString('o');code=$lastCode;sent=$sent;failed=$failed;skipped=$skipped;issues=$issues;mode='exported_files_only'}
    Write-AtomicJson $statusPath $status;return $status
  }catch{Write-AtomicJson $statusPath @{checkedAt=[DateTimeOffset]::UtcNow.ToString('o');code='connection_or_state_error';mode='exported_files_only'};throw 'collection_failed'}finally{$lock.Dispose()}
}
Export-ModuleMember -Function Get-FileDigest,Assert-Connection,Write-AtomicJson,Invoke-CollectorRequest,Invoke-CollectionCycle
