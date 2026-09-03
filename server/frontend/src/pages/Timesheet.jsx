import React from "react";
import {
  Table,
  DatePicker,
  Button,
  Select,
  Checkbox,
} from "antd";
import { Icon } from "@iconify/react";
import { authFetch } from "../dataProvider.js";
import { formatTashkent } from "../utils/time";
import dayjs from "dayjs";
import MonthlyScreenshotsPdf from "../components/MonthlyScreenshotsPdf";
import "dayjs/locale/ru";
import "dayjs/locale/uz-latn";
import { useTranslation } from "react-i18next";
import XLSX from "xlsx-js-style";

/* ============ Design tokens ============ */
const BP = {
  white: "#FFFFFF",
  surface: "#F7F7F7",
  innerCardBg: "#FEFEFE",
  text: "#000000",
  muted: "#707070",
  light: "#A4A4A4",
  green: "#267E26",
  red: "#DC2626",
  stroke: "rgba(164,164,164,0.5)",
  shadow: "0 0 4px 0 rgba(241,243,248,1)",
  font: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "SF Pro", "Helvetica Neue", Arial, sans-serif',
};

function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontFamily: BP.font,
        fontSize: 18,
        fontWeight: 510,
        color: BP.text,
      }}
    >
      {children}
    </div>
  );
}

function SmallLabel({ children }) {
  return (
    <div
      style={{
        fontFamily: BP.font,
        fontSize: 14,
        fontWeight: 400,
        color: BP.text,
      }}
    >
      {children}
    </div>
  );
}

