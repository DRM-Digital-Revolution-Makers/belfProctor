import { reportJsonToCsv } from "../services/reportStore";

/**
 * reportJsonToCsv must produce a sensible CSV for each report shape the agent
 * emits (security / directory-listing / status) and never throw on bad input.
 */

function parseCsv(csv: string): string[][] {
  return csv.split("\r\n").map((line) => {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        cells.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  });
}

describe("reportJsonToCsv", () => {
  it("GIVEN a security report with Events WHEN converting THEN one row per event", () => {
    const json = JSON.stringify({
      ClientId: "C1",
      Events: [
        { EventType: "USBConnected", ProcessName: "explorer", DeviceId: "USB1" },
        { EventType: "ProcessStarted", ProcessName: "cmd", DeviceId: null },
      ],
    });
    const rows = parseCsv(reportJsonToCsv(json));
    expect(rows[0]).toEqual(["EventType", "ProcessName", "DeviceId"]);
    expect(rows).toHaveLength(3); // header + 2 events
    expect(rows[1][0]).toBe("USBConnected");
  });

  it("GIVEN a directory listing WHEN converting THEN one row per file/dir with root", () => {
    const json = JSON.stringify({
      Type: "DirectoryListing",
      Entries: [
        {
          root: "C:/work",
          directories: [{ name: "proj", fullPath: "C:/work/proj" }],
          files: [{ name: "a.txt", fullPath: "C:/work/a.txt", size: 12 }],
        },
      ],
    });
    const rows = parseCsv(reportJsonToCsv(json));
    const header = rows[0];
    expect(header).toContain("root");
    expect(header).toContain("kind");
    // 1 dir + 1 file
    expect(rows).toHaveLength(3);
    const kinds = rows.slice(1).map((r) => r[header.indexOf("kind")]);
    expect(kinds.sort()).toEqual(["directory", "file"]);
  });

  it("GIVEN a status report (no array) WHEN converting THEN a flattened key/value table", () => {
    const json = JSON.stringify({
      ClientId: "C1",
      Status: "Active",
      Configuration: { ScreenshotInterval: 300000, MonitorUSB: true },
    });
    const rows = parseCsv(reportJsonToCsv(json));
    expect(rows[0]).toEqual(["key", "value"]);
    const flat = Object.fromEntries(rows.slice(1).map((r) => [r[0], r[1]]));
    expect(flat["ClientId"]).toBe("C1");
    expect(flat["Configuration.ScreenshotInterval"]).toBe("300000");
    expect(flat["Configuration.MonitorUSB"]).toBe("true");
  });

  it("GIVEN values needing escaping WHEN converting THEN quotes/commas are escaped", () => {
    const json = JSON.stringify({ Events: [{ Description: 'a,b "c"' }] });
    const csv = reportJsonToCsv(json);
    expect(csv).toContain('"a,b ""c"""');
  });

  it("GIVEN non-JSON content WHEN converting THEN it degrades to a single cell (no throw)", () => {
    const csv = reportJsonToCsv("not json at all");
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(["content"]);
    expect(rows[1][0]).toBe("not json at all");
  });
});
