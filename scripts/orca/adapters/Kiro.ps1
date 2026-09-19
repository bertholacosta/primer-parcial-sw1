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

function New-KiroInvocation {
    param(
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$Prompt,
        [Parameter(Mandatory)][string]$PromptPath,
        [Parameter(Mandatory)][string]$RunDirectory,
        [string]$SessionId
    )

    $arguments = @('chat', $Prompt, '--no-interactive', '--output-format', 'stream-json', '--trust-all-tools')
    if ($SessionId) {
        $arguments += @('--resume-id', $SessionId)
    }

    [pscustomobject]@{
        Executable = 'kiro-cli'
        Arguments = $arguments
        StandardInput = $null
        WorkingDirectory = $WorkingDirectory
    }
}
