# ==============================================================================
# Script per creare la label 'jules' in tutti i repository
# ==============================================================================

Write-Host "========================================================="
Write-Host "🏷️  Creazione label 'jules' in tutti i tuoi repository"
Write-Host "========================================================="

# Ottiene tutti i repository
$repos = gh repo list GabryXn --limit 1000 --no-archived --json nameWithOwner --jq '.[].nameWithOwner' | Out-String -Stream

foreach ($repo in $repos) {
    if ([string]::IsNullOrWhiteSpace($repo)) { continue }
    
    Write-Host "→ Controllo $repo"
    
    # Prova a creare la label usando la API di GitHub
    $output = gh api --method POST `
        -H "Accept: application/vnd.github+json" `
        /repos/$repo/labels `
        -f name='jules' `
        -f description='Trigga il Google Jules AI Agent' `
        -f color='715cd7' 2>&1
        
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✅ Label creata!" -ForegroundColor Green
    } else {
        Write-Host "  ⚡ Label già esistente o errore ignorato." -ForegroundColor Yellow
    }
}

Write-Host "`n🎉 Finito! Ora puoi usare la label 'jules' su qualsiasi repo." -ForegroundColor Cyan
