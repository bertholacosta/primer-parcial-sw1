$infraModule = Get-Module OrcaPipeline

function New-OrcaInfraFixture {
    param([string]$TaskId = 'INF-001', [switch]$WithDeliverable)
    $root = Join-Path ([IO.Path]::GetTempPath()) ("orca-infra-$([guid]::NewGuid().ToString('N'))")
    $taskDirectory = Join-Path $root 'tasks/active'
    [IO.Directory]::CreateDirectory($taskDirectory) | Out-Null
    $taskPath = Join-Path $taskDirectory "$TaskId-infra-task.yaml"
    $deliverablesYaml = if ($WithDeliverable) { "deliverables:`n  - deliverable.txt" } else { 'deliverables: []' }
    $yaml = @"
id: $TaskId
title: "Infra task"
phase: 0
status: active
kind: implementation
owner_role: Kiro
objective: >-
  Verify infrastructure recovery.
dependencies: []
inputs:
  files: []
  docs: []
scope:
  allowed_paths:
    - tests/orca/
  forbidden_paths: []
constraints: []
acceptance_criteria: []
validation_commands:
  - "Write-Output validated"
$deliverablesYaml
links: []
orca:
  issue: null
  branch: "task/$($TaskId.ToLowerInvariant())-infra-task"
  worktree: "repo-test::$($root.Replace('\', '/'))"
  writer: Kiro
  reviewer: Antigravity
evidence: []
"@
    [IO.File]::WriteAllText($taskPath, $yaml, [Text.UTF8Encoding]::new($false))
    if ($WithDeliverable) {
        [IO.File]::WriteAllText((Join-Path $root 'deliverable.txt'), 'deliverable', [Text.UTF8Encoding]::new($false))
    }
    return [pscustomobject]@{ Root = $root; TaskPath = $taskPath; TaskId = $TaskId }
}

function Remove-OrcaInfraFixture {
    param([string]$Path)
    $resolved = [IO.Path]::GetFullPath($Path)
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove non-temporary test path $resolved."
    }
    if ([IO.Directory]::Exists($resolved)) { [IO.Directory]::Delete($resolved, $true) }
}

function New-OrcaInfraResult {
    param([string]$Stderr, [int]$ExitCode = 1, [string]$Stdout = '')
    [pscustomobject]@{
        executable = 'kiro-cli'
        arguments = @('chat', 'prompt', '--no-interactive', '--output-format', 'stream-json', '--trust-all-tools')
        exitCode = $ExitCode
        stdout = $Stdout
        stderr = $Stderr
        startedAt = [DateTimeOffset]::UtcNow.ToString('o')
        finishedAt = [DateTimeOffset]::UtcNow.ToString('o')
        durationMs = 10
        processId = 1234
    }
}

function New-OrcaInfraState {
    param([string]$RepoRoot, [string]$TaskId, $Task, [string]$InitialState = 'executing')
    & $infraModule {
        param($root, $id, $assignedTask, $initial)
        New-OrcaRunState -RepoRoot $root -TaskId $id -Task $assignedTask -Roles @{ writer = 'kiro'; reviewer = 'antigravity'; integrator = 'codex' } -InitialState $initial
    } $RepoRoot $TaskId $Task $InitialState
}

function Write-OrcaAgentFinishedEvent {
    param([string]$RunRoot, $Result, [string]$Agent = 'kiro', [string]$Role = 'writer')
    & $infraModule {
        param($root, $agentResult, $agentId, $agentRole)
        Write-OrcaRunEvent $root 'agent-finished' @{ agent = $agentId; role = $agentRole; sessionId = $null; result = $agentResult }
    } $RunRoot $Result $Agent $Role
}

It 'classifies an incompatible engine error as infrastructure' {
    $result = New-OrcaInfraResult -Stderr '--output-format stream-json is not supported on the v1 engine. Pass --agent-engine v2 (or v3).'
    $classification = & $infraModule { param($agentResult) Get-OrcaAgentFailureClassification -Result $agentResult -AgentId 'kiro' -Role 'writer' } $result
    Assert-True $classification.isInfrastructure
    Assert-Equal 'incompatible-engine' $classification.category
}

