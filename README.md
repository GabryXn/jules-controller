# 🤖 Google Jules Master Controller

Questo repository funge da **Cervello Centrale** per l'orchestrazione di Google Jules su tutti i tuoi repository GitHub. Permette di gestire automazioni cicliche notturne e abilita la programmazione remota tramite Issue (anche da mobile).

---

## 🏗️ Architettura del Sistema

Il sistema è composto da un controller centrale (questo repo) che "inietta" le dipendenze e i comandi necessari nei repository target.

```mermaid
graph TD
    subgraph "Jules Controller (Central Hub)"
        A[jules_targets.yml] --> B[.github/workflows/controller.yml]
        C[.github/workflows/master-setup.yml]
        D[.github/workflows/auto-config-sync.yml]
    end

    subgraph "Target Repositories (Any Repo)"
        B -->|Dispatch| E[.github/workflows/jules_agent.yml]
        C -->|Inject| F[JULES_API_KEY Secret]
        C -->|Deploy| E
        C -->|Create| G[Label: jules]
        H[New Issue + Label: jules] -->|Trigger| E
    end

    E -->|Invoke| I[Google Jules AI]
```

---

## 🚀 Funzionalità Principali

### 1. Automazione Ciclica Programmata (`controller.yml`)

- **Esecuzione:** Ogni notte alle **04:00 AM (Rome Time)**.
- **Logica:** Legge il file `jules_targets.yml`, itera sui repository specificati e lancia le automazioni definite.
- **Robustezza**: Valida i token prima di iniziare e fornisce suggerimenti di debug in caso di fallimento del dispatch.

### 2. Sincronizzazione Universale (`master-setup.yml`)

- **Esecuzione:** Ogni notte alle **03:00 AM (Rome Time)**.
- **Scope:** Agisce su **tutti i repository** dell'account `GabryXn`.
- **Azioni Sequenziali**:
  1. Iniezione automatica della `JULES_API_KEY`.
  2. Deployment/Aggiornamento del workflow `jules_agent.yml`.
  3. Creazione della label `jules` (colore viola `715cd7`).
- **Vantaggio**: Essendo sequenziale, garantisce che i segreti siano pronti prima dei workflow.

---

## ⚙️ Configurazione Iniziale

Per far funzionare il controller, devono essere impostati i seguenti **Repository Secrets** in questo repository (`jules-controller`):

1. **`PAT_TOKEN`**: Un GitHub Personal Access Token (Fine-grained) con permessi di:
   - `Contents: Read & Write`
   - `Workflows: Read & Write`
   - `Secrets: Read & Write`
   - `Metadata: Read-only`
2. **`JULES_API_KEY`**: La tua chiave API per accedere a Google Jules.

Una volta impostati i secret, i workflow notturni si occuperanno di configurare tutto l'ecosistema GitHub automaticamente. Non è necessario eseguire script locali.

---

### 3. Programmazione via Issue (Remote Access)

Grazie al workflow deployato in ogni repo (pubblico o **privato**), puoi comandare Jules direttamente dalle Issue di GitHub:

1. Crea una Issue in qualsiasi repo.
2. Descrivi cosa vuoi fare (es. "Aggiungi logica di validazione al form di login").
3. Aggiungi la label `jules`.
4. Jules leggerà l'issue e proporrà una Pull Request con le modifiche.

---

## 📂 Struttura del Repository

### `.github/workflows/`

- **`controller.yml`**: Il dispatcher principale per i task pianificati.
- **`master-setup.yml`**: Si assicura che ogni repo abbia la chiave API corretta e i workflow aggiornati (Consolidato).
- **`auto-config-sync.yml`**: Sincronizza automaticamente gli orari dal file `jules_config.yml`.

### `templates/`

- **`jules_agent.yml`**: Il workflow "operaio" che viene copiato nei repo target. Utilizza l'azione ufficiale `google-labs-code/jules-action@v1.0.0`.

### `jules_targets.yml`

Il file di configurazione per i task ciclici. Contiene:

- Elenco dei repo da monitorare.
- Elenco delle automazioni (nome + prompt dettagliato).
- Un template integrato per aggiungere facilmente nuovi target.

### `jules_config.yml`

Il file di **Controllo Globale** (Centralized Control). Permette di abilitare/disabilitare intere categorie di trigger con un solo flag:

