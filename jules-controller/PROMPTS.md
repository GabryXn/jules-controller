# 🤖 Jules Prompt Library

Una collezione di prompt ottimizzati per ottenere il meglio da Jules. Copia e incolla questi testi nelle Issue o negli eventi del Calendario.

---

## 🔍 Bug Hunt & Cleanup (Il più versatile)

Usa questo prompt per una manutenzione generale del codice.

**Prompt:**
> OBIETTIVO: Agisci come un Senior Software Engineer per eseguire una revisione della qualità e una pulizia del codice.
>
> COMPITI:
>
> 1. **Ricerca Bug**: Identifica potenziali errori logici, variabili non definite o condizioni che potrebbero causare crash.
> 2. **Rimozione Codice Morto**: Elimina import inutilizzati e variabili mai usate.
> 3. **Standardizzazione**: Uniforma l'indentazione e lo stile del codice.
> 4. **Documentazione**: Aggiungi commenti JSDoc alle funzioni complesse.
>
> VINCOLI: Solo refactoring sicuro, crea PR, NON mergere.

---

## 🛡️ Security Audit

Usa questo prompt se vuoi che Jules cerchi vulnerabilità specifiche.

**Prompt:**
> OBIETTIVO: Agisci come un esperto di Cyber Security per analizzare il repository.
>
> COMPITI:
>
> 1. Cerca file con chiavi API o segreti hardcoded.
> 2. Verifica che le dipendenze nel `package.json` non abbiano vulnerabilità note.
> 3. Controlla che le chiamate esterne siano protette e gli input validati.
> 4. Se trovi un problema, correggilo o aggiungi un commento `// SECURITY-FIX:`.
>
> VINCOLI: Genera report dettagliato nella PR.

---

## ✍️ Documentation Refresher

Usa questo prompt per rimettere a nuovo il README e i commenti.

**Prompt:**
> OBIETTIVO: Agisci come un Technical Writer.
>
> COMPITI:
>
> 1. Analizza il codice e aggiorna il `README.md` se mancano istruzioni di installazione o nuove funzioni.
> 2. Assicurati che ogni file abbia un'intestazione che ne spieghi lo scopo.
> 3. Traduci eventuali commenti misti in un'unica lingua coerente.

---

## 🧹 Dead Code & Import Cleanup

Usa questo prompt per rimuovere codice inutile senza modificare la logica.

**Prompt:**
> TASK: Dead Code & Import Cleanup
>
> OBIETTIVO: Trova ed elimina il codice inutile nel repository senza alterare il comportamento dell'applicazione.
>
> STEP 1 — Leggi README.md o CLAUDE.md per capire il linguaggio e la struttura del progetto.
>
> STEP 2 — Esegui questi task nell'ordine:
> 1. Rimuovi gli import inutilizzati (variabili, moduli, tipi mai referenziati).
> 2. Elimina variabili locali dichiarate ma mai usate.
> 3. Rimuovi blocchi di codice commentati che non servono (NON rimuovere commenti esplicativi o TODO/FIXME).
> 4. Se trovi una funzione esportata ma mai importata altrove nel repo, aggiungi un commento `// UNUSED: verifica se eliminabile` invece di cancellarla.
>
> STEP 3 — Crea una Pull Request con titolo: `chore: remove dead code and unused imports`
> Nella descrizione della PR elenca i file modificati e quanti import/variabili sono stati rimossi.
>
> VINCOLI ASSOLUTI:
> - NON modificare la logica di business.
> - NON rinominare variabili o funzioni.
> - NON aggiungere nuove funzionalità.
> - NON effettuare il merge della PR.
> - Se non trovi nulla da rimuovere, crea comunque una PR con nota "No dead code found".