It 'classifies invalid CLI arguments as infrastructure' {
    $launcherError = New-OrcaInfraResult -Stderr "'--permission-mode' is neither a known subcommand nor an existing path."
    $classification = & $infraModule { param($agentResult) Get-OrcaAgentFailureClassification -Result $agentResult -AgentId 'devin' -Role 'writer' } $launcherError
    Assert-True $classification.isInfrastructure
    Assert-Equal 'invalid-arguments' $classification.category

    $clapError = New-OrcaInfraResult -ExitCode 2 -Stderr "error: unexpected argument '--permission-mode' found`n`nUsage: devin.exe [OPTIONS] [PATH]..."
    $clapClassification = & $infraModule { param($agentResult) Get-OrcaAgentFailureClassification -Result $agentResult -AgentId 'devin' -Role 'writer' } $clapError
    Assert-True $clapClassification.isInfrastructure
    Assert-Equal 'invalid-arguments' $clapClassification.category
}

It 'pauses on an infrastructure failure without consuming a correction' {
    $fixture = New-OrcaInfraFixture
    try {
        $task = Read-OrcaTask -RepoRoot $fixture.Root -TaskId $fixture.TaskId
        $runRoot = Join-Path $fixture.Root ".orca/runs/$($fixture.TaskId)"
        $state = New-OrcaInfraState $fixture.Root $fixture.TaskId $task 'executing'
        $state.worktree = @{ id = 'wt-1'; path = $fixture.Root; branch = 'task/inf-001-infra-task' }
        $result = New-OrcaInfraResult -Stderr '--output-format stream-json is not supported on the v1 engine. Pass --agent-engine v2 (or v3).'
        $outcome = & $infraModule {
            param($root, $runState, $agentResult, $assignedTask, $worktree)
            Resolve-OrcaWriterFailure -RunRoot $root -State $runState -Result $agentResult -Task $assignedTask -Worktree $worktree -AgentId 'kiro'
        } $runRoot $state $result $task $fixture.Root
        Assert-Equal 'paused' $outcome.outcome
        Assert-Equal 0 ([int]$state.correctionCount)
        Assert-Equal 'paused-agent-error' $state.state
        Assert-Equal 'executing' $state.pausedFrom
    }
    finally { Remove-OrcaInfraFixture $fixture.Root }
}

It 'persists stdout stderr exitCode version and arguments for agent failures' {
    $fixture = New-OrcaInfraFixture
    try {
        $task = Read-OrcaTask -RepoRoot $fixture.Root -TaskId $fixture.TaskId
        $runRoot = Join-Path $fixture.Root ".orca/runs/$($fixture.TaskId)"
        $state = New-OrcaInfraState $fixture.Root $fixture.TaskId $task 'executing'
        $state.worktree = @{ id = 'wt-1'; path = $fixture.Root; branch = 'task/inf-001-infra-task' }
        $result = New-OrcaInfraResult -Stdout 'partial stdout' -Stderr 'engine failure on stderr'
        $outcome = & $infraModule {
            param($root, $runState, $agentResult, $assignedTask, $worktree)
            Resolve-OrcaWriterFailure -RunRoot $root -State $runState -Result $agentResult -Task $assignedTask -Worktree $worktree -AgentId 'kiro'
        } $runRoot $state $result $task $fixture.Root
        Assert-Equal 'paused' $outcome.outcome
        $logDirectory = Join-Path $runRoot 'agent-failures'
        $logFiles = @(Get-ChildItem -LiteralPath $logDirectory -Filter 'failure-*.json' -File)
        Assert-Equal 1 $logFiles.Count
        $log = [IO.File]::ReadAllText($logFiles[0].FullName) | ConvertFrom-Json
        Assert-Equal 'partial stdout' $log.stdout
        Assert-Equal 'engine failure on stderr' $log.stderr
        Assert-Equal 1 $log.exitCode
        Assert-True ($log.arguments -contains '--output-format')
        Assert-True ([bool]$log.cliVersion) 'Expected the installed CLI version to be captured.'
        Assert-True ($log.PSObject.Properties.Name -contains 'logPath') 'Expected logPath in the persisted failure payload.'
        Assert-Equal $logFiles[0].FullName $log.logPath
        Assert-True (Test-Path -LiteralPath $log.logPath -PathType Leaf)
        Assert-Equal 1 $state.agentFailures.Count
        Assert-Equal $logFiles[0].FullName $state.lastAgentLog
    }
    finally { Remove-OrcaInfraFixture $fixture.Root }
}

