// backend/services/printer.service.js
import ipp from "ipp";
import fs from "fs";

const PRINTER_URI = process.env.PRINTER_URI;
const MOCK_MODE = process.env.PRINTER_MOCK === "true" || !PRINTER_URI;

// IPP attribute mappings
const IPP_SIDES = {
  true:  "two-sided-long-edge",
  false: "one-sided",
};
const IPP_COLOR = {
  true:  "color",
  false: "monochrome",
};
const IPP_ORIENTATION = {
  portrait:  3,
  landscape: 4,
};
const IPP_PAPER = {
  A4:     "iso_a4_210x297mm",
  Letter: "na_letter_8.5x11in",
  A3:     "iso_a3_297x420mm",
};

/**
 * Send a single file to the printer via IPP.
 * Returns the IPP job-id assigned by the printer (or a mock ID).
 */
export async function sendFileToPrinter(filePath, fileSettings) {
  if (MOCK_MODE) {
    console.log(`[MOCK] Would print ${filePath} with settings:`, fileSettings);
    await new Promise((r) => setTimeout(r, 1500)); // simulate network delay
    return `mock-${Date.now()}`;
  }

  const {
    copies       = 1,
    color        = false,
    double_sided = false,
    orientation  = "portrait",
    paper_size   = "A4",
  } = fileSettings;

  const fileBuffer = fs.readFileSync(filePath);
  const printer    = ipp.Printer(PRINTER_URI);

  const msg = {
    "operation-attributes-tag": {
      "requesting-user-name": "printflow",
      "job-name":             `job-${Date.now()}`,
      "document-format":      "application/pdf",
    },
    "job-attributes-tag": {
      copies,
      sides:                     IPP_SIDES[String(double_sided)],
      "print-color-mode":        IPP_COLOR[String(color)],
      "orientation-requested":   IPP_ORIENTATION[orientation] || 3,
      media:                     IPP_PAPER[paper_size] || "iso_a4_210x297mm",
    },
    data: fileBuffer,
  };

  return new Promise((resolve, reject) => {
    printer.execute("Print-Job", msg, (err, res) => {
      if (err) return reject(err);

      const status = res["status-code"];
      if (
        status !== "successful-ok" &&
        status !== "successful-ok-ignored-or-substituted-attributes"
      ) {
        return reject(new Error(`IPP error: ${status}`));
      }

      const ippJobId = res["job-attributes-tag"]?.["job-id"];
      console.log(`🖨️  IPP job submitted, printer job-id: ${ippJobId}`);
      resolve(ippJobId);
    });
  });
}

/**
 * Poll a single IPP job until it reaches a terminal state.
 * Returns "completed" | "failed" | "aborted".
 */
export async function pollPrinterJob(ippJobId) {
  if (MOCK_MODE) {
    // Simulate 3–6 seconds of printing
    const delay = 3000 + Math.random() * 3000;
    await new Promise((r) => setTimeout(r, delay));
    return "completed";
  }

  const printer  = ipp.Printer(PRINTER_URI);
  const TERMINAL = new Set(["completed", "aborted", "canceled"]);
  const sleep    = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(3000); // poll every 3 seconds

    const res = await new Promise((resolve, reject) => {
      printer.execute(
        "Get-Job-Attributes",
        {
          "operation-attributes-tag": {
            "requesting-user-name": "printflow",
            "job-id":               ippJobId,
            "requested-attributes": ["job-state", "job-state-reasons"],
          },
        },
        (err, r) => (err ? reject(err) : resolve(r))
      );
    });

    const state = res["job-attributes-tag"]?.["job-state"];
    console.log(`  ↳ IPP job ${ippJobId} state: ${state}`);

    if (TERMINAL.has(state)) {
      return state === "completed" ? "completed" : "failed";
    }
  }

  // Timed out after ~3 minutes
  return "failed";
}