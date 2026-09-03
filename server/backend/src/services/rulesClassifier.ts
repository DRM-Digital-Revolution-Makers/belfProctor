export type RulesClassification = {
  category: string;
  productivityLevel: "high" | "medium" | "low" | "unknown";
  confidence: "high" | "medium" | "low" | "unknown";
  ruleId: string;
};

const PROCESS_RULES: Record<string, RulesClassification> = {
  acad: { category: "CAD_DESIGN", productivityLevel: "high", confidence: "high", ruleId: "process.acad" },
  acadlt: { category: "CAD_DESIGN", productivityLevel: "high", confidence: "high", ruleId: "process.acadlt" },
  revit: { category: "BIM_MODELING", productivityLevel: "high", confidence: "high", ruleId: "process.revit" },
  archicad: { category: "BIM_MODELING", productivityLevel: "high", confidence: "high", ruleId: "process.archicad" },
  excel: { category: "OFFICE_DOCUMENT", productivityLevel: "medium", confidence: "medium", ruleId: "process.excel" },
  winword: { category: "OFFICE_DOCUMENT", productivityLevel: "medium", confidence: "medium", ruleId: "process.winword" },
  powerpnt: { category: "OFFICE_DOCUMENT", productivityLevel: "medium", confidence: "medium", ruleId: "process.powerpnt" },
  telegram: { category: "MESSENGER", productivityLevel: "low", confidence: "medium", ruleId: "process.telegram" },
};

const WORK_DOMAINS = [
  "autodesk.com",
  "docs.autodesk.com",
  "help.autodesk.com",
  "norma.uz",
  "lex.uz",
];

const DISTRACTION_DOMAINS = [
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "tiktok.com",
  "facebook.com",
];

export function classifyActivity(input: {
  processName?: string | null;
  windowTitle?: string | null;
  filePath?: string | null;
  projectName?: string | null;
}): RulesClassification {
  const processName = String(input.processName || "")
    .replace(/\.exe$/i, "")
    .toLowerCase();
  const title = String(input.windowTitle || "").toLowerCase();
  const path = String(input.filePath || "").toLowerCase();

  if (input.projectName) {
    return {
      category: "PROJECT_WORK",
      productivityLevel: "high",
      confidence: "high",
      ruleId: "path.project_mapped",
    };
  }

  for (const domain of DISTRACTION_DOMAINS) {
    if (title.includes(domain)) {
      return {
        category: "ENTERTAINMENT",
        productivityLevel: "low",
        confidence: "high",
        ruleId: `domain.${domain}`,
      };
    }
  }

  for (const domain of WORK_DOMAINS) {
    if (title.includes(domain)) {
      return {
        category: "TECHNICAL_REFERENCE",
        productivityLevel: "high",
        confidence: "high",
        ruleId: `domain.${domain}`,
      };
    }
  }

  if (/\.(dwg|dxf|dwt|rvt|pln|ifc|pdf|xlsx|xls|docx|doc|pptx)$/i.test(path)) {
    return {
      category: "WORK_FILE",
      productivityLevel: "high",
      confidence: "medium",
      ruleId: "path.work_extension",
    };
  }

  return (
    PROCESS_RULES[processName] || {
      category: "unknown",
      productivityLevel: "unknown",
      confidence: "unknown",
      ruleId: "default.unknown",
    }
  );
}