- `cyclic_automation`: Attiva/Disattiva l'esecuzione notturna dei target.
- `issue_automation`: Attiva/Disattiva la risposta di Jules alle Issue etichettate.
- `calendar_automation`: Attiva/Disattiva l'invio di comandi dal calendario.
- `workflow_deployment`: Attiva/Disattiva la sincronizzazione automatica dei repo target.

---

## 📅 4. Automazione tramite Google Calendar (Event-Driven)

Jules può essere innescato puntualmente al minuto creando un evento sul tuo Google Calendar. Per far questo, c'è un progetto **Node.js/TypeScript** nella cartella `calendar-integration`. L'architettura non usa polling fisso, ma un approccio 100% event-driven ottimizzato per non sprecare risorse su Apps Script.

### Come funziona

1. Crei un evento intitolato `Jules: tuo-username/tuo-repo` sul calendario. La descrizione dell'evento diventa il prompt per Jules.
2. Il trigger **OnChange** di Google Calendar nota l'evento e crea un trigger temporale "usa-e-getta" programmato esattamente all'orario di inizio.
3. All'orario stabilito, il trigger si attiva, fa la chiamata API a GitHub, e poi **si autodistrugge**.

### Installazione e Deployment

Avrai bisogno di Node.js e `pnpm` (o `npm`/`yarn`) installati sul tuo PC, e devi aver abilitato l'Accesso alle API di Google Apps Script (in <https://script.google.com/home/usersettings>).

1. **Inizializza il progetto Apps Script vuoto:**
   Crea un nuovo progetto su script.google.com e segnati il suo **Script ID** (si trova in Impostazioni progetto).

2. **Configurazione Clasp Locale:**

   ```bash
   cd calendar-integration
   pnpm install
   pnpm run login  # Fai il login con il tuo account Google
   ```

   Crea un file `.clasp.json` nella cartella `calendar-integration` con questo contenuto (inserisci il tuo Script ID):

   ```json
   {
     "scriptId": "IL_TUO_SCRIPT_ID",
     "rootDir": "dist"
   }
   ```

3. **Compilazione e Deployment:**

   ```bash
   pnpm run deploy
   ```

   *Questo comando compilerà il codice TypeScript tramite `esbuild` nel file `dist/Code.js` e farà il push su Apps Script tramite clasp.*

4. **Configurazione su Apps Script:**
   - Vai sul tuo progetto Apps Script nel browser.
   - Vai su **Impostazioni progetto > Proprietà dello script** e aggiungi una nuova proprietà:
     - Proprietá: `PAT_TOKEN`
     - Valore: `[IL_TUO_GITHUB_PAT_TOKEN]` (con permessi `actions:write`)
   - Seleziona la funzione `setupCalendarTrigger` ed **eseguila una sola volta** manualmente usando il tasto "Esegui" nell'editor di Apps Script. Questo creerà il trigger che si sveglia ai cambiamenti del tuo calendario.

Ora sei pronto! Crea semplicemente un evento su Google Calendar con titolo `Jules: GabryXn/tuo-repo` e metti le istruzioni come descrizione dell'evento.

---

## 🛠️ Risoluzione dei Problemi & Sicurezza

### Tabella dei Codici di Errore

| Errore | Causa Probabile | Soluzione |
| :--- | :--- | :--- |
| `PAT_TOKEN is invalid` | Token scaduto o revocato | Rigenera il Fine-grained PAT su GitHub e aggiorna il Secret. |
| `404 Not Found` | Mancanza permessi repo | Assicurati che il PAT abbia accesso ai repository target. |
| `Could not find workflow` | Setup non completato | Attendi l'esecuzione di `master-setup.yml` o avvialo manualmente. |
| `JULES_API_KEY missing` | Secret non impostato | Aggiungi `JULES_API_KEY` ai Secret del repository controller. |

### Log e Debug

### Sicurezza (Best Practices)

- **Prompt Injection**: Gli input provenienti dalle Issue sono chiaramente delimitati per evitare che Jules interpreti il corpo del testo come comandi di sistema.
- **Minimo Privilegio**: Usa un GitHub PAT con i permessi minimi necessari descritti sopra.
- **Rotazione Segreti**: Si consiglia di ruotare periodicamente la `JULES_API_KEY` e il `PAT_TOKEN`.

---

*Creato con ❤️ per massimizzare la produttività con Google Jules.*
