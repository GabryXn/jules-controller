# 🤖 Jules Prompt Library

Una collezione di prompt ottimizzati per ottenere il meglio da Jules. Copia e incolla questi testi nelle Issue o negli eventi del Calendario.

> **⚠️ Regola critica per "Jules: all":** Jules degrada drasticamente con prompt multi-obiettivo.
> Quando usi un evento calendario con target `Jules: all` o `Jules: owner/a, owner/b`,
> usa **sempre e solo un prompt mono-task** (come quello nella sezione "Manutenzione Periodica" qui sotto).
> I prompt multi-task (Bug Hunt, Security + Docs insieme, ecc.) vanno usati solo su **singoli repository**
> dove conosci il contesto specifico e hai definito chiaramente le priorità.

---

## 🗓️ Manutenzione Periodica — Jules: all (Evento Calendario)

> **Questo è l'unico prompt raccomandato per eventi `Jules: all`.**
>
> **Perché un solo task?** La ricerca su Jules (Gemini 2.5 Pro) mostra che i prompt multi-obiettivo
> producono output degradato: Jules tenta di fare tutto e fa tutto male. Un singolo task concreto
> produce PR pulite, reviewable, e a rischio zero di regressione su qualsiasi tipo di repository.
>
> **Cosa fa:** Rimuove dead code (import inutilizzati, variabili non usate, codice commentato stale)
> e aggiunge null guard dove il rischio è ovvio e isolato. Zero modifiche alla business logic.
> Funziona su Node, Python, Go, Java, Rust — qualsiasi linguaggio.
>
> **Frequenza consigliata:** Settimanale o bisettimanale.

**Prompt** _(incolla questo testo nella descrizione dell'evento Google Calendar)_:

```
You are a Senior Software Engineer performing a recurring codebase hygiene pass.
This is a maintenance task — keep changes small, safe, and independently reviewable.

## STEP 1 — ORIENTATION (mandatory before touching any file)
1. Read CLAUDE.md, AGENTS.md, or README.md to understand the tech stack, directory layout,
   and development conventions. If none exist, infer from the codebase structure.
2. Detect the package manager from lock files in the repo root:
   pnpm-lock.yaml → pnpm | yarn.lock → yarn | package-lock.json → npm
   uv.lock / pyproject.toml → uv | poetry.lock → poetry | Pipfile → pipenv
   Use ONLY the detected package manager. Never substitute it.
3. Identify the test command (check package.json scripts, Makefile, pyproject.toml, etc.).

## STEP 2 — SCAN (these are the ONLY categories you may change)

a) UNUSED IMPORTS
   Remove imports, requires, or using statements for symbols never referenced in that file.
   Skip if the import has a side-effect comment (e.g. "// side effect import").

b) UNUSED LOCAL VARIABLES
   Remove local variables declared but never read after assignment.
   Exception: variables prefixed with _ are intentionally unused — leave them untouched.

c) STALE COMMENTED-OUT CODE
   Remove blocks of code that were commented out with no explanatory context.
   DO NOT remove: explanatory comments, TODO/FIXME/HACK/NOTE markers, license headers,
   docstring examples, or commented code that has an explanation immediately above it.

d) OBVIOUS NULL SAFETY GAPS (only when isolated and unambiguous)
   If you find a direct property access on a value that clearly comes from an external
   source (API response, user input, database result) with zero null/undefined guard,
   add a minimal guard (optional chaining, early return, or null check).
   Skip this entire category if fixing it requires understanding complex business logic.

## STEP 3 — CONSTRAINTS (read before writing a single line)
- Touch ONLY files where you remove or fix something in the categories above.
- Do NOT refactor, rename, reorganize, or "improve" anything out of scope.
- Do NOT change function signatures, API contracts, or exported interfaces.
- Do NOT add new dependencies or new features.
- Match the existing code style exactly — indentation, quotes, semicolons, etc.

## STEP 4 — VERIFY
Run the existing test suite after all changes. Confirm it passes.
If ANY test fails → revert ALL changes and do not create a PR.

## STEP 5 — PULL REQUEST
Create a PR ONLY if you found and removed/fixed at least one item.
Title: "chore: weekly hygiene — remove dead code and unused imports"
Body: for each file modified, list what was removed and the line count change.
NEVER merge the PR. NEVER push directly to the default branch.
If nothing was found in any category, do NOT create a PR.
```

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
