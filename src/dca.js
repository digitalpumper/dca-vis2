// src/dca.js
export function calculateRate(Qi, b, D, t) {
    if (b === 0) return Qi * Math.exp(-D * t);
    return Qi / Math.pow(1 + b * D * t, 1 / b);
  }
  
  export function detectDateColumn(columns) {
    const candidates = columns.filter(h => {
      const lower = h.toLowerCase();
      return (
        (lower.includes("prod") && lower.includes("date")) ||
        lower.includes("proddt") ||
        lower.includes("proddttm") ||
        lower === "date" ||
        lower === "datetime"
      );
    });
    return candidates.length > 0 ? candidates[0] : "Production_Date";
  }
  
  export function detectColumns(columns) {
    let phases = {};
    columns.forEach(header => {
      const lower = header.toLowerCase();
      if (lower.includes("bopd") || (lower.includes("oil") && !phases.oil)) {
        phases.oil = header;
      }
      if (lower.includes("bwpd") || (lower.includes("water") && !phases.water)) {
        phases.water = header;
      }
      if (lower.includes("mcfd") || (lower.includes("gas") && !phases.gas)) {
        phases.gas = header;
      }
      if ((lower.includes("pip") || lower.includes("pressure") || lower.includes("psi")) && !phases.pressure) {
        phases.pressure = header;
      }
    });
    return phases;
  }
  