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

- **`jules-controller/jules_config.yml`** — Feature flags (`cyclic_automation`, `issue_automation`, `calendar_automation`, `workflow_deployment`) e orari schedulati in ora di Roma
- **`jules-controller/jules_targets.yml`** — Lista dei repository target con nome automation e prompt Jules
- **`jules-controller/templates/jules_agent.yml`** — Template del workflow deployato sui repo target; riceve prompt via `workflow_dispatch` o da issue con label `jules`

### Gestione timezone

Gli orari in `jules_config.yml` sono in ora di Roma (CET/CEST). `sync-schedules.py` converte automaticamente in UTC cron e aggiorna i workflow al push su `jules_config.yml` (via `auto-config-sync.yml`).

### Calendar Integration

Il modulo Apps Script (`calendar-integration/src/index.ts`) monitora gli eventi del calendario. Un evento deve avere nel titolo la sintassi `Jules: owner/repo` per essere riconosciuto. Supporta retry esponenziale (3 tentativi, 5s backoff) e deduplicazione a 5 minuti tramite `PropertiesService`.

### Pattern di sicurezza

- I prompt inviati a Jules sono delimitati con `--- USER REQUEST START/END ---` per protezione da prompt injection
- Jules non può fare merge diretto: crea sempre PR
- Branch protection attiva su tutti i repo gestiti
- Validazione token prima di ogni operazione

## Workflow GitHub Actions

| Workflow | Trigger | Scopo |
|---|---|---|
| `master-setup.yml` | Cron UTC 02:00 | Setup universale: secrets, template, labels, branch protection |
| `controller.yml` | Cron UTC 03:00 | Dispatcher principale: legge targets e attiva Jules |
| `auto-config-sync.yml` | Push su `jules_config.yml` | Sincronizza Rome Time → UTC nei workflow |
| `jules_agent.yml` (template) | `workflow_dispatch` / issue label | Eseguito nei repo target, invoca Jules AI |

## Build System (Calendar Integration)

Il bundler è `esbuild` configurato in `calendar-integration/build.js`. Produce un IIFE wrappato (`Code.js`) compatibile con Google Apps Script V8 runtime. Il `tsconfig.json` usa target ES2022 con strict mode.

## Prompt Library

`jules-controller/PROMPTS.md` contiene prompt pronti all'uso divisi in categorie:
- **Bug Hunt & Cleanup** — Qualità del codice
- **Security Audit** — Scansione vulnerabilità
- **Documentation Refresher** — Manutenzione documentazione
