# PrintFlow Print Agent

Lightweight Node.js script that runs on the **Windows admin PC** connected to the Epson L3000 via USB.

## How it fits in

```
Customer (any device)
    │  uploads job via browser
    ▼
Backend API (VPS / Docker)
    │  worker marks job PRINTING
    ▼
Print Agent  ← runs here, on the Windows PC
    │  downloads PDF, sends to Windows Print Spooler
    │  calls POST /agent/jobs/:id/complete
    ▼
Backend generates OTP, marks job READY
    │
    ▼
Customer gets OTP email → collects printout
```

## Setup

### 1. Printer names

Each file the agent downloads arrives with the Windows `device_name` of the
printer the backend routed it to — the shopkeeper enters those names when
registering printers in the dashboard. `PRINTER_NAME` in `.env` is only a
**last-resort fallback** for files that arrive without a device_name.

To find a printer's exact Windows name: **Control Panel → Devices and
Printers**, right-click the printer, and note the name shown at the top
(e.g. `EPSON L3000 Series`).

### 2. Configure

```bash
cd print-agent
copy .env.example .env   # Windows
# Edit .env: fill BACKEND_URL, AGENT_TOKEN, PRINTER_NAME
```

`AGENT_TOKEN` is this shop's device token, issued once by the backend via
`POST /shops/:shopId/agent-tokens` (log in as the shop's admin). It's shown
only at issuance — store it straight into `.env`. Lost it? Issue a new one
and revoke the old.

### 3. Install & run

```bash
npm install
node agent.js
```

You should see:
```
🖨  PrintFlow agent started
    Backend : http://your-vps:5000
    Printer : EPSON L3000 Series
    Poll    : every 5s
```

### 4. (Optional) Run as a Windows service

Use [NSSM](https://nssm.cc) or [node-windows](https://github.com/coreybutler/node-windows) to keep the agent running in the background and auto-start on boot.

```bash
# With node-windows:
npm install -g node-windows
node install-service.js   # (create this script yourself using node-windows docs)
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `401 Invalid agent token` | AGENT_TOKEN in `.env` is wrong, revoked, or for another backend/shop |
| `File not found or job not in PRINTING state` | Job may have already been completed or re-queued |
| PDF opens in viewer instead of printing | Make sure `pdf-to-printer` can find your printer by exact name |
| Jobs stay stuck in PRINTING | Check agent console — it will log errors and re-queue failed jobs |