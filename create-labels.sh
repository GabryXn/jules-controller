#!/bin/bash

# ==============================================================================
# Script per creare la label 'jules' in tutti i repository
# ==============================================================================

echo "========================================================="
echo "🏷️  Creazione label 'jules' in tutti i tuoi repository"
echo "========================================================="

# Ottiene tutti i repository e cilca
gh repo list GabryXn --limit 1000 --no-archived --json nameWithOwner --jq '.[].nameWithOwner' | while read -r REPO; do
  echo "→ Controllo $REPO"
  
  # Prova a creare la label usando la API di GitHub
  # Se la label esiste già, l'API restituirà un errore 422 (Unprocessable Entity)
  # che noi ignoriamo felicemente.
  gh api \
    --method POST \
    -H "Accept: application/vnd.github+json" \
    /repos/$REPO/labels \
    -f name='jules' \
    -f description='Trigga il Google Jules AI Agent' \
    -f color='715cd7' \
    --silent 2>/dev/null
  
  # Verifichiamo se il comando precedente è andato a buon fine
  # exit code 0 = label creata
  # exit code 22 (o altro) = label probabilmente esiste già
  if [ $? -eq 0 ]; then
    echo "  ✅ Label creata!"
  else
    echo "  ⚡ Label già esistente o errore ignorato."
  fi
done

echo ""
echo "🎉 Finito! Ora puoi usare la label 'jules' su qualsiasi repo."