It 'resumes an infrastructure-only run and resets correctionCount' {
    $fixture = New-OrcaInfraFixture
    try {
        $task = Read-OrcaTask -RepoRoot $fixture.Root -TaskId $fixture.TaskId
        $runRoot = Join-Path $fixture.Root ".orca/runs/$($fixture.TaskId)"
        $state = New-OrcaInfraState $fixture.Root $fixture.TaskId $task 'executing'
        $state.worktree = @{ id = 'wt-1'; path = $fixture.Root; branch = 'task/inf-001-infra-task' }
        $state.correctionCount = 2
        $state.halted = $true
        $state.haltReason = 'two-failed-corrections'
        & $infraModule { param($root, $runState) Save-OrcaRunState $root $runState } $runRoot $state
        Write-OrcaAgentFinishedEvent $runRoot (New-OrcaInfraResult -Stderr '--output-format stream-json is not supported on the v1 engine. Pass --agent-engine v2 (or v3).')
        Write-OrcaAgentFinishedEvent $runRoot (New-OrcaInfraResult -Stderr '--output-format stream-json is not supported on the v1 engine. Pass --agent-engine v2 (or v3).')

        $recoverable = & $infraModule { param($root, $runState, $assignedTask) Test-OrcaInfrastructureRecovery -RunRoot $root -State $runState -Task $assignedTask } $runRoot $state $task
        Assert-True $recoverable
        & $infraModule { param($root, $runState) Restore-OrcaInfrastructureRun -RunRoot $root -State $runState } $runRoot $state
        Assert-Equal 0 ([int]$state.correctionCount)
        Assert-False $state.halted
        Assert-Equal $null $state.haltReason
        Assert-Equal 'executing' $state.state
    }
    finally { Remove-OrcaInfraFixture $fixture.Root }
}

It 'preserves historical logs across infrastructure recovery' {
    $fixture = New-OrcaInfraFixture
    try {
        $task = Read-OrcaTask -RepoRoot $fixture.Root -TaskId $fixture.TaskId
        $runRoot = Join-Path $fixture.Root ".orca/runs/$($fixture.TaskId)"
        $state = New-OrcaInfraState $fixture.Root $fixture.TaskId $task 'executing'
        $state.worktree = @{ id = 'wt-1'; path = $fixture.Root; branch = 'task/inf-001-infra-task' }
        $state.correctionCount = 1
        $state.halted = $true
        $state.haltReason = 'two-failed-corrections'
        & $infraModule { param($root, $runState) Save-OrcaRunState $root $runState } $runRoot $state
        Write-OrcaAgentFinishedEvent $runRoot (New-OrcaInfraResult -Stderr '--output-format stream-json is not supported on the v1 engine.')
        $syntheticResult = New-OrcaInfraResult -Stderr 'synthetic failure'
        $classification = & $infraModule { param($agentResult) Get-OrcaAgentFailureClassification -Result $agentResult -AgentId 'kiro' -Role 'writer' } $syntheticResult
        $failureLog = & $infraModule {
            param($root, $runState, $agentResult, $failureClassification)
            Save-OrcaAgentFailureLog -RunRoot $root -AgentId 'kiro' -Role 'writer' -Classification $failureClassification -Result $agentResult -CliVersion 'test-version'
        } $runRoot $state $syntheticResult $classification
        $eventsBefore = @([IO.File]::ReadAllLines((Join-Path $runRoot 'events.jsonl'))).Count

        & $infraModule { param($root, $runState) Restore-OrcaInfrastructureRun -RunRoot $root -State $runState } $runRoot $state

        Assert-True (Test-Path -LiteralPath $failureLog -PathType Leaf)
        $eventsAfter = @([IO.File]::ReadAllLines((Join-Path $runRoot 'events.jsonl')))
        Assert-True ($eventsAfter.Count -gt $eventsBefore)
        Assert-True (@($eventsAfter | Where-Object { $_ -match 'agent-finished' }).Count -ge 1)
        Assert-True (@($eventsAfter | Where-Object { $_ -match 'infrastructure-run-recovered' }).Count -eq 1)
    }
    finally { Remove-OrcaInfraFixture $fixture.Root }
}

