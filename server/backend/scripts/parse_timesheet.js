const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const filePath =
  "c:\\Users\\scoobych\\Desktop\\belfProctor\\Табель рабочего времени.xlsx";
const outputPath = path.join(__dirname, "../src/data/legacyTimesheet.ts");

try {
  if (!fs.existsSync(filePath)) {
    console.error("File not found:", filePath);
    process.exit(1);
  }

  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Get data as array of arrays
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

  const parsedData = {
    metadata: {
      period: data[2] ? data[2][0] : "",
      userCount: data[3] ? data[3][0] : "",
    },
    days: [],
    employees: [],
  };

  // Row 6 contains day headers (0-based index)
  const dayHeaderRowIndex = 6;
  const dayHeaderRow = data[dayHeaderRowIndex];

  // Identify day columns
  // Columns start at index 7, step 3
  const dayColumns = [];
  for (let j = 7; j < dayHeaderRow.length; j += 3) {
    if (dayHeaderRow[j]) {
      dayColumns.push({
        index: j,
        label: dayHeaderRow[j],
      });
    }
  }

  parsedData.days = dayColumns.map((d) => d.label);

  // Parse employees starting from Row 7
  for (let i = 7; i < data.length; i += 2) {
    const mainRow = data[i];
    const statsRow = data[i + 1]; // Next row contains active/presence durations

    if (!mainRow || !mainRow[1]) continue; // No name, skip

    const employee = {
      name: mainRow[1],
      department: mainRow[2],
      totalActive: mainRow[4],
      totalPresence: mainRow[5],
      daysWorked: mainRow[6],
      dailyRecords: [],
    };

    dayColumns.forEach((dayCol) => {
      const colIdx = dayCol.index;

      const start = mainRow[colIdx];
      const end = mainRow[colIdx + 2];

      // Stats row might be undefined if we are at the very end
      const active = statsRow ? statsRow[colIdx] : "";
      const presence = statsRow ? statsRow[colIdx + 2] : "";

      employee.dailyRecords.push({
        day: dayCol.label,
        start: start || null,
        end: end || null,
        active: active || null,
        presence: presence || null,
      });
    });

    parsedData.employees.push(employee);
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const fileContent = `export const legacyTimesheet = ${JSON.stringify(parsedData, null, 2)};`;

  fs.writeFileSync(outputPath, fileContent, "utf-8");
  console.log(`Successfully converted Excel to TypeScript at: ${outputPath}`);
  console.log(`Parsed ${parsedData.employees.length} employees.`);
} catch (error) {
  console.error("Error processing file:", error);
}
