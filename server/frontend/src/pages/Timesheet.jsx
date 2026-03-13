import React from "react";
import { List } from "@refinedev/antd";
import { Table, DatePicker, Button, Select, Space } from "antd";
import { authFetch } from "../dataProvider.js";
import dayjs from "dayjs";
import "dayjs/locale/ru";
import "dayjs/locale/uz-latn";
import { useTranslation } from "react-i18next";

import { DownloadOutlined } from "@ant-design/icons";
import XLSX from "xlsx-js-style";

export default function Timesheet() {
  const { t, i18n } = useTranslation();
  dayjs.locale(i18n.language === "uz" ? "uz-latn" : i18n.language);
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;

  const [date, setDate] = React.useState(dayjs());
  const [data, setData] = React.useState([]);
  const [clientsList, setClientsList] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [categoryFilter, setCategoryFilter] = React.useState(null);

  const [combinedData, setCombinedData] = React.useState([]);

  const fetchData = React.useCallback(async () => {
    if (!date) return;
    setLoading(true);
    try {
      // Use YYYY-MM for month picker
      const monthStr = date.format("YYYY-MM");
      const [timesheetRes, clientsRes] = await Promise.all([
        authFetch(`${API_URL}/clients/reports/timesheet?month=${monthStr}`),
        authFetch(`${API_URL}/clients`),
      ]);
      const json = timesheetRes.ok ? await timesheetRes.json() : [];
      const clientsJson = clientsRes.ok ? await clientsRes.json() : [];

      setData(Array.isArray(json) ? json : []);
      setClientsList(Array.isArray(clientsJson) ? clientsJson : []);

      // Merge logic to ensure all clients are shown
      const activityData = Array.isArray(json) ? json : [];
      const allClients = Array.isArray(clientsJson) ? clientsJson : [];

      const clientIdsWithActivity = new Set(
        activityData.map((d) => d.clientId),
      );
      const missingClients = allClients.filter(
        (c) => !clientIdsWithActivity.has(c.id),
      );

      const missingRows = missingClients.map((c) => ({
        clientId: c.id,
        name: c.id,
        date: "", // No specific date
        startTime: null,
        endTime: null,
        activeMs: 0,
        presenceMs: 0,
      }));

      setCombinedData([...activityData, ...missingRows]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [API_URL, date]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const categories = React.useMemo(() => {
    const set = new Set();
    (clientsList || []).forEach((c) => {
      const v = String(c?.category || "").trim();
      if (v) set.add(v);
    });
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
  }, [clientsList]);

  const allowedClientIds = React.useMemo(() => {
    if (!categoryFilter) return null;
    const set = new Set();
    (clientsList || []).forEach((c) => {
      if (String(c?.category || "") === String(categoryFilter)) set.add(c.id);
    });
    return set;
  }, [clientsList, categoryFilter]);

  const filteredClientsList = React.useMemo(() => {
    if (!allowedClientIds) return clientsList;
    return (clientsList || []).filter((c) => allowedClientIds.has(c.id));
  }, [clientsList, allowedClientIds]);

  const filteredCombinedData = React.useMemo(() => {
    if (!allowedClientIds) return combinedData;
    return (combinedData || []).filter((r) => allowedClientIds.has(r.clientId));
  }, [combinedData, allowedClientIds]);

  const formatTime = (isoString) => {
    if (!isoString) return "-";
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "-";
    return dayjs(d).format("HH:mm");
  };

  const formatDuration = (ms) => {
    if (!ms) return "00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0",
    )}`;
  };

  const downloadXlsx = () => {
    const exportClientsList = allowedClientIds
      ? filteredClientsList
      : clientsList;
    if (!exportClientsList || exportClientsList.length === 0) return;

    // Group by Client (use data = activity rows from API)
    const clientsMap = {};
    const rowsForExport = allowedClientIds
      ? (data || []).filter((r) => allowedClientIds.has(r.clientId))
      : data || [];
    rowsForExport.forEach((item) => {
      if (!item.date) return;
      if (!clientsMap[item.clientId]) {
        clientsMap[item.clientId] = {
          clientId: item.clientId,
          days: {},
          activeTotal: 0,
          presenceTotal: 0,
          daysWorked: 0,
        };
      }
      const day = parseInt(item.date.split("-")[2], 10);
      if (isNaN(day)) return;
      clientsMap[item.clientId].days[day] = item;
      clientsMap[item.clientId].activeTotal += item.activeMs;
      clientsMap[item.clientId].presenceTotal += item.presenceMs;
      clientsMap[item.clientId].daysWorked += 1;
    });

    // Merge with full clients list to include users without activity
    const detailsById = {};
    exportClientsList.forEach((c) => {
      detailsById[c.id] = {
        name: c.id,
        department: c.department || "",
        position: c.position || "",
      };
    });
    const clients = Object.values(clientsMap).map((c) => ({
      ...c,
      ...detailsById[c.clientId],
    }));
    // Add missing clients with empty stats
    exportClientsList.forEach((c) => {
      if (!clientsMap[c.id]) {
        clients.push({
          clientId: c.id,
          days: {},
          activeTotal: 0,
          presenceTotal: 0,
          daysWorked: 0,
          name: c.id,
        });
      }
    });

    // --- STYLES ---
    const borderStyle = {
      top: { style: "thin", color: { rgb: "000000" } },
      bottom: { style: "thin", color: { rgb: "000000" } },
      left: { style: "thin", color: { rgb: "000000" } },
      right: { style: "thin", color: { rgb: "000000" } },
    };

    const headerStyle = {
      font: { bold: true, sz: 10 },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: borderStyle,
      fill: { fgColor: { rgb: "FFFFFF" } },
    };

    const cellStyle = {
      font: { sz: 10 },
      alignment: { horizontal: "center", vertical: "center" },
      border: borderStyle,
    };

    const nameStyle = {
      font: { sz: 10 },
      alignment: { horizontal: "left", vertical: "center" },
      border: borderStyle,
    };

    const titleStyle = {
      font: { bold: true, sz: 14 },
    };

    const blueTextStyle = {
      font: { sz: 10, color: { rgb: "5B9BD5" } },
      alignment: { horizontal: "center", vertical: "center" },
      border: borderStyle,
    };
    const redTextStyle = {
      font: { sz: 10, color: { rgb: "FF0000" } },
      alignment: { horizontal: "center", vertical: "center" },
      border: borderStyle,
    };
    const blueFillStyle = {
      font: { sz: 10 },
      alignment: { horizontal: "center", vertical: "center" },
      border: borderStyle,
      fill: { fgColor: { rgb: "5B9BD5" } },
    };
    const redFillStyle = {
      font: { sz: 10 },
      alignment: { horizontal: "center", vertical: "center" },
      border: borderStyle,
      fill: { fgColor: { rgb: "FF0000" } },
    };
    const legendLabelStyle = {
      font: { sz: 10, bold: true },
      alignment: { horizontal: "right", vertical: "center" },
    };

    // --- BUILD DATA ---
    const sheetData = [];

    // Row 1: Title (Merged)
    const rowTitle = Array(50).fill(""); // Pre-fill for safer indexing
    rowTitle[0] = t("timesheet.title");
    sheetData.push(rowTitle.map((v) => ({ v, s: titleStyle })));

    sheetData.push([]); // Empty row

    // Row 3: Period
    const rowPeriod = Array(50).fill("");
    rowPeriod[0] = t("timesheet.period", {
      start: date.startOf("month").format("DD.MM.YYYY"),
      end: date.endOf("month").format("DD.MM.YYYY"),
    });
    sheetData.push(rowPeriod.map((v) => ({ v, s: { font: { sz: 10 } } })));

    // Row 4: Users count
    const rowCount = Array(50).fill("");
    rowCount[0] = t("timesheet.totalUsers", {
      count: exportClientsList.length,
    });
    sheetData.push(rowCount.map((v) => ({ v, s: { font: { sz: 10 } } })));

    sheetData.push([]); // Empty row

    // Row 6: Main Headers
    const daysInMonth = date.daysInMonth();

    // Static headers
    const headers = [
      "", // A
      t("timesheet.user"), // B
      t("timesheet.totalActive"), // C
      t("timesheet.totalPresence"), // D
      t("timesheet.daysWorked"), // E
      t("timesheet.sheetFor", { date: date.format("MMMM YYYY") }), // F - merged
    ];

    const row6 = headers.map((h) => ({ v: h, s: headerStyle }));
    // Fill remaining header cells for merge area
    for (let i = 0; i < daysInMonth; i++) {
      if (i > 0) row6.push({ v: "", s: headerStyle });
    }
    sheetData.push(row6);

    // Row 7: Day Headers
    const row7 = [
      { v: "", s: headerStyle },
      { v: "", s: headerStyle },
      { v: "", s: headerStyle },
      { v: "", s: headerStyle },
      { v: "", s: headerStyle },
    ];

    for (let i = 1; i <= daysInMonth; i++) {
      const dayDate = date.date(i);
      const dayLabel = `${i} ${dayDate.format("dd")}`;
      row7.push({
        v: dayLabel,
        s: { ...headerStyle, fill: { fgColor: { rgb: "F2F2F2" } } },
      });
    }
    sheetData.push(row7);

    // Data Rows
    clients.forEach((client) => {
      const r1 = [
        { v: "", s: cellStyle }, // A
        { v: client.clientId, s: nameStyle }, // B Name
        { v: formatDuration(client.activeTotal), s: cellStyle }, // C Active Total
        { v: formatDuration(client.presenceTotal), s: cellStyle }, // D Presence Total
        { v: client.daysWorked, s: cellStyle }, // E Days
      ];

      const r2 = [
        { v: "", s: cellStyle },
        { v: "", s: cellStyle },
        { v: "", s: cellStyle },
        { v: "", s: cellStyle },
        { v: "", s: cellStyle },
      ];

      for (let i = 1; i <= daysInMonth; i++) {
        const dayData = client.days[i];
        if (dayData) {
          const startStr = formatTime(dayData.startTime);
          const endStr = formatTime(dayData.endTime);
          const activeStr = formatDuration(dayData.activeMs);
          const presenceStr = formatDuration(dayData.presenceMs);

          r1.push({ v: `${startStr} - ${endStr}`, s: cellStyle });
          r2.push({ v: `${activeStr} ${presenceStr}`, s: cellStyle });
        } else {
          r1.push({ v: "", s: cellStyle });
          r2.push({ v: "", s: cellStyle });
        }
      }
      sheetData.push(r1);
      sheetData.push(r2);
    });

    // --- LEGEND ---
    sheetData.push([]);
    sheetData.push([
      { v: t("timesheet.legendTitle"), s: { font: { bold: true, sz: 12 } } },
    ]);

    // Row: Start/End
    sheetData.push([
      { v: "", s: {} },
      { v: t("timesheet.legendStart"), s: legendLabelStyle },
      { v: "09:25", s: blueTextStyle },
      { v: "-", s: cellStyle },
      { v: "16:30", s: redTextStyle },
      { v: t("timesheet.legendEnd"), s: { font: { sz: 10 } } },
    ]);

    // Row: Active/Presence
    sheetData.push([
      { v: "", s: {} },
      { v: t("timesheet.legendActive"), s: legendLabelStyle },
      { v: "06:35", s: redTextStyle },
      { v: "08:32", s: cellStyle },
      { v: t("timesheet.legendPresence"), s: { font: { sz: 10 } } },
    ]);

    sheetData.push([]);

    // Compliance
    sheetData.push([
      { v: "", s: {} },
      { v: t("timesheet.legendCompliance"), s: legendLabelStyle },
      { v: "", s: blueFillStyle },
    ]);

    sheetData.push([]);

    // Violation
    sheetData.push([
      { v: "", s: {} },
      { v: t("timesheet.legendViolation"), s: legendLabelStyle },
      { v: "", s: redFillStyle },
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);

    // --- MERGES ---
    const merges = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 20 } }, // Title
      { s: { r: 2, c: 0 }, e: { r: 2, c: 20 } }, // Period
      { s: { r: 3, c: 0 }, e: { r: 3, c: 20 } }, // Count

      // Header merges (Row 6)
      { s: { r: 5, c: 1 }, e: { r: 6, c: 1 } }, // Пользователь (B6:B7)
      { s: { r: 5, c: 2 }, e: { r: 6, c: 2 } }, // Общее время актив (C6:C7)
      { s: { r: 5, c: 3 }, e: { r: 6, c: 3 } }, // Общее время присут (D6:D7)
      { s: { r: 5, c: 4 }, e: { r: 6, c: 4 } }, // Отработано (E6:E7)

      // "Табель рабочего времени за..." (F6 across all days)
      { s: { r: 5, c: 5 }, e: { r: 5, c: 5 + daysInMonth - 1 } },
    ];

    // Client rows vertical merges
    // Data starts at Row index 7 (sheetData[7])
    // Each client is 2 rows.
    for (let i = 0; i < clients.length; i++) {
      const r = 7 + i * 2;
      // Merge Name, Totals
      merges.push({ s: { r: r, c: 1 }, e: { r: r + 1, c: 1 } }); // Name
      merges.push({ s: { r: r, c: 2 }, e: { r: r + 1, c: 2 } }); // Active
      merges.push({ s: { r: r, c: 3 }, e: { r: r + 1, c: 3 } }); // Presence
      merges.push({ s: { r: r, c: 4 }, e: { r: r + 1, c: 4 } }); // Days
    }

    worksheet["!merges"] = merges;

    // Column Widths
    const wscols = [
      { wch: 2 }, // A (empty)
      { wch: 30 }, // B Name
      { wch: 15 }, // C Active Total
      { wch: 15 }, // D Presence Total
      { wch: 10 }, // E Days
    ];
    // Add widths for day columns
    for (let i = 0; i < daysInMonth; i++) {
      wscols.push({ wch: 12 }); // Day
    }
    worksheet["!cols"] = wscols;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, t("nav.timesheet"));
    XLSX.writeFile(workbook, `timesheet_styled_${date.format("YYYY-MM")}.xlsx`);
  };

  const columns = [
    {
      title: t("csv.date"),
      dataIndex: "date",
      key: "date",
      render: (val) => (val ? dayjs(val).format("DD.MM.YYYY") : "-"),
    },
    {
      title: t("timesheet.user"),
      dataIndex: "clientId",
      key: "clientId",
      render: (clientId) => clientId,
    },
    {
      title: t("common.workStart"),
      dataIndex: "startTime",
      key: "startTime",
      render: (val) => formatTime(val),
    },
    {
      title: t("common.workEnd"),
      dataIndex: "endTime",
      key: "endTime",
      render: (val) => formatTime(val),
    },
    {
      title: t("activity.activeTime"),
      dataIndex: "activeMs",
      key: "activeMs",
      render: (val) => formatDuration(val),
    },
    {
      title: t("common.presence"),
      dataIndex: "presenceMs",
      key: "presenceMs",
      render: (val) => formatDuration(val),
    },
  ];

  return (
    <List title={t("timesheet.title")}>
      <div style={{ marginBottom: 16 }}>
        <Select
          allowClear
          style={{ minWidth: 240, marginRight: 8 }}
          placeholder={t("common.category")}
          value={categoryFilter}
          options={categories.map((c) => ({ label: c, value: c }))}
          onChange={(v) => setCategoryFilter(v || null)}
        />
        <DatePicker
          value={date}
          onChange={(val) => setDate(val)}
          allowClear={false}
          format="MM.YYYY"
          picker="month"
        />
        <Button onClick={fetchData} style={{ marginLeft: 8 }}>
          {t("common.refresh")}
        </Button>
        <Button
          icon={<DownloadOutlined />}
          onClick={downloadXlsx}
          disabled={!filteredCombinedData || filteredCombinedData.length === 0}
          style={{ marginLeft: 8 }}
        >
          {t("common.download")} Excel
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={filteredCombinedData}
        rowKey={(record) => `${record.clientId}_${record.date || "empty"}`}
        loading={loading}
        pagination={false}
      />
    </List>
  );
}
