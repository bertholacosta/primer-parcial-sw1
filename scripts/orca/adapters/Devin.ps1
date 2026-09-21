function Get-DevinAdapter {
    [pscustomobject]@{
        Id = 'devin'
        DisplayName = 'Devin CLI'
        Executable = 'devin'
        OrcaAgentId = 'devin'
        Mode = 'non-interactive-export'
        SupportsResume = $true
        SupportsWrite = $true
        HelpVerified = $true
    }
}

$script:DevinRequiredValueOptions = @('--permission-mode', '--respect-workspace-trust', '--prompt-file', '--resume', '--model', '--config')
$script:DevinOptionalValueOptions = @('--export', '--print', '-p', '-r')
# Options that devin 3000.x requires before any [PATH]... positional or the '--' prompt separator.
# The external Orca launcher previously emitted these options after a PATH, which the installed
# CLI rejected. The internal adapter builds its own ordered list and stays independent of that launcher.
$script:DevinOrderedGuardOptions = @('--permission-mode', '--respect-workspace-trust', '--prompt-file', '--export', '--print', '-p')

function Get-DevinFirstPositionalIndex {
    param([Parameter(Mandatory)][string[]]$Arguments)

    for ($index = 0; $index -lt $Arguments.Count; $index++) {
        $token = [string]$Arguments[$index]
        if ($token -eq '--') { return $index }
        if ($token.StartsWith('-')) {
            $name = ($token -split '=', 2)[0]
            if ($token.Contains('=')) { continue }
            if ($script:DevinRequiredValueOptions -contains $name) { $index++; continue }
            if ($script:DevinOptionalValueOptions -contains $name -and $index + 1 -lt $Arguments.Count -and -not ([string]$Arguments[$index + 1]).StartsWith('-')) { $index++ }
            continue
        }
        return $index
    }
    return -1
}

function Get-DevinArgumentOrderViolations {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $boundary = Get-DevinFirstPositionalIndex $Arguments
    if ($boundary -lt 0) { return @() }
    $violations = [System.Collections.Generic.List[string]]::new()
    for ($index = $boundary; $index -lt $Arguments.Count; $index++) {
        $name = (([string]$Arguments[$index]) -split '=', 2)[0]
        if ($script:DevinOrderedGuardOptions -contains $name) {
            $violations.Add("$name appears after a PATH or '--' separator at position $index; all options must precede positional arguments.")
        }
    }
    return @($violations)
}

function Assert-DevinArgumentOrder {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $violations = @(Get-DevinArgumentOrderViolations $Arguments)
    if ($violations.Count -gt 0) {
        throw ($violations -join ' ')
    }
}

function New-DevinInvocation {
    param(
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$Prompt,
        [Parameter(Mandatory)][string]$PromptPath,
        [Parameter(Mandatory)][string]$RunDirectory,
        [string]$SessionId
    )

    $permissionMode = if ($env:DEVIN_PERMISSION_MODE) { $env:DEVIN_PERMISSION_MODE } else { 'dangerous' }
    $arguments = @(
        '--permission-mode', $permissionMode,
        '--respect-workspace-trust', 'false',
        '--prompt-file', $PromptPath,
        '--export', (Join-Path $RunDirectory 'devin-session.json')
    )
    if ($SessionId) {
        $arguments += @('--resume', $SessionId)
    }
    $arguments += '--print'
    Assert-DevinArgumentOrder $arguments

    [pscustomobject]@{
        Executable = 'devin'
        Arguments = $arguments
        StandardInput = $null
        WorkingDirectory = $WorkingDirectory
    }
}

function Get-DevinPreflightProbes {
    $invocation = New-DevinInvocation -WorkingDirectory '<WORKDIR>' -Prompt '<PROMPT>' -PromptPath '<PROMPT_FILE>' -RunDirectory '<RUN_DIR>' -SessionId $null
    @(
        [pscustomobject]@{
            name = 'devin:argument-order'
            executable = $null
            arguments = @()
            staticOk = (@(Get-DevinArgumentOrderViolations $invocation.Arguments).Count -eq 0)
            detail = 'all options precede any PATH or -- separator'
        }
        [pscustomobject]@{
            name = 'devin:argument-parse'
            executable = 'devin'
            arguments = @($invocation.Arguments) + @('--version')
            expectExitCode = 0
            stdoutMustContain = @('devin')
            staticOk = $null
            detail = 'non-destructive parse check of the writer invocation against the installed devin CLI'
        }
    )
}