function BorderedCard({ children, style, alignFlexEnd }) {
  return (
    <div
      style={{
        border: `1px solid ${BP.stroke}`,
        borderRadius: 24,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        background: "transparent",
        alignItems: alignFlexEnd ? "flex-end" : "stretch",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export default function Timesheet() {
  const { t, i18n } = useTranslation();
  dayjs.locale(i18n.language === "uz" ? "uz-latn" : i18n.language);
  const API_URL =
    import.meta.env.VITE_API_URL ||
    "/api";

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
      const monthStr = date.format("YYYY-MM");
      const [timesheetRes, clientsRes] = await Promise.all([
        authFetch(`${API_URL}/clients/reports/timesheet?month=${monthStr}`),
        authFetch(`${API_URL}/clients`),
      ]);
      const json = timesheetRes.ok ? await timesheetRes.json() : [];
      const clientsJson = clientsRes.ok ? await clientsRes.json() : [];

      setData(Array.isArray(json) ? json : []);
      setClientsList(Array.isArray(clientsJson) ? clientsJson : []);

      const activityData = Array.isArray(json) ? json : [];
      const allClients = Array.isArray(clientsJson) ? clientsJson : [];
      const clientIdsWithActivity = new Set(
        activityData.map((item) => item.clientId),
      );
      const missingClients = allClients.filter(
        (client) => !clientIdsWithActivity.has(client.id),
      );

      const missingRows = missingClients.map((client) => ({
        clientId: client.id,
        name: client.id,
        date: "",
        startTime: null,
        endTime: null,
        activeMs: 0,
        presenceMs: 0,
      }));

      setCombinedData([...activityData, ...missingRows]);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [API_URL, date]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const categories = React.useMemo(() => {
    const set = new Set();
    (clientsList || []).forEach((client) => {
      const value = String(client?.category || "").trim();
      if (value) set.add(value);
    });
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
  }, [clientsList]);

  const allowedClientIds = React.useMemo(() => {
    if (!categoryFilter) return null;
    const set = new Set();
    (clientsList || []).forEach((client) => {
      if (String(client?.category || "") === String(categoryFilter)) {
        set.add(client.id);
      }
    });
    return set;
  }, [clientsList, categoryFilter]);

  const filteredClientsList = React.useMemo(() => {
    if (!allowedClientIds) return clientsList;
    return (clientsList || []).filter((client) =>
      allowedClientIds.has(client.id),
    );
  }, [clientsList, allowedClientIds]);

  const filteredCombinedData = React.useMemo(() => {
    if (!allowedClientIds) return combinedData;
    return (combinedData || []).filter((row) =>
      allowedClientIds.has(row.clientId),
    );
  }, [combinedData, allowedClientIds]);

  const formatTime = (isoString) => {
    if (!isoString) return "-";
    // Use the shared Asia/Tashkent formatter so timesheet times match the rest
    // of the panel instead of showing the raw UTC clock from the ISO string.
    const formatted = formatTashkent(isoString, "HH:mm");
    return formatted === "—" ? "-" : formatted;
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
    if (!Array.isArray(exportClientsList) || exportClientsList.length === 0)
      return;

    const reportEnd = date.endOf("month");
    const reportDayCount = date.daysInMonth();
    const totalColumns = 7 + reportDayCount * 3;
    const rowsForExport = allowedClientIds
      ? (data || []).filter((row) => allowedClientIds.has(row.clientId))
      : data || [];

    const borderColor = "D0CECE";
    const headerFill = "F5FBFF";
    const zebraFill = "F5F5F5";
    const whiteFill = "FFFFFF";
    const greenText = "70AD47";
    const redText = "E77373";
    const startTimeThresholdMinutes = 8 * 60 + 40;
    const activeTimeThresholdMinutes = 6 * 60;
    const endTimeThresholdMinutes = 17 * 60 + 25;

    const fullBorder = {
      top: { style: "thin", color: { rgb: borderColor } },
      bottom: { style: "thin", color: { rgb: borderColor } },
      left: { style: "thin", color: { rgb: borderColor } },
      right: { style: "thin", color: { rgb: borderColor } },
    };

    const createCell = (value = "", style) => ({ v: value, s: style });
    const createBlankRow = () =>
      Array.from({ length: totalColumns }, () => createCell(""));
    const capitalizeDay = (value) =>
      value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
    const toMinutes = (value) => {
      if (!value || value === "-") return null;
      const [hours, minutes] = String(value).split(":").map(Number);
      if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
      return hours * 60 + minutes;
    };

    const baseCellStyle = (fillColor, horizontal = "center", fontColor) => {
      const style = {
        font: { sz: 10 },
        alignment: { horizontal, vertical: "center", wrapText: true },
        border: fullBorder,
        fill: { patternType: "solid", fgColor: { rgb: fillColor } },
      };
      if (fontColor) {
        style.font = { ...style.font, color: { rgb: fontColor } };
      }
      return style;
    };

    const dayCellStyle = (fillColor, edge, rowType, fontColor) => {
      const border = {};
      if (rowType === "top") {
        border.top = { style: "thin", color: { rgb: borderColor } };
      } else {
        border.bottom = { style: "thin", color: { rgb: borderColor } };
      }
      if (edge === "start") {
        border.left = { style: "thin", color: { rgb: borderColor } };
      }
      if (edge === "end") {
        border.right = { style: "thin", color: { rgb: borderColor } };
      }

      const style = {
        font: { sz: 10 },
        alignment: { horizontal: "center", vertical: "center" },
        border,
        fill: { patternType: "solid", fgColor: { rgb: fillColor } },
      };
      if (fontColor) {
        style.font = { ...style.font, color: { rgb: fontColor } };
      }
      return style;
    };

    const metaStyle = {
      font: { sz: 10 },
      alignment: { horizontal: "left", vertical: "center" },
    };
    const titleStyle = {
      font: { bold: true, sz: 16 },
      alignment: { horizontal: "left", vertical: "center" },
    };
    const headerStyle = {
      font: { sz: 10 },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: fullBorder,
      fill: { patternType: "solid", fgColor: { rgb: headerFill } },
    };
    const legendTitleStyle = {
      font: { bold: true, sz: 12 },
      alignment: { horizontal: "left", vertical: "center" },
    };
    const legendTextStyle = {
      font: { sz: 10 },
      alignment: { horizontal: "left", vertical: "center" },
    };

    const startTimeStyle = (fillColor, value) => {
      const minutes = toMinutes(value);
      const fontColor =
        minutes !== null && minutes <= startTimeThresholdMinutes
          ? greenText
          : redText;
      return dayCellStyle(fillColor, "start", "top", fontColor);
    };

    const activeTimeStyle = (fillColor, value) => {
      const minutes = toMinutes(value);
      const fontColor =
        minutes !== null && minutes > activeTimeThresholdMinutes
          ? greenText
          : redText;
      return dayCellStyle(fillColor, "start", "bottom", fontColor);
    };

    const endTimeStyle = (fillColor, value) => {
      const minutes = toMinutes(value);
      const fontColor =
        minutes !== null && minutes >= endTimeThresholdMinutes
          ? greenText
          : redText;
      return dayCellStyle(fillColor, "end", "top", fontColor);
    };

    const clientStatsById = new Map();
    rowsForExport.forEach((item) => {
      if (!item?.date || !item?.clientId) return;
      const dayValue = dayjs(item.date);
      if (!dayValue.isValid() || !dayValue.isSame(date, "month")) return;
      const dayNumber = dayValue.date();
      if (dayNumber > reportDayCount) return;

      if (!clientStatsById.has(item.clientId)) {
        clientStatsById.set(item.clientId, {
          days: {},
          activeTotal: 0,
          presenceTotal: 0,
          daysWorked: 0,
        });
      }

      const clientStats = clientStatsById.get(item.clientId);
      clientStats.days[dayNumber] = item;
      clientStats.activeTotal += Number(item.activeMs) || 0;
      clientStats.presenceTotal += Number(item.presenceMs) || 0;
      clientStats.daysWorked += 1;
    });

    const clients = exportClientsList.map((client) => {
      const stats = clientStatsById.get(client.id);
      return {
        clientId: client.id,
        department: client.department || "",
        position: client.position || "",
        activeTotal: stats?.activeTotal || 0,
        presenceTotal: stats?.presenceTotal || 0,
        daysWorked: stats?.daysWorked || 0,
        days: stats?.days || {},
      };
    });

    const usersWithDataCount = clients.filter(
      (client) => client.daysWorked > 0,
    ).length;
    const sheetData = [];

    sheetData.push(createBlankRow());
    sheetData.push(createBlankRow());

    const titleRow = createBlankRow();
    titleRow[0] = createCell(t("timesheet.title"), titleStyle);
    sheetData.push(titleRow);
    sheetData.push(createBlankRow());

    const periodRow = createBlankRow();
    periodRow[0] = createCell(
      t("timesheet.period", {
        start: date.startOf("month").format("DD.MM.YYYY"),
        end: reportEnd.format("DD.MM.YYYY"),
      }),
      metaStyle,
    );
    sheetData.push(periodRow);

    const countRow = createBlankRow();
    countRow[0] = createCell(
      t("timesheet.totalUsersWithData", { count: usersWithDataCount }),
      metaStyle,
    );
    sheetData.push(countRow);
    sheetData.push(createBlankRow());

    const mainHeaderRow = createBlankRow();
    mainHeaderRow[0] = createCell(t("timesheet.user"), headerStyle);
    mainHeaderRow[1] = createCell("", headerStyle);
    mainHeaderRow[2] = createCell(t("timesheet.department"), headerStyle);
    mainHeaderRow[3] = createCell(t("timesheet.position"), headerStyle);
    mainHeaderRow[4] = createCell(t("timesheet.totalActive"), headerStyle);
    mainHeaderRow[5] = createCell(t("timesheet.totalPresence"), headerStyle);
    mainHeaderRow[6] = createCell(t("timesheet.daysWorked"), headerStyle);
    mainHeaderRow[7] = createCell(
      t("timesheet.sheetFor", { date: date.format("MMMM YYYY") }),
      headerStyle,
    );
    for (let dayNumber = 1; dayNumber <= reportDayCount; dayNumber += 1) {
      const startColumn = 7 + (dayNumber - 1) * 3;
      if (startColumn > 7) {
        mainHeaderRow[startColumn] = createCell("", headerStyle);
      }
      mainHeaderRow[startColumn + 1] = createCell("", headerStyle);
      mainHeaderRow[startColumn + 2] = createCell("", headerStyle);
    }
    sheetData.push(mainHeaderRow);

    const dayHeaderRow = createBlankRow();
    for (let dayNumber = 1; dayNumber <= reportDayCount; dayNumber += 1) {
      const startColumn = 7 + (dayNumber - 1) * 3;
      const dayValue = date.date(dayNumber);
      const isWeekend = dayValue.day() === 0 || dayValue.day() === 6;
      const dayHeaderCellStyle = isWeekend
        ? {
            ...headerStyle,
            font: { ...headerStyle.font, color: { rgb: redText } },
          }
        : headerStyle;
      dayHeaderRow[startColumn] = createCell(
        `${dayNumber} ${capitalizeDay(dayValue.format("dd"))}`,
        dayHeaderCellStyle,
      );
      dayHeaderRow[startColumn + 1] = createCell("", dayHeaderCellStyle);
      dayHeaderRow[startColumn + 2] = createCell("", dayHeaderCellStyle);
    }
    sheetData.push(dayHeaderRow);

    clients.forEach((client, clientIndex) => {
      const fillColor = clientIndex % 2 === 0 ? whiteFill : zebraFill;
      const mainRow = createBlankRow();
      const statsRow = createBlankRow();

      mainRow[0] = createCell("", baseCellStyle(fillColor));
      mainRow[1] = createCell(
        client.clientId,
        baseCellStyle(fillColor, "left"),
      );
      mainRow[2] = createCell(
        client.department,
        baseCellStyle(fillColor, "left"),
      );
      mainRow[3] = createCell(
        client.position,
        baseCellStyle(fillColor, "left"),
      );
      mainRow[4] = createCell(
        formatDuration(client.activeTotal),
        baseCellStyle(fillColor),
      );
      mainRow[5] = createCell(
        formatDuration(client.presenceTotal),
        baseCellStyle(fillColor),
      );
      mainRow[6] = createCell(client.daysWorked, baseCellStyle(fillColor));

      statsRow[0] = createCell("", baseCellStyle(fillColor));
      statsRow[1] = createCell("", baseCellStyle(fillColor, "left"));
      statsRow[2] = createCell("", baseCellStyle(fillColor, "left"));
      statsRow[3] = createCell("", baseCellStyle(fillColor, "left"));
      statsRow[4] = createCell("", baseCellStyle(fillColor));
      statsRow[5] = createCell("", baseCellStyle(fillColor));
      statsRow[6] = createCell("", baseCellStyle(fillColor));

      for (let dayNumber = 1; dayNumber <= reportDayCount; dayNumber += 1) {
        const dayData = client.days[dayNumber];
        const startColumn = 7 + (dayNumber - 1) * 3;
        const startValue = dayData ? formatTime(dayData.startTime) : "";
        const endValue = dayData ? formatTime(dayData.endTime) : "";
        const activeValue = dayData ? formatDuration(dayData.activeMs) : "";
        const presenceValue = dayData ? formatDuration(dayData.presenceMs) : "";

        mainRow[startColumn] = createCell(
          startValue === "-" ? "" : startValue,
          dayData
            ? startTimeStyle(fillColor, startValue)
            : dayCellStyle(fillColor, "start", "top"),
        );
        mainRow[startColumn + 1] = createCell(
          dayData ? "-" : "",
          dayCellStyle(fillColor, "middle", "top"),
        );
        mainRow[startColumn + 2] = createCell(
          endValue === "-" ? "" : endValue,
          dayData
            ? endTimeStyle(fillColor, endValue)
            : dayCellStyle(fillColor, "end", "top"),
        );

        statsRow[startColumn] = createCell(
          activeValue,
          dayData
            ? activeTimeStyle(fillColor, activeValue)
            : dayCellStyle(fillColor, "start", "bottom"),
        );
        statsRow[startColumn + 1] = createCell(
          "",
          dayCellStyle(fillColor, "middle", "bottom"),
        );
        statsRow[startColumn + 2] = createCell(
          presenceValue,
          dayCellStyle(fillColor, "end", "bottom"),
        );
      }

      sheetData.push(mainRow);
      sheetData.push(statsRow);
    });

    sheetData.push(createBlankRow());

    const legendTitleRow = createBlankRow();
    legendTitleRow[0] = createCell(
      t("timesheet.legendTitle"),
      legendTitleStyle,
    );
    sheetData.push(legendTitleRow);

    const legendStartRow = createBlankRow();
    legendStartRow[0] = createCell(t("timesheet.legendStart"), legendTextStyle);
    legendStartRow[7] = createCell(
      "09:25",
      dayCellStyle(whiteFill, "start", "top", redText),
    );
    legendStartRow[8] = createCell(
      "-",
      dayCellStyle(whiteFill, "middle", "top"),
    );
    legendStartRow[9] = createCell(
      "16:30",
      dayCellStyle(whiteFill, "end", "top", redText),
    );
    legendStartRow[10] = createCell(t("timesheet.legendEnd"), legendTextStyle);
    sheetData.push(legendStartRow);

    const legendActiveRow = createBlankRow();
    legendActiveRow[0] = createCell(
      t("timesheet.legendActive"),
      legendTextStyle,
    );
    legendActiveRow[7] = createCell(
      "06:35",
      dayCellStyle(whiteFill, "start", "bottom", greenText),
    );
    legendActiveRow[8] = createCell(
      "",
      dayCellStyle(whiteFill, "middle", "bottom"),
    );
    legendActiveRow[9] = createCell(
      "08:32",
      dayCellStyle(whiteFill, "end", "bottom"),
    );
    legendActiveRow[10] = createCell(
      t("timesheet.legendPresence"),
      legendTextStyle,
    );
    sheetData.push(legendActiveRow);

    sheetData.push(createBlankRow());

    const legendComplianceRow = createBlankRow();
    legendComplianceRow[0] = createCell(
      t("timesheet.legendCompliance"),
      legendTextStyle,
    );
    legendComplianceRow[7] = createCell("", {
      fill: { patternType: "solid", fgColor: { rgb: greenText } },
    });
    sheetData.push(legendComplianceRow);

    sheetData.push(createBlankRow());

    const legendViolationRow = createBlankRow();
    legendViolationRow[0] = createCell(
      t("timesheet.legendViolation"),
      legendTextStyle,
    );
    legendViolationRow[7] = createCell("", {
      fill: { patternType: "solid", fgColor: { rgb: redText } },
    });
    sheetData.push(legendViolationRow);

    sheetData.push(createBlankRow());
    sheetData.push(createBlankRow());

    const note1Row = createBlankRow();
    note1Row[0] = createCell(
      t("timesheet.noteMultipleStations"),
      legendTextStyle,
    );
    sheetData.push(note1Row);

    const note2Row = createBlankRow();
    note2Row[0] = createCell(t("timesheet.noteNoDoubleCount"), legendTextStyle);
    sheetData.push(note2Row);

    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
    const lastColumn = totalColumns - 1;
    const merges = [
      { s: { r: 2, c: 0 }, e: { r: 2, c: lastColumn } },
      { s: { r: 4, c: 0 }, e: { r: 4, c: lastColumn } },
      { s: { r: 5, c: 0 }, e: { r: 5, c: lastColumn } },
      { s: { r: 7, c: 0 }, e: { r: 8, c: 1 } },
      { s: { r: 7, c: 2 }, e: { r: 8, c: 2 } },
      { s: { r: 7, c: 3 }, e: { r: 8, c: 3 } },
      { s: { r: 7, c: 4 }, e: { r: 8, c: 4 } },
      { s: { r: 7, c: 5 }, e: { r: 8, c: 5 } },
      { s: { r: 7, c: 6 }, e: { r: 8, c: 6 } },
      { s: { r: 7, c: 7 }, e: { r: 7, c: lastColumn } },
    ];

    for (let dayNumber = 1; dayNumber <= reportDayCount; dayNumber += 1) {
      const startColumn = 7 + (dayNumber - 1) * 3;
      merges.push({
        s: { r: 8, c: startColumn },
        e: { r: 8, c: startColumn + 2 },
      });
    }

    clients.forEach((_, clientIndex) => {
      const rowIndex = 9 + clientIndex * 2;
      for (let column = 0; column <= 6; column += 1) {
        merges.push({
          s: { r: rowIndex, c: column },
          e: { r: rowIndex + 1, c: column },
        });
      }
    });

    worksheet["!merges"] = merges;
    worksheet["!cols"] = [
      { wch: 5.1 },
      { wch: 47.9 },
      { wch: 13.6 },
      { hidden: true, wch: 0.1 },
      { wch: 15.1 },
      { wch: 21.6 },
      { wch: 12.2 },
      ...Array.from({ length: reportDayCount }, () => [
        { wch: 5.2 },
        { wch: 0.9 },
        { wch: 6.2 },
      ]).flat(),
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, t("nav.timesheet"));
    XLSX.writeFile(workbook, `timesheet_${date.format("YYYY-MM")}.xlsx`);
  };

  const columns = [
    {
      title: t("csv.date"),
      dataIndex: "date",
      key: "date",
      render: (value) => (value ? dayjs(value).format("DD.MM.YYYY") : "-"),
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
      render: (value) => formatTime(value),
    },
    {
      title: t("common.workEnd"),
      dataIndex: "endTime",
      key: "endTime",
      render: (value) => formatTime(value),
    },
    {
      title: t("activity.activeTime"),
      dataIndex: "activeMs",
      key: "activeMs",
      render: (value) => formatDuration(value),
    },
    {
      title: t("common.presence"),
      dataIndex: "presenceMs",
      key: "presenceMs",
      render: (value) => formatDuration(value),
    },
  ];

  // Selection in filters panel (new design)
  const [selectedClients, setSelectedClients] = React.useState([]);
  const [clientSearch, setClientSearch] = React.useState("");
  const [periodMode, setPeriodMode] = React.useState("month");
  const [rangeStart, setRangeStart] = React.useState(dayjs().startOf("month"));
  const [rangeEnd, setRangeEnd] = React.useState(dayjs().endOf("month"));
  const [fileType, setFileType] = React.useState("txt");

  const filterListClients = React.useMemo(() => {
    let list = filteredClientsList || [];
    if (clientSearch.trim()) {
      const q = clientSearch.toLowerCase();
      list = list.filter((c) => String(c.id || "").toLowerCase().includes(q));
    }
    return list;
  }, [filteredClientsList, clientSearch]);

  const downloadTxt = () => {
    const exportList = selectedClients.length
      ? filteredClientsList.filter((c) => selectedClients.includes(c.id))
      : filteredClientsList;
    const rows = [];
    rows.push(`Отчет за ${date.format("MMMM YYYY")}`);
    rows.push(`Сотрудников: ${exportList.length}`);
    rows.push("");
    rows.push("Сотрудник | Дата | Начало | Конец | Активно | Присутствие");
    rows.push("-".repeat(80));
    const allowedIds = new Set(exportList.map((c) => c.id));
    (data || [])
      .filter((row) => allowedIds.has(row.clientId))
      .forEach((row) => {
        rows.push(
          [
            row.clientId,
            row.date,
            formatTime(row.startTime),
            formatTime(row.endTime),
            formatDuration(row.activeMs),
            formatDuration(row.presenceMs),
          ].join(" | "),
        );
      });
    const blob = new Blob([rows.join("\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report_${date.format("YYYY-MM")}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownload = () => {
    if (fileType === "xlsx") downloadXlsx();
    else downloadTxt();
  };

  const [previewOpen, setPreviewOpen] = React.useState(false);
  const isDownloadDisabled =
    !filteredCombinedData || filteredCombinedData.length === 0;

  return (
    <div>
      <MonthlyScreenshotsPdf clients={clientsList} />
      {/* Outer wrapper */}
      <div
        style={{
          background: BP.surface,
          borderRadius: 50,
          boxShadow: BP.shadow,
          padding: 20,
          minHeight: "calc(100vh - 64px)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Inner white card */}
        <div
          style={{
            background: BP.innerCardBg,
            borderRadius: 30,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            flex: 1,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "20px 20px 16px",
              gap: 40,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontFamily: BP.font,
                fontSize: 24,
                fontWeight: 510,
                color: BP.text,
              }}
            >
              Скачать отчет
            </h2>
          </div>

          {/* Divider */}
          <div
            style={{
              height: 1,
              background: BP.stroke,
              opacity: 0.5,
              margin: "0 20px",
            }}
          />

          {/* База */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: 20,
            }}
          >
            {/* Форма отчёта */}
            <div
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              {/* Title "Фильтры" */}
              <div
                style={{
                  fontFamily: BP.font,
                  fontSize: 20,
                  fontWeight: 510,
                  color: BP.text,
                }}
              >
                {t("report.filters")}
              </div>

              {/* 2-col layout */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 20,
                  alignItems: "stretch",
                }}
              >
                {/* LEFT bordered card */}
                <BorderedCard style={{ gap: 12 }}>
                  {/* Подразделение section */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <SectionLabel>{t("report.department")}</SectionLabel>
                    <Select
                      allowClear
                      style={{ width: "100%" }}
                      placeholder={t("report.allDepartments")}
                      value={categoryFilter}
                      options={categories.map((c) => ({
                        label: c,
                        value: c,
                      }))}
                      onChange={(v) => setCategoryFilter(v || null)}
                      suffixIcon={
                        <Icon
                          icon="solar:alt-arrow-down-linear"
                          width={16}
                          height={16}
                          color={BP.text}
                        />
                      }
                    />
                  </div>

                  {/* Сотрудники section */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      padding: "0 4px",
                      flex: 1,
                    }}
                  >
                    <SectionLabel>{t("report.employees")}</SectionLabel>

                    {/* Search + select-all row */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: 8,
                      }}
                    >
                      <div
                        style={{
                          fontFamily: BP.font,
                          fontSize: 14,
                          color: BP.light,
                          minWidth: 24,
                        }}
                      >
                        No
                      </div>
                      <Checkbox
                        indeterminate={
                          selectedClients.length > 0 &&
                          selectedClients.length < filterListClients.length
                        }
                        checked={
                          filterListClients.length > 0 &&
                          selectedClients.length === filterListClients.length
                        }
                        onChange={(e) =>
                          setSelectedClients(
                            e.target.checked
                              ? filterListClients.map((c) => c.id)
                              : [],
                          )
                        }
                      />
                      <div
                        style={{
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <input
                          value={clientSearch}
                          onChange={(e) => setClientSearch(e.target.value)}
                          placeholder="Имя..."
                          style={{
                            flex: 1,
                            border: "none",
                            background: "transparent",
                            outline: "none",
                            fontFamily: BP.font,
                            fontSize: 14,
                            color: BP.text,
                          }}
                        />
                        <Icon
                          icon="solar:magnifer-bold-duotone"
                          width={18}
                          height={18}
                          color={BP.muted}
                        />
                      </div>
                    </div>

                    {/* Divider */}
                    <div
                      style={{
                        height: 1,
                        background: BP.stroke,
                        opacity: 0.5,
                      }}
                    />

                    {/* Employee list */}
                    <div
                      style={{
                        maxHeight: 200,
                        overflowY: "auto",
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      {filterListClients.length === 0 ? (
                        <div
                          style={{
                            color: BP.light,
                            textAlign: "center",
                            padding: 16,
                          }}
                        >
                          {t("common.noData")}
                        </div>
                      ) : (
                        filterListClients.map((c, i) => {
                          const checked = selectedClients.includes(c.id);
                          return (
                            <div
                              key={c.id}
                              onClick={() =>
                                setSelectedClients((prev) =>
                                  checked
                                    ? prev.filter((x) => x !== c.id)
                                    : [...prev, c.id],
                                )
                              }
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                                padding: 8,
                                cursor: "pointer",
                                borderRadius: 8,
                              }}
                            >
                              <div
                                style={{
                                  fontFamily: BP.font,
                                  fontSize: 14,
                                  color: BP.light,
                                  minWidth: 24,
                                }}
                              >
                                {i + 1}
                              </div>
                              <Checkbox
                                checked={checked}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  setSelectedClients((prev) =>
                                    e.target.checked
                                      ? Array.from(new Set([...prev, c.id]))
                                      : prev.filter((x) => x !== c.id),
                                  );
                                }}
                              />
                              <span
                                style={{
                                  fontFamily: BP.font,
                                  fontSize: 14,
                                  color: BP.text,
                                  flex: 1,
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {c.id}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </BorderedCard>

                {/* RIGHT column */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {/* Period card */}
                  <BorderedCard>
                    {/* Период row */}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <SectionLabel>{t("report.period")}</SectionLabel>
                      <Select
                        value={periodMode}
                        onChange={(v) => setPeriodMode(v)}
                        style={{ width: "100%" }}
                        options={[
                          { label: t("report.oneDay"), value: "day" },
                          { label: t("common.month"), value: "month" },
                        ]}
                        suffixIcon={
                          <Icon
                            icon="solar:alt-arrow-down-linear"
                            width={16}
                            height={16}
                            color={BP.text}
                          />
                        }
                      />
                    </div>

                    {/* Date row */}
                    {periodMode === "day" ? (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 2,
                        }}
                      >
                        <SmallLabel>{t("report.startDate")}</SmallLabel>
                        <DatePicker
                          value={rangeStart}
                          onChange={(v) => {
                            if (v) {
                              setRangeStart(v);
                              setDate(v);
                            }
                          }}
                          allowClear={false}
                          format="DD.MM.YYYY"
                          style={{ width: "100%" }}
                          suffixIcon={
                            <Icon
                              icon="solar:calendar-bold-duotone"
                              width={18}
                              height={18}
                              color={BP.text}
                            />
                          }
                        />
                      </div>
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                          }}
                        >
                          <SmallLabel>{t("report.startDate")}</SmallLabel>
                          <DatePicker
                            value={rangeStart}
                            onChange={(v) => v && setRangeStart(v)}
                            allowClear={false}
                            format="DD.MM.YYYY"
                            style={{ width: "100%" }}
                            suffixIcon={
                              <Icon
                                icon="solar:calendar-bold-duotone"
                                width={18}
                                height={18}
                                color={BP.text}
                              />
                            }
                          />
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                          }}
                        >
                          <SmallLabel>{t("report.endDate")}</SmallLabel>
                          <DatePicker
                            value={rangeEnd}
                            onChange={(v) => v && setRangeEnd(v)}
                            allowClear={false}
                            format="DD.MM.YYYY"
                            style={{ width: "100%" }}
                            suffixIcon={
                              <Icon
                                icon="solar:calendar-bold-duotone"
                                width={18}
                                height={18}
                                color={BP.text}
                              />
                            }
                          />
                        </div>
                      </div>
                    )}
                  </BorderedCard>

                  {/* Download card */}
                  <BorderedCard alignFlexEnd>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        width: "100%",
                      }}
                    >
                      <SectionLabel>{t("report.download")}</SectionLabel>

                      {/* Тип файла */}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 2,
                        }}
                      >
                        <SmallLabel>{t("report.fileType")}</SmallLabel>
                        <Select
                          value={fileType}
                          onChange={setFileType}
                          style={{ width: "100%" }}
                          options={[
                            { label: t("report.txtFormat"), value: "txt" },
                            { label: "Excel (.xlsx)", value: "xlsx" },
                          ]}
                          suffixIcon={
                            <Icon
                              icon="solar:alt-arrow-down-linear"
                              width={16}
                              height={16}
                              color={BP.text}
                            />
                          }
                        />
                      </div>

                      {/* Path row */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: BP.font,
                            fontSize: 14,
                            color: BP.text,
                          }}
                        >
                          Путь загрузки:
                        </span>
                        <span
                          style={{
                            fontFamily: BP.font,
                            fontSize: 16,
                            color: BP.green,
                            textDecoration: "underline",
                          }}
                        >
                          {t("report.downloadFolder")}
                        </span>
                      </div>
                    </div>

                    {/* Green button */}
                    <button
                      type="button"
                      disabled={isDownloadDisabled}
                      onClick={handleDownload}
                      style={{
                        background: isDownloadDisabled
                          ? BP.stroke
                          : BP.green,
                        color: BP.white,
                        border: "none",
                        borderRadius: 12,
                        padding: "12px 24px",
                        fontFamily: BP.font,
                        fontSize: 18,
                        fontWeight: 400,
                        cursor: isDownloadDisabled ? "not-allowed" : "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <Icon
                        icon="solar:file-download-linear"
                        width={18}
                        height={18}
                      />
                      {t("report.download")}
                    </button>
                  </BorderedCard>
                </div>
              </div>
            </div>

            {/* Optional preview (preserved old functionality) */}
            <div
              style={{
                marginTop: 12,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <button
                type="button"
                onClick={() => setPreviewOpen((v) => !v)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: BP.muted,
                  cursor: "pointer",
                  fontFamily: BP.font,
                  fontSize: 14,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: 0,
                }}
              >
                <Icon
                  icon={
                    previewOpen
                      ? "solar:alt-arrow-up-linear"
                      : "solar:alt-arrow-down-linear"
                  }
                  width={16}
                  height={16}
                />
                {previewOpen ? "Скрыть данные" : "Показать данные"}
              </button>
              <Button
                size="small"
                onClick={fetchData}
                style={{ borderRadius: 30 }}
                icon={
                  <Icon
                    icon="solar:refresh-linear"
                    width={14}
                    height={14}
                  />
                }
              >
                {t("common.refresh")}
              </Button>
            </div>

            {previewOpen && (
              <div
                style={{
                  border: `1px solid ${BP.stroke}`,
                  borderRadius: 24,
                  overflow: "hidden",
                }}
              >
                <Table
                  columns={columns}
                  dataSource={filteredCombinedData}
                  rowKey={(record) =>
                    `${record.clientId}_${record.date || "empty"}`
                  }
                  loading={loading}
                  pagination={{ pageSize: 50, showSizeChanger: false }}
                  scroll={{ y: 400 }}
                  size="middle"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
