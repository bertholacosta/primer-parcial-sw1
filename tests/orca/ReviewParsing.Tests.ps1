$reviewModule = Get-Module OrcaPipeline

function ConvertFrom-TestReviewOutput {
    param([string]$Text)
    & $reviewModule { param($value) ConvertFrom-OrcaReviewOutput $value } $Text
}

function New-TestReviewProcessResult {
    param([string]$Stdout, [string]$Stderr = '', [int]$ExitCode = 0)
    [pscustomobject]@{ stdout = $Stdout; stderr = $Stderr; exitCode = $ExitCode }
}

function New-TestReviewState {
    @{
        state = 'reviewing'
        history = @()
        correctionCount = 0
        sessions = @{}
        currentProcess = $null
        stopRequested = $false
        halted = $false
        haltReason = $null
    }
}

function New-TestReviewRoot {
    $root = Join-Path ([IO.Path]::GetTempPath()) ("orca-review-$([guid]::NewGuid().ToString('N'))")
    [IO.Directory]::CreateDirectory($root) | Out-Null
    return $root
}

It 'parses a pure reviewer JSON object' {
    $text = '{"verdict":"approved","summary":"Ready","findings":[]}'
    $result = ConvertFrom-TestReviewOutput $text
    Assert-True $result.success
    Assert-Equal 'approved' $result.normalized.verdict
    Assert-Equal 'Ready' $result.normalized.summary
}

It 'parses reviewer JSON inside a Markdown json block' {
    $text = @'
```json
{"verdict":"approved","summary":"Ready","findings":[]}
```
'@
    $result = ConvertFrom-TestReviewOutput $text
    Assert-True $result.success
    Assert-Equal 'approved' $result.normalized.verdict
}

It 'parses exactly one valid reviewer JSON object surrounded by text' {
    $text = 'Review completed. {"note":"incidental"} {"verdict":"approved","summary":"Ready","findings":[]} End.'
    $result = ConvertFrom-TestReviewOutput $text
    Assert-True $result.success
    Assert-Equal 'approved' $result.normalized.verdict
}

It 'extracts the final response from Antigravity stream JSON' {
    $response = @'
```json
{"verdict":"approved","summary":"Ready","findings":[]}
```
'@
    $stream = ([ordered]@{ event = 'init'; conversation_id = 'test' } | ConvertTo-Json -Compress) + "`n" +
        ([ordered]@{ event = 'result'; result = @{ response = $response } } | ConvertTo-Json -Depth 10 -Compress)
    $result = ConvertFrom-TestReviewOutput $stream
    Assert-True $result.success
    Assert-Equal 'approved' $result.normalized.verdict
}

It 'uses only the final agent message from a Codex JSON stream' {
    $first = [ordered]@{ type = 'item.completed'; item = @{ type = 'agent_message'; text = '{"verdict":"approved","summary":"Interim","findings":[]}' } } | ConvertTo-Json -Depth 10 -Compress
    $final = [ordered]@{ type = 'item.completed'; item = @{ type = 'agent_message'; text = '{"verdict":"changes_requested","summary":"Final","findings":[]}' } } | ConvertTo-Json -Depth 10 -Compress
    $result = ConvertFrom-TestReviewOutput ($first + "`n" + $final)
    Assert-True $result.success
    Assert-Equal 'changes_requested' $result.normalized.verdict
    Assert-Equal 'Final' $result.normalized.summary
}

It 'rejects two distinct valid verdict objects in one response' {
    $text = '{"verdict":"approved","summary":"One","findings":[]} {"verdict":"approved","summary":"Two","findings":[]}'
    $result = ConvertFrom-TestReviewOutput $text
    Assert-False $result.success
    Assert-True ($result.error -match '2 valid verdict objects')
}

It 'normalizes a Spanish reviewer verdict and legacy severity' {
    $text = '{"verdict":"REQUIERE CORRECCIONES","summary":"Hay cambios","findings":[{"severity":"major","file":"orca.ps1","description":"Corregir parser","recommendation":"Aceptar JSON cercado"}]}'
    $result = ConvertFrom-TestReviewOutput $text
    Assert-True $result.success
    Assert-Equal 'changes_requested' $result.normalized.verdict
    Assert-Equal 'high' $result.normalized.findings[0].severity
}

