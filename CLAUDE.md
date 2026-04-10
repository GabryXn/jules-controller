# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Questo repository è un **sistema di orchestrazione GitHub** centralizzato che gestisce automazioni su più repository target tramite GitHub Actions, Google Calendar e l'AI Jules di Google.

Struttura principale:
- `jules-controller/` — Hub di controllo centrale (workflow, configurazione, calendario)
- `jules-dispatch/` — Log di esecuzione delle GitHub Actions

## Comandi di Sviluppo

### Calendar Integration (TypeScript/Google Apps Script)

```bash
cd jules-controller/calendar-integration

pnpm install       # Installa dipendenze
pnpm run build     # Compila TypeScript → esbuild → Code.js
pnpm run deploy    # Build + clasp push verso Apps Script
pnpm run login     # Autentica con Google (clasp login)
```

### Script Python

```bash
cd jules-controller
python scripts/sync-schedules.py   # Sincronizza orari da jules_config.yml (Rome Time → UTC cron)
```

### Deploy tramite GitHub Actions

I workflow si attivano automaticamente. Per trigger manuali usare `workflow_dispatch` dalla UI di GitHub.

## Architettura

### Flusso di controllo

```
jules_config.yml + jules_targets.yml
        ↓
master-setup.yml  → Deploy jules_agent.yml su tutti i repo target
                  → Injects secrets, labels, branch protection

controller.yml    → Legge jules_targets.yml
                  → Dispatcha jules_agent.yml su ogni repo con i prompt definiti

calendar-integration (Apps Script)
                  → Monitora Google Calendar per eventi "Jules: owner/repo"
                  → Crea trigger one-time e dispatcha workflow GitHub
```

### File di configurazione chiave

- **`jules-controller/jules_config.yml`** — Feature flags (`cyclic_automation`, `issue_automation`, `calendar_automation`, `workflow_deployment`, `pr_review`) e orari schedulati in ora di Roma
- **`jules-controller/jules_targets.yml`** — Lista dei repository target con nome automation e prompt Jules
- **`jules-controller/templates/jules_agent.yml`** — Template del workflow deployato sui repo target; riceve prompt via `workflow_dispatch` o da issue con label `jules`
- **`jules-controller/templates/jules_reviewer.yml`** — Workflow Gemini Flash per review automatica PR (repo privati)
- **`jules-controller/templates/.coderabbit.yaml`** — Config CodeRabbit per review automatica PR (repo pubblici)

### Gestione timezone

Gli orari in `jules_config.yml` sono in ora di Roma (CET/CEST). `sync-schedules.py` converte automaticamente in UTC cron e aggiorna i workflow al push su `jules_config.yml` (via `auto-config-sync.yml`).

### Calendar Integration

Il modulo Apps Script (`calendar-integration/src/index.ts`) monitora gli eventi del calendario. Sintassi titolo supportata:
- `Jules: owner/repo` — singolo repository
- `Jules: owner/a, owner/b` — repository multipli
- `Jules: all` — tutti i repository con push access

Funzionalità principali:
- **Retry esponenziale**: 3 tentativi, 5s backoff per errori 5xx
- **Supporto ricorrenze**: pianifica fino a 2 trigger per serie (next + safety net) entro i 20 trigger GAS
- **Rilevamento modifiche**: checksum per evento, rescheduling automatico se titolo/descrizione/orario cambiano
- **Safety-net periodico**: trigger ogni 6 ore che rescansiona il calendario e pianifica nuove occorrenze
- **Finestra di esecuzione**: ±5 minuti per tollerare ritardi trigger GAS
- **Stato persistente**: `PropertiesService` conserva `SCHEDULED_EVENTS` (JSON) tra esecuzioni

### Pattern di sicurezza

- I prompt inviati a Jules sono delimitati con `--- USER REQUEST START/END ---` per protezione da prompt injection
- Jules non può fare merge diretto: crea sempre PR
- Branch protection attiva su tutti i repo gestiti
- Validazione token prima di ogni operazione

## Workflow GitHub Actions

| Workflow | Trigger | Scopo |
|---|---|---|
| `master-setup.yml` | Cron UTC 02:00 | Setup universale: secrets, template, labels, branch protection, reviewer deployment |
| `controller.yml` | Cron UTC 03:00 | Dispatcher principale: legge targets e attiva Jules |
| `auto-config-sync.yml` | Push su `jules_config.yml` / Cron UTC 00:00 | Sincronizza Rome Time → UTC nei workflow |
| `clasp-deploy-calendar.yml` | Push su `calendar-integration/**` | Build TypeScript + clasp push su Apps Script |
| `jules_agent.yml` (template) | `workflow_dispatch` / issue label | Eseguito nei repo target, invoca Jules AI |
| `jules_reviewer.yml` (template) | `pull_request` (opened/sync) | Review automatica PR con Gemini Flash (repo privati) |

### PR Review System

Il sistema di review automatica delle PR si adatta alla visibilità del repository:

- **Repo pubblici** → CodeRabbit (GitHub App gratuita, `.coderabbit.yaml` deployato automaticamente)
- **Repo privati** → Gemini 2.0 Flash via API gratuita (`jules_reviewer.yml` deployato automaticamente)

Il reviewer Gemini analizza il diff e assegna un verdict:
- `SAFE` (label verde `jules-safe`) — PR corretta, mergiabile
- `RISKY` (label gialla `jules-risky`) — richiede revisione umana
- `BROKEN` (label rossa `jules-broken`) — PR auto-chiusa con commento

Secrets necessari nel controller: `GEMINI_API_KEY` (gratuita da aistudio.google.com)

## Build System (Calendar Integration)

Il bundler è `esbuild` configurato in `calendar-integration/scripts/build.js`. Pipeline:

1. **esbuild** compila `src/index.ts` → `dist/Code.js` (formato IIFE, target ES2020)
2. **GAS function stubs**: il build appende automaticamente dichiarazioni `function` top-level che delegano a `globalThis`. Questo è necessario perché GAS riconosce le funzioni nel dropdown dell'editor solo se dichiarate a scope globale — le assegnazioni `globalThis.fn = fn` dentro un IIFE non sono sufficienti per la UI, ma funzionano per i trigger che invocano per nome.
3. **appsscript.json** viene copiato in `dist/` (timezone Europe/Rome, runtime V8)

Il `tsconfig.json` usa target ES2022 con strict mode. Il deploy CI avviene via `clasp-deploy-calendar.yml`.

## Prompt Library

`jules-controller/PROMPTS.md` contiene prompt pronti all'uso divisi in categorie:
- **Bug Hunt & Cleanup** — Qualità del codice
- **Security Audit** — Scansione vulnerabilità
- **Documentation Refresher** — Manutenzione documentazione
- **Dead Code & Import Cleanup** — Rimozione import/variabili inutilizzate e codice commentato obsoleto

## ⚠️ Repository Pubblica — Sicurezza

Questo progetto ha una **repository GitHub pubblica**. Rispettare sempre queste regole:

- **Non includere mai** chiavi API, token, password, credenziali o segreti nel codice o nei commit
- Usare **variabili d'ambiente** per tutti i valori sensibili; il file `.env` non va mai committato
- Verificare che `.gitignore` escluda `.env`, `*.key`, `*.pem` e qualsiasi file con segreti
- **Non loggare** dati sensibili (token, credenziali, risposte API con dati privati)
- Non includere URL interni, IP privati o dettagli di infrastruttura interna nel codice o nei commenti
- I messaggi di commit devono essere appropriati per una audience pubblica
- Revisionare ogni diff prima del push per escludere esposizioni accidentali di dati sensibili
