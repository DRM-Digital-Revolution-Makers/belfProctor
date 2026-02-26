import * as XLSX from "xlsx";
import path from "path";

const filePath = path.join("c:\\Users\\scoobych\\Desktop\\belfProctor\\Табель рабочего времени.xlsx");

try {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // Get range
  const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:Z100");
  
  console.log("Sheet Name:", sheetName);
  console.log("Dimensions:", worksheet["!ref"]);
  
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
  
  console.log("Structure (first 10 rows):");
  console.log(JSON.stringify(data.slice(0, 10), null, 2));
} catch (error) {
  console.error("Error reading file:", error);
}