It 'reports invalid reviewer output without inventing a verdict' {
    $result = ConvertFrom-TestReviewOutput 'APROBADO, todo bien.'
    Assert-False $result.success
    Assert-Equal $null $result.normalized
    Assert-True ($result.error -match 'exactly one valid verdict JSON')
}

It 'renders the reviewer prompt with only the canonical verdict schema' {
    $plan = New-OrcaDryRun -RepoRoot $repoRoot -TaskId 'P1-001'
    Assert-True ($plan.prompts.reviewer -match 'approved \| changes_requested')
    Assert-True ($plan.prompts.reviewer -match 'blocking \| high \| medium \| low')
    Assert-True ($plan.prompts.reviewer -match '"recommendation": "string"')
    Assert-False ($plan.prompts.reviewer -match 'approved\|changes_requested\|blocked')
}

It 'persists review_failed state, original streams, parse error, and log path' {
    $repoRoot = New-TestReviewRoot
    try {
        $root = Join-Path (Join-Path (Join-Path $repoRoot '.orca') 'runs') 'REV-001'
        [IO.Directory]::CreateDirectory($root) | Out-Null
        $state = New-TestReviewState
        $invoker = { param($attempt, $sessionId) New-TestReviewProcessResult -Stdout "invalid-$attempt" -Stderr "stderr-$attempt" }
        $outcome = & $reviewModule {
            param($runRoot, $runState, $fakeInvoker)
            Invoke-OrcaReviewerWithRetry -AgentId 'antigravity' -Prompt 'review' -Worktree $runRoot -RunRoot $runRoot -State $runState -Invoker $fakeInvoker
        } $root $state $invoker
        Assert-False $outcome.success
        Assert-Equal 'review_failed' $state.state
        Assert-True (Test-Path -LiteralPath (Join-Path $root 'state.json') -PathType Leaf)
        Assert-True (Test-Path -LiteralPath $state.lastReviewLog -PathType Leaf)
        $log = [IO.File]::ReadAllText($state.lastReviewLog) | ConvertFrom-Json
        Assert-Equal 'invalid-2' $log.stdout
        Assert-Equal 'stderr-2' $log.stderr
        Assert-True ([bool]$log.parseError)

        $status = Invoke-OrcaPipelineCommand -Command status -TaskId 'REV-001' -RepoRoot $repoRoot
        Assert-True $status.success
        Assert-True ([bool]$status.lastError)
        Assert-True ([bool]$status.logPath)
    }
    finally { Remove-OrcaAdoptionFixture $repoRoot }
}

It 'retries invalid reviewer output exactly once with a new session' {
    $root = New-TestReviewRoot
    try {
        $state = New-TestReviewState
        $tracker = [pscustomobject]@{ Calls = 0; Sessions = [System.Collections.Generic.List[object]]::new() }
        $invoker = {
            param($attempt, $sessionId)
            $tracker.Calls++
            $tracker.Sessions.Add($sessionId)
            if ($tracker.Calls -eq 1) { return [pscustomobject]@{ stdout = 'invalid'; stderr = ''; exitCode = 0 } }
            return [pscustomobject]@{ stdout = '{"verdict":"approved","summary":"Ready","findings":[]}'; stderr = ''; exitCode = 0 }
        }.GetNewClosure()
        $outcome = & $reviewModule {
            param($runRoot, $runState, $fakeInvoker)
            Invoke-OrcaReviewerWithRetry -AgentId 'antigravity' -Prompt 'review' -Worktree $runRoot -RunRoot $runRoot -State $runState -Invoker $fakeInvoker
        } $root $state $invoker
        Assert-True $outcome.success
        Assert-Equal 2 $tracker.Calls
        Assert-Equal 2 $tracker.Sessions.Count
        Assert-Equal $null $tracker.Sessions[0]
        Assert-Equal $null $tracker.Sessions[1]
        Assert-Equal 'approved' $outcome.analysis.normalized.verdict
    }
    finally { Remove-OrcaAdoptionFixture $root }
}
