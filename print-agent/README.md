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

### 1. Find your printer name

Open **Control Panel → Devices and Printers**, right-click the Epson L3000, and note the exact name shown at the top (e.g. `EPSON L3000 Series`).

### 2. Configure

```bash
cd print-agent
copy .env.example .env   # Windows
# Edit .env: fill BACKEND_URL, AGENT_SECRET, PRINTER_NAME
```

`AGENT_SECRET` must match the `AGENT_SECRET` value in your backend `.env`.

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
| `401 Invalid agent secret` | AGENT_SECRET in `.env` doesn't match backend |
| `File not found or job not in PRINTING state` | Job may have already been completed or re-queued |
| PDF opens in viewer instead of printing | Make sure `pdf-to-printer` can find your printer by exact name |
| Jobs stay stuck in PRINTING | Check agent console — it will log errors and re-queue failed jobs |