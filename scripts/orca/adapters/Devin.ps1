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

function New-DevinInvocation {
    param(
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$Prompt,
        [Parameter(Mandatory)][string]$PromptPath,
        [Parameter(Mandatory)][string]$RunDirectory,
        [string]$SessionId
    )

    $arguments = @('--print', '--prompt-file', $PromptPath, '--export', (Join-Path $RunDirectory 'devin-session.json'), '--permission-mode', 'accept-edits', '--respect-workspace-trust', 'false')
    if ($SessionId) {
        $arguments += @('--resume', $SessionId)
    }

    [pscustomobject]@{
        Executable = 'devin'
        Arguments = $arguments
        StandardInput = $null
        WorkingDirectory = $WorkingDirectory
    }
}
