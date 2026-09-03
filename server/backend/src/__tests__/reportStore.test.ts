import fs from "fs/promises";
import os from "os";
import path from "path";

const reportFindMany = jest.fn();
const reportCount = jest.fn();
const reportCreate = jest.fn();
const clientFindMany = jest.fn();

jest.mock("../prisma", () => ({
  prisma: {
    report: {
      findMany: (...args: unknown[]) => reportFindMany(...args),
      count: (...args: unknown[]) => reportCount(...args),
      create: (...args: unknown[]) => reportCreate(...args),
    },
    client: { findMany: (...args: unknown[]) => clientFindMany(...args) },
  },
}));

import {
  indexExistingReports,
  listReports,
  reportJsonToCsv,
  reportsRootDir,
} from "../services/reportStore";

afterEach(() => jest.clearAllMocks());

describe("report persistence", () => {
  it("returns zero when the reports directory does not exist", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "belf-reports-missing-"));
    try {
      expect(reportsRootDir(root)).toBe(path.join(root, "reports"));
      await expect(indexExistingReports(root)).resolves.toBe(0);
      expect(reportFindMany).not.toHaveBeenCalled();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("indexes only new files belonging to known clients and tolerates create races", async () => {
    const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), "belf-reports-"));
    const reportsDir = path.join(uploadDir, "reports");
    const knownClientDir = path.join(reportsDir, "CLIENT01");
    await fs.mkdir(knownClientDir, { recursive: true });
    await fs.mkdir(path.join(reportsDir, "UNKNOWN"), { recursive: true });
    await fs.writeFile(path.join(knownClientDir, "known.json"), "{}");
    await fs.writeFile(
      path.join(knownClientDir, "report_2026-08-31T12-34-56.000Z.json"),
      "{}",
    );
    await fs.writeFile(path.join(knownClientDir, "race.json"), "{}");
    await fs.mkdir(path.join(knownClientDir, "not-a-file"));

    reportFindMany.mockResolvedValue([
      { path: path.join(knownClientDir, "known.json") },
    ]);
    clientFindMany.mockResolvedValue([{ id: "CLIENT01" }]);
    reportCreate
      .mockResolvedValueOnce({ id: 1 })
      .mockRejectedValueOnce(new Error("unique race"));

    try {
      await expect(indexExistingReports(uploadDir)).resolves.toBe(1);
      expect(reportCreate).toHaveBeenCalledTimes(2);
      expect(reportCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          clientId: "CLIENT01",
          filename: "report_2026-08-31T12-34-56.000Z.json",
          timestamp: new Date("2026-08-31T12:34:56.000Z"),
        }),
      });
    } finally {
      await fs.rm(uploadDir, { recursive: true, force: true });
    }
  });

  it("lists reports with filters, pagination, and ISO timestamps", async () => {
    const from = new Date("2026-08-01T00:00:00Z");
    const to = new Date("2026-09-01T00:00:00Z");
    reportFindMany.mockResolvedValue([
      {
        id: 7,
        clientId: "CLIENT01",
        filename: "status.json",
        timestamp: new Date("2026-08-31T12:00:00Z"),
      },
    ]);
    reportCount.mockResolvedValue(21);

    await expect(
      listReports({ clientId: "CLIENT01", from, to, page: 3, pageSize: 10 }),
    ).resolves.toEqual({
      data: [
        {
          id: 7,
          clientId: "CLIENT01",
          filename: "status.json",
          timestamp: "2026-08-31T12:00:00.000Z",
        },
      ],
      total: 21,
    });
    const expectedWhere = {
      clientId: "CLIENT01",
      timestamp: { gte: from, lte: to },
    };
    expect(reportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere, skip: 20, take: 10 }),
    );
    expect(reportCount).toHaveBeenCalledWith({ where: expectedWhere });
  });
});

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
