function Get-KiroAdapter {
    [pscustomobject]@{
        Id = 'kiro'
        DisplayName = 'Kiro'
        Executable = 'kiro-cli'
        OrcaAgentId = 'kiro'
        Mode = 'non-interactive-stream-json'
        SupportsResume = $true
        SupportsWrite = $true
        HelpVerified = $true
    }
}

function Get-KiroEngineFormatStatus {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $outputFormat = $null
    $engine = $null
    for ($index = 0; $index -lt $Arguments.Count; $index++) {
        $token = [string]$Arguments[$index]
        if ($token -eq '--output-format' -and $index + 1 -lt $Arguments.Count) { $outputFormat = [string]$Arguments[$index + 1] }
        elseif ($token -match '^--output-format=(.+)$') { $outputFormat = $Matches[1] }
        elseif ($token -eq '--agent-engine' -and $index + 1 -lt $Arguments.Count) { $engine = [string]$Arguments[$index + 1] }
        elseif ($token -match '^--agent-engine=(.+)$') { $engine = $Matches[1] }
        elseif ($token -eq '--v3') { $engine = 'v3' }
        elseif ($token -eq '--v2') { $engine = 'v2' }
    }

    $compatible = $true
    $detail = "engine=$($engine); output-format=$outputFormat"
    if ($outputFormat -eq 'stream-json' -and $engine -eq 'v1') {
        $compatible = $false
        $detail = '--output-format stream-json is not supported on the v1 engine; pass --agent-engine v2 or v3.'
    }

    [ordered]@{
        engine = $engine
        outputFormat = $outputFormat
        compatible = $compatible
        detail = $detail
    }
}

function Assert-KiroCompatibleInvocation {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $status = Get-KiroEngineFormatStatus $Arguments
    if (-not $status.compatible) {
        throw "Incompatible kiro-cli engine/output-format combination: $($status.detail)"
    }
}

function New-KiroInvocation {
    param(
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$Prompt,
        [Parameter(Mandatory)][string]$PromptPath,
        [Parameter(Mandatory)][string]$RunDirectory,
        [string]$SessionId
    )

    $arguments = @('chat', $Prompt, '--no-interactive', '--agent-engine', 'v3', '--output-format', 'stream-json', '--trust-all-tools')
    if ($SessionId) {
        $arguments += @('--resume-id', $SessionId)
    }
    Assert-KiroCompatibleInvocation $arguments

    [pscustomobject]@{
        Executable = 'kiro-cli'
        Arguments = $arguments
        StandardInput = $null
        WorkingDirectory = $WorkingDirectory
    }
}

function Get-KiroPreflightProbes {
    $invocation = New-KiroInvocation -WorkingDirectory '<WORKDIR>' -Prompt 'preflight' -PromptPath '<PROMPT_FILE>' -RunDirectory '<RUN_DIR>' -SessionId $null
    $compatibility = Get-KiroEngineFormatStatus $invocation.Arguments
    @(
        [pscustomobject]@{
            name = 'kiro-cli:engine-format-combination'
            executable = $null
            arguments = @()
            staticOk = $compatibility.compatible
            detail = $compatibility.detail
        }
        [pscustomobject]@{
            name = 'kiro-cli:engine-v3-stream-json-parse'
            executable = 'kiro-cli'
            arguments = @($invocation.Arguments) + @('--help')
            expectExitCode = 0
            stdoutMustContain = @('--agent-engine', 'stream-json')
            staticOk = $null
            detail = 'non-destructive parse check of the writer invocation against the installed kiro-cli'
        }
    )
}
