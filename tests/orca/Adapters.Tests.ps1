$adaptersModule = Get-Module OrcaPipeline

It 'invokes kiro-cli with engine v3 and stream-json' {
    $invocation = & $adaptersModule {
        param()
        New-KiroInvocation -WorkingDirectory 'C:\worktree' -Prompt 'implement the task' -PromptPath 'C:\prompt.txt' -RunDirectory 'C:\run' -SessionId $null
    }
    Assert-Equal 'kiro-cli' $invocation.Executable
    Assert-Equal 'chat' $invocation.Arguments[0]
    Assert-Equal 'implement the task' $invocation.Arguments[1]
    Assert-True ($invocation.Arguments -contains '--no-interactive')
    Assert-True ($invocation.Arguments -contains '--trust-all-tools')
    $engineIndex = [Array]::IndexOf($invocation.Arguments, '--agent-engine')
    $formatIndex = [Array]::IndexOf($invocation.Arguments, '--output-format')
    Assert-True ($engineIndex -ge 0) 'Missing --agent-engine.'
    Assert-True ($formatIndex -ge 0) 'Missing --output-format.'
    Assert-Equal 'v3' $invocation.Arguments[$engineIndex + 1]
    Assert-Equal 'stream-json' $invocation.Arguments[$formatIndex + 1]
}

It 'detects an incompatible engine and output-format combination before launch' {
    $status = & $adaptersModule {
        param()
        Get-KiroEngineFormatStatus @('chat', 'prompt', '--no-interactive', '--agent-engine', 'v1', '--output-format', 'stream-json', '--trust-all-tools')
    }
    Assert-False $status.compatible
    Assert-Equal 'v1' $status.engine
    Assert-Equal 'stream-json' $status.outputFormat
    $message = $null
    try {
        & $adaptersModule {
            param()
            Assert-KiroCompatibleInvocation @('chat', 'prompt', '--agent-engine', 'v1', '--output-format', 'stream-json')
        }
    }
    catch { $message = $_.Exception.Message }
    Assert-True ([bool]$message) 'Expected the incompatible combination to be rejected.'
    Assert-True ($message -match 'engine') "Unexpected error: $message"
}

It 'orders every devin option before any path or separator' {
    $invocation = & $adaptersModule {
        param()
        New-DevinInvocation -WorkingDirectory 'C:\worktree' -Prompt 'prompt' -PromptPath 'C:\prompt.txt' -RunDirectory 'C:\run' -SessionId $null
    }
    $expected = @(
        '--permission-mode', 'accept-edits',
        '--respect-workspace-trust', 'false',
        '--prompt-file', 'C:\prompt.txt',
        '--export', 'C:\run\devin-session.json',
        '--print'
    )
    Assert-Equal ($expected -join '|') (@($invocation.Arguments) -join '|')
    Assert-Equal '--print' $invocation.Arguments[-1]
    $violations = @(& $adaptersModule { param($arguments) Get-DevinArgumentOrderViolations $arguments } $invocation.Arguments)
    Assert-Equal 0 $violations.Count
}

It 'rejects devin options placed after a path' {
    foreach ($flag in @('--permission-mode', '--respect-workspace-trust', '--prompt-file', '--export', '--print')) {
        $violations = @(& $adaptersModule { param($arguments) Get-DevinArgumentOrderViolations $arguments } @('C:\worktree', $flag, 'value'))
        Assert-True ($violations.Count -ge 1) "$flag after a PATH was not rejected."
    }
}

It 'rejects devin options placed after the -- separator' {
    foreach ($flag in @('--permission-mode', '--respect-workspace-trust', '--prompt-file', '--export', '--print')) {
        $violations = @(& $adaptersModule { param($arguments) Get-DevinArgumentOrderViolations $arguments } @('--permission-mode', 'accept-edits', '--', $flag))
        Assert-True ($violations.Count -ge 1) "$flag after '--' was not rejected."
    }
}

It 'includes non-destructive adapter parse probes in preflight' {
    $preflight = & $adaptersModule { param($root) Get-OrcaPreflight $root } $repoRoot
    Assert-True $preflight.success
    $names = @($preflight.checks.name)
    Assert-True ($names -contains 'kiro-cli:engine-format-combination')
    Assert-True ($names -contains 'kiro-cli:engine-v3-stream-json-parse')
    Assert-True ($names -contains 'devin:argument-order')
    Assert-True ($names -contains 'devin:argument-parse')
    foreach ($check in @($preflight.checks | Where-Object { $_.name -match 'kiro-cli:|devin:' })) {
        Assert-True $check.ok "Probe $($check.name) failed: $($check.detail)"
    }
}