It 'reuses the same worktree during infrastructure recovery' {
    $fixture = New-OrcaInfraFixture
    try {
        $task = Read-OrcaTask -RepoRoot $fixture.Root -TaskId $fixture.TaskId
        $runRoot = Join-Path $fixture.Root ".orca/runs/$($fixture.TaskId)"
        $state = New-OrcaInfraState $fixture.Root $fixture.TaskId $task 'executing'
        $state.worktree = @{ id = 'wt-original'; path = $fixture.Root; branch = 'task/inf-001-infra-task' }
        $state.correctionCount = 2
        $state.halted = $true
        $state.haltReason = 'two-failed-corrections'
        & $infraModule { param($root, $runState) Save-OrcaRunState $root $runState } $runRoot $state
        Write-OrcaAgentFinishedEvent $runRoot (New-OrcaInfraResult -Stderr '--output-format stream-json is not supported on the v1 engine.')

        & $infraModule { param($root, $runState) Restore-OrcaInfrastructureRun -RunRoot $root -State $runState } $runRoot $state

        Assert-Equal 'wt-original' $state.worktree.id
        Assert-Equal $fixture.Root $state.worktree.path
        $events = [IO.File]::ReadAllText((Join-Path $runRoot 'events.jsonl'))
        Assert-False ($events -match 'worktree-created')
    }
    finally { Remove-OrcaInfraFixture $fixture.Root }
}

It 'keeps functional corrections limited to two cycles' {
    $fixture = New-OrcaInfraFixture -WithDeliverable
    try {
        $task = Read-OrcaTask -RepoRoot $fixture.Root -TaskId $fixture.TaskId
        $runRoot = Join-Path $fixture.Root ".orca/runs/$($fixture.TaskId)"
        $state = New-OrcaInfraState $fixture.Root $fixture.TaskId $task 'executing'
        $state.worktree = @{ id = 'wt-1'; path = $fixture.Root; branch = 'task/inf-001-infra-task' }
        $functional = New-OrcaInfraResult -Stderr 'writer reported a functional failure'

        $first = & $infraModule {
            param($root, $runState, $agentResult, $assignedTask, $worktree)
            Resolve-OrcaWriterFailure -RunRoot $root -State $runState -Result $agentResult -Task $assignedTask -Worktree $worktree -AgentId 'kiro'
        } $runRoot $state $functional $task $fixture.Root
        Assert-Equal 'correction' $first.outcome
        Assert-Equal 1 ([int]$state.correctionCount)

        $state.state = 'executing'
        $second = & $infraModule {
            param($root, $runState, $agentResult, $assignedTask, $worktree)
            Resolve-OrcaWriterFailure -RunRoot $root -State $runState -Result $agentResult -Task $assignedTask -Worktree $worktree -AgentId 'kiro'
        } $runRoot $state $functional $task $fixture.Root
        Assert-Equal 'correction' $second.outcome
        Assert-Equal 2 ([int]$state.correctionCount)

        $state.state = 'executing'
        $third = & $infraModule {
            param($root, $runState, $agentResult, $assignedTask, $worktree)
            Resolve-OrcaWriterFailure -RunRoot $root -State $runState -Result $agentResult -Task $assignedTask -Worktree $worktree -AgentId 'kiro'
        } $runRoot $state $functional $task $fixture.Root
        Assert-Equal 'halted' $third.outcome
        Assert-True $state.halted
        Assert-Equal 'two-failed-corrections' $state.haltReason
        Assert-Equal 2 ([int]$state.correctionCount)
    }
    finally { Remove-OrcaInfraFixture $fixture.Root }
}

It 'does not reset correctionCount when previous attempts include functional failures' {
    $fixture = New-OrcaInfraFixture -WithDeliverable
    try {
        $task = Read-OrcaTask -RepoRoot $fixture.Root -TaskId $fixture.TaskId
        $runRoot = Join-Path $fixture.Root ".orca/runs/$($fixture.TaskId)"
        $state = New-OrcaInfraState $fixture.Root $fixture.TaskId $task 'executing'
        $state.worktree = @{ id = 'wt-1'; path = $fixture.Root; branch = 'task/inf-001-infra-task' }
        $state.correctionCount = 2
        $state.halted = $true
        $state.haltReason = 'two-failed-corrections'
        & $infraModule { param($root, $runState) Save-OrcaRunState $root $runState } $runRoot $state
        Write-OrcaAgentFinishedEvent $runRoot (New-OrcaInfraResult -Stderr 'writer reported a functional failure')

        $recoverable = & $infraModule { param($root, $runState, $assignedTask) Test-OrcaInfrastructureRecovery -RunRoot $root -State $runState -Task $assignedTask } $runRoot $state $task
        Assert-False $recoverable
    }
    finally { Remove-OrcaInfraFixture $fixture.Root }
}
