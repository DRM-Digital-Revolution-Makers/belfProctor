const fs = require("fs");
const path = require("path");

const minimumLines = 70;
const summaryPath = path.join(process.cwd(), "coverage", "coverage-summary.json");

if (!fs.existsSync(summaryPath)) {
  console.error(`Coverage summary is missing: ${summaryPath}`);
  process.exit(2);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const lineCoverage = Number(summary?.total?.lines?.pct);
if (!Number.isFinite(lineCoverage) || lineCoverage < minimumLines) {
  console.error(
    `Overall line coverage ${lineCoverage}% is below the ${minimumLines}% release gate.`,
  );
  process.exit(1);
}

console.log(`Overall line coverage gate passed: ${lineCoverage}% >= ${minimumLines}%.`);
