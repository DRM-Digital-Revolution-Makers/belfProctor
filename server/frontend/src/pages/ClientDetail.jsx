import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  DatePicker,
  TimePicker,
  Image,
  Empty,
  Spin,
  Button,
  message,
  Space,
  Modal,
  Form,
  Input,
  Table,
  Dropdown,
} from "antd";
import { Icon } from "@iconify/react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import dayjs from "dayjs";
import { authFetch } from "../dataProvider";
import { formatTashkent } from "../utils/time";

/* ============ Design tokens (pixel-perfect Figma) ============ */
const BP = {
  white: "#FFFFFF",
  surface: "#F7F7F7",
  text: "#000000",
  muted: "#707070",
  light: "#A4A4A4",
  green: "#267E26",
  greenBright: "#36F097",
  red: "#DC2626",
  blue: "#22408C",
  stroke: "rgba(164,164,164,0.5)",
  shadow: "0 0 4px 0 rgba(241,243,248,1)",
  font: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "SF Pro", "Helvetica Neue", Arial, sans-serif',
};

/* ============ Page ============ */
const ClientDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;

  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [selectedMonth, setSelectedMonth] = useState(dayjs());
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [pdfDateRange, setPdfDateRange] = useState([
    dayjs().startOf("day"),
    dayjs().startOf("day"),
  ]);
  const [pdfTimeRange, setPdfTimeRange] = useState(null);
  const [activeTab, setActiveTab] = useState("day");

  // Daily Data
  const [dailyData, setDailyData] = useState({
    activeMs: 0,
    inactiveMs: 0,
    presenceMs: 0,
    startTime: null,
    endTime: null,
    screenshots: [],
  });

  // Monthly Data
  const [monthlyData, setMonthlyData] = useState(null);
  const [globalMonthlyData, setGlobalMonthlyData] = useState([]);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  const fetchDailyData = useCallback(
    async (date) => {
      setLoading(true);
      try {
        const dateStr = date.format("YYYY-MM-DD");
        const res = await authFetch(
          `${API_URL}/clients/${id}/daily-summary?date=${dateStr}`,
        );
        if (!res.ok) throw new Error("Failed to fetch data");
        const json = await res.json();
        setDailyData(json);
      } catch (error) {
        console.error(error);
        message.error(t("common.requestError"));
      } finally {
        setLoading(false);
      }
    },
    [id, t, API_URL],
  );

  const fetchMonthlyData = useCallback(
    async (month) => {
      setMonthlyLoading(true);
      try {
        const dateStr = month.format("YYYY-MM");
        const res = await authFetch(
          `${API_URL}/clients/${id}/monthly-summary?date=${dateStr}`,
        );
        if (!res.ok) throw new Error("Failed to fetch monthly data");
        const json = await res.json();
        setMonthlyData(json);

        const resGlobal = await authFetch(
          `${API_URL}/clients/reports/global-monthly-stats?month=${dateStr}`,
        );
        if (resGlobal.ok) {
          const jsonGlobal = await resGlobal.json();
          setGlobalMonthlyData(jsonGlobal);
        }
      } catch (error) {
        console.error(error);
        message.error(t("common.requestError"));
      } finally {
        setMonthlyLoading(false);
      }
    },
    [id, t, API_URL],
  );

  useEffect(() => {
    fetchDailyData(selectedDate);
  }, [fetchDailyData, selectedDate]);

  useEffect(() => {
    fetchMonthlyData(selectedMonth);
  }, [fetchMonthlyData, selectedMonth]);

  useEffect(() => {
    setPdfDateRange([selectedDate.startOf("day"), selectedDate.startOf("day")]);
  }, [selectedDate]);

  /* ============ Formatting ============ */
  const formatDurationHM = (ms) => {
    if (!ms || isNaN(ms)) return `0ч 0м`;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}ч ${minutes}м`;
  };

  const formatTime = (isoString) => {
    if (!isoString) return "—";
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "—";
    return dayjs(d).format("HH:mm");
  };

  const getImageUrl = (url) => {
    const baseUrl = API_URL.replace(/\/api$/, "");
    const token = localStorage.getItem("token") || "";
    return `${baseUrl}${url}?token=${token}`;
  };

  const imageFallback =
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="100%" height="100%" fill="#f5f5f5"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#999" font-family="Arial, sans-serif" font-size="16">Error</text></svg>',
    );

  const toggleFavorite = async (screenshotId, currentStatus) => {
    const newStatus = !currentStatus;
    try {
      const res = await authFetch(
        `${API_URL}/screenshots/${screenshotId}/favorite`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isFavorite: newStatus }),
        },
      );
      if (res.ok) {
        setDailyData((prev) => ({
          ...prev,
          screenshots: prev.screenshots.map((s) =>
            s.id === screenshotId ? { ...s, isFavorite: newStatus } : s,
          ),
        }));
      }
    } catch (e) {
      console.error(e);
      message.error(t("common.error"));
    }
  };

  const handleInfo = async () => {
    const resp = await authFetch(`${API_URL}/clients/${id}`);
    if (!resp.ok) return;
    const info = await resp.json();
    Modal.info({
      title: `${t("common.client")} ${info.id}`,
      content: (
        <div style={{ display: "grid", gap: 8 }}>
          <div>
            EncryptionKey: <Input readOnly value={info.encryptionKey || ""} />
          </div>
          <Form
            layout="vertical"
            onFinish={async (vals) => {
              const headers2 = { "Content-Type": "application/json" };
              await authFetch(`${API_URL}/commands/send`, {
                method: "POST",
                headers: headers2,
                body: JSON.stringify({
                  clientId: id,
                  type: "setIntervals",
                  payload: vals,
                }),
              });
              message.success(t("clients.commandSent"));
            }}
          >
            <Form.Item name="heartbeatMs" label={t("common.heartbeatMs")}>
              <Input placeholder={`${t("common.example")} 5000`} />
            </Form.Item>
            <Form.Item name="activityMs" label={t("common.activityMs")}>
              <Input placeholder={`${t("common.example")} 3000`} />
            </Form.Item>
            <Form.Item name="screenshotMs" label={t("common.screenshotMs")}>
              <Input placeholder={`${t("common.example")} 60000`} />
            </Form.Item>
            <Button htmlType="submit" type="primary">
              {t("common.setIntervals")}
            </Button>
          </Form>
        </div>
      ),
      okText: t("common.close"),
    });
  };

  const handleDelete = () => {
    let password = "";
    Modal.confirm({
      title: t("common.delete"),
      content: (
        <div>
          <div style={{ marginBottom: 12 }}>{t("clients.deleteConfirm")}</div>
          <Input.Password
            placeholder={t("common.password")}
            onChange={(e) => {
              password = e.target.value;
            }}
          />
        </div>
      ),
      onOk: async () => {
        if (!String(password || "").trim()) {
          message.error(t("common.password"));
          throw new Error("password_required");
        }
        const resp = await authFetch(`${API_URL}/clients/${id}`, {
          method: "DELETE",
          headers: { "X-Admin-Password": String(password || "").trim() },
        });
        if (resp.ok) {
          message.success(t("clients.deleted"));
          navigate("/clients");
        } else {
          let err = "";
          try {
            const j = await resp.json();
            err = String(j?.message || "");
          } catch {
            err = "";
          }
          message.error(
            err
              ? `${t("clients.deleteError")}: ${err}`
              : t("clients.deleteError"),
          );
        }
      },
    });
  };

  /* ============ CSV downloads ============ */
  const getNoun = (number, one, two, five) => {
    let n = Math.abs(number);
    n %= 100;
    if (n >= 5 && n <= 20) return five;
    n %= 10;
    if (n === 1) return one;
    if (n >= 2 && n <= 4) return two;
    return five;
  };

  const formatDurationVerbose = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / (3600 * 24));
    const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const lang = i18n.language;
    if (lang === "ru") {
      const parts = [];
      if (days > 0)
        parts.push(`${days} ${getNoun(days, "день", "дня", "дней")}`);
      if (hours > 0)
        parts.push(`${hours} ${getNoun(hours, "час", "часа", "часов")}`);
      if (minutes > 0) parts.push(`${minutes} мин`);
      if (seconds > 0)
        parts.push(
          `${seconds} ${getNoun(seconds, "секунда", "секунды", "секунд")}`,
        );
      return parts.length > 0 ? parts.join(" ") : "0 секунд";
    } else {
      const parts = [];
      if (days > 0) parts.push(`${days} ${t("common.days")}`);
      if (hours > 0) parts.push(`${hours} ${t("common.hours")}`);
      if (minutes > 0) parts.push(`${minutes} ${t("common.minutes")}`);
      if (seconds > 0) parts.push(`${seconds} ${t("common.seconds")}`);
      return parts.length > 0 ? parts.join(" ") : `0 ${t("common.seconds")}`;
    }
  };

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return "";
    return `"${String(val).replace(/"/g, '""')}"`;
  };

  const downloadCSV = (data, filename) => {
    const bom = "﻿";
    const csvContent =
      "data:text/csv;charset=utf-8," + encodeURIComponent(bom + data);
    const link = document.createElement("a");
    link.setAttribute("href", csvContent);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadDaily = () => {
    if (!dailyData) return;
    const summaryRows = [
      [t("csv.date"), selectedDate.format("YYYY-MM-DD")],
      [t("csv.activeTime"), formatDurationVerbose(dailyData.activeMs)],
      [t("csv.inactiveTime"), formatDurationVerbose(dailyData.inactiveMs)],
      [t("csv.screenshotsCount"), dailyData.screenshots.length],
      [],
    ]
      .map((row) => row.map(escapeCSV).join(";"))
      .join("\n");

    let topAppsSection = "";
    if (dailyData.topApps && dailyData.topApps.length > 0) {
      const topAppsHeader = [t("csv.application"), t("csv.usageCount")]
        .map(escapeCSV)
        .join(";");
      const topAppsRows = dailyData.topApps
        .map((app) => [app.name, app.count].map(escapeCSV).join(";"))
        .join("\n");
      topAppsSection = `\n\n"${t("csv.top5Apps")}"\n${topAppsHeader}\n${topAppsRows}`;
    }

    let hourlySection = "";
    if (dailyData.hourly) {
      const hourlyHeader = [
        t("csv.hour"),
        t("csv.activeTime"),
        t("csv.inactiveTime"),
        t("csv.screenshotsCount"),
      ]
        .map(escapeCSV)
        .join(";");
      const hourlyRows = dailyData.hourly
        .map((h) =>
          [
            `${String(h.hour).padStart(2, "0")}:00 - ${String(h.hour + 1).padStart(2, "0")}:00`,
            formatDurationVerbose(h.activeMs),
            formatDurationVerbose(h.inactiveMs),
            h.screenshotsCount,
          ]
            .map(escapeCSV)
            .join(";"),
        )
        .join("\n");
      hourlySection = `\n\n"${t("csv.hourlyActivity")}"\n${hourlyHeader}\n${hourlyRows}`;
    }

    const screenshotsHeader = [
      t("csv.time"),
      t("csv.filename"),
      t("csv.favorite"),
    ]
      .map(escapeCSV)
      .join(";");
    const screenshotsRows = dailyData.screenshots
      .map((s) =>
        [
          dayjs(s.timestamp).format("HH:mm:ss"),
          s.filename,
          s.isFavorite ? t("common.yes") : t("common.no"),
        ]
          .map(escapeCSV)
          .join(";"),
      )
      .join("\n");
    const screenshotsSection = `\n\n"${t("csv.screenshots")}"\n${screenshotsHeader}\n${screenshotsRows}`;

    downloadCSV(
      summaryRows + topAppsSection + hourlySection + screenshotsSection,
      `report_daily_${id}_${selectedDate.format("YYYY-MM-DD")}.csv`,
    );
  };

  const handleDownloadMonthly = () => {
    if (!monthlyData) return;
    const summaryRows = [
      ["Месяц", monthlyData.month],
      ["Всего активно", formatDurationVerbose(monthlyData.totalActiveMs)],
      ["Всего неактивно", formatDurationVerbose(monthlyData.totalInactiveMs)],
      ["Всего скриншотов", monthlyData.totalScreenshots],
      [],
    ]
      .map((row) => row.map(escapeCSV).join(";"))
      .join("\n");

    let topAppsSection = "";
    if (monthlyData.topApps && monthlyData.topApps.length > 0) {
      const topAppsHeader = ["Приложение", "Количество использований"]
        .map(escapeCSV)
        .join(";");
      const topAppsRows = monthlyData.topApps
        .map((app) => [app.name, app.count].map(escapeCSV).join(";"))
        .join("\n");
      topAppsSection = `\n"Топ 5 приложений"\n${topAppsHeader}\n${topAppsRows}\n`;
    }

    const header = [
      "Дата",
      "Активное время",
      "Неактивное время",
      "Количество скриншотов",
    ]
      .map(escapeCSV)
      .join(";");
    const rows = monthlyData.days
      .map((d) =>
        [
          d.date,
          formatDurationVerbose(d.activeMs),
          formatDurationVerbose(d.inactiveMs),
          d.screenshotsCount,
        ]
          .map(escapeCSV)
          .join(";"),
      )
      .join("\n");

    downloadCSV(
      summaryRows + topAppsSection + "\n" + header + "\n" + rows,
      `report_monthly_${id}_${monthlyData.month}.csv`,
    );
  };

  const extractFilename = (contentDisposition) => {
    const raw = String(contentDisposition || "");
    const match = raw.match(/filename="([^"]+)"/i);
    return match ? match[1] : "";
  };

  const handleDownloadScreenshotsPdf = async () => {
    const [fromD, toD] = pdfDateRange || [];
    if (!fromD || !toD) return;
    const from = fromD.format("YYYY-MM-DD");
    const to = toD.format("YYYY-MM-DD");
    const params = new URLSearchParams({ from, to });
    if (pdfTimeRange && pdfTimeRange[0] && pdfTimeRange[1]) {
      params.set("startTime", pdfTimeRange[0].format("HH:mm"));
      params.set("endTime", pdfTimeRange[1].format("HH:mm"));
    }
    setPdfDownloading(true);
    const msgKey = "screenshots_pdf";
    message.loading({ content: t("reports.generatingPdf"), key: msgKey });
    try {
      const res = await authFetch(
        `${API_URL}/clients/${id}/screenshots/pdf?${params.toString()}`,
      );
      if (!res.ok) {
        if (res.status === 404) {
          message.error({
            content: t("reports.noScreenshotsForPeriod"),
            key: msgKey,
          });
          return;
        }
        throw new Error("Failed to download PDF");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const filename =
        extractFilename(res.headers.get("Content-Disposition")) ||
        `screenshots_${id}_${from}_${to}.pdf`;
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      message.success({ content: t("common.download"), key: msgKey });
      setPdfModalOpen(false);
    } catch (e) {
      console.error(e);
      message.error({ content: t("common.requestError"), key: msgKey });
    } finally {
      setPdfDownloading(false);
    }
  };

  /* ============ Derived data ============ */
  const combinedChartData = React.useMemo(() => {
    if (!monthlyData || !monthlyData.days) return [];
    const globalMap = new Map();
    if (globalMonthlyData) {
      globalMonthlyData.forEach((d) => globalMap.set(d.date, d.totalActiveMs));
    }
    return monthlyData.days.map((d) => {
      const globalTotal = globalMap.get(d.date) || 0;
      return {
        day: d.date.split("-")[2],
        date: d.date,
        activeHours: Number((d.activeMs / 3600000).toFixed(2)),
        inactiveHours: Number((d.inactiveMs / 3600000).toFixed(2)),
        globalTotalHours: Number((globalTotal / 3600000).toFixed(2)),
      };
    });
  }, [monthlyData, globalMonthlyData]);

  // Derived: lateness for "Опоздание" subtitle (assume work starts at 08:00)
  const workEndTarget = "18:00";
  const startInfo = React.useMemo(() => {
    if (!dailyData.startTime) return { time: "—", late: false, sub: "" };
    const time = formatTime(dailyData.startTime);
    if (time === "—") return { time, late: false, sub: "" };
    const [h, m] = time.split(":").map(Number);
    const startMin = h * 60 + m;
    const targetMin = 8 * 60;
    if (startMin > targetMin) {
      const lateMin = startMin - targetMin;
      const lh = Math.floor(lateMin / 60);
      const lm = lateMin % 60;
      return {
        time,
        late: true,
        sub: `Опоздание на ${lh ? `${lh}ч ` : ""}${lm}м`,
      };
    }
    return { time, late: false, sub: "Без опоздания" };
  }, [dailyData.startTime]);

  const endInfo = React.useMemo(() => {
    if (!dailyData.endTime)
      return {
        time: null,
        finished: false,
        sub: `${workEndTarget} конец рабочего дня`,
      };
    return {
      time: formatTime(dailyData.endTime),
      finished: true,
      sub: `${workEndTarget} конец рабочего дня`,
    };
  }, [dailyData.endTime]);

  const presencePct = React.useMemo(() => {
    const ms = dailyData.presenceMs || 0;
    const target = 8 * 3600 * 1000;
    return Math.round((ms / target) * 100);
  }, [dailyData.presenceMs]);

  const inactivePct = React.useMemo(() => {
    const total = (dailyData.activeMs || 0) + (dailyData.inactiveMs || 0);
    if (!total) return 0;
    return Math.round(((dailyData.inactiveMs || 0) / total) * 100);
  }, [dailyData.activeMs, dailyData.inactiveMs]);

  /* ============ Render ============ */
  return (
    <div>
      {/* Outer wrapper */}
      <div
        className="bp-page-shell"
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
        {/* Inner card */}
        <div
          style={{
            background: BP.white,
            borderRadius: 30,
            boxShadow: BP.shadow,
            display: "flex",
            flexDirection: "column",
            flex: 1,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "20px 20px 0",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: 10 }}
              >
                <button
                  type="button"
                  onClick={() => navigate("/clients")}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 4,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon
                    icon="solar:arrow-left-linear"
                    width={28}
                    height={28}
                    color={BP.text}
                  />
                </button>
                <h2
                  style={{
                    margin: 0,
                    fontFamily: BP.font,
                    fontSize: 24,
                    fontWeight: 510,
                    color: BP.text,
                    letterSpacing: "-0.2px",
                  }}
                >
                  {id}
                </h2>
              </div>

              {/* Header actions */}
              <Space size={8}>
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: [
                      {
                        key: "info",
                        label: t("common.info"),
                        onClick: handleInfo,
                      },
                      {
                        key: "csv-day",
                        label: "Скачать дневной CSV",
                        onClick: handleDownloadDaily,
                      },
                      {
                        key: "csv-month",
                        label: "Скачать месячный CSV",
                        onClick: handleDownloadMonthly,
                      },
                      {
                        key: "pdf",
                        label: t("reports.downloadScreenshotsPdf"),
                        onClick: () => setPdfModalOpen(true),
                      },
                      { type: "divider" },
                      {
                        key: "screenshots-all",
                        label: t("nav.screenshots"),
                        onClick: () =>
                          navigate(
                            `/screenshots?clientId=${encodeURIComponent(id)}`,
                          ),
                      },
                      { type: "divider" },
                      {
                        key: "delete",
                        label: t("common.delete"),
                        danger: true,
                        onClick: handleDelete,
                      },
                    ],
                  }}
                >
                  <button
                    type="button"
                    style={{
                      background: BP.white,
                      border: `1px solid ${BP.light}`,
                      borderRadius: 20,
                      width: 36,
                      height: 36,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon
                      icon="solar:menu-dots-bold"
                      width={20}
                      height={20}
                      color={BP.text}
                    />
                  </button>
                </Dropdown>
              </Space>
            </div>
          </div>

          {/* Tab bar */}
          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              padding: "0 20px",
              gap: 2,
              marginTop: 8,
              overflowX: "auto",
              whiteSpace: "nowrap",
            }}
          >
            <TabButton
              active={activeTab === "day"}
              onClick={() => setActiveTab("day")}
            >
              Дашборд за День
              {activeTab === "day" && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "6px 8px",
                    borderRadius: 8,
                    background: BP.surface,
                    marginLeft: 8,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <DatePicker
                    value={selectedDate}
                    onChange={(d) => d && setSelectedDate(d)}
                    allowClear={false}
                    variant="borderless"
                    suffixIcon={
                      <Icon
                        icon="solar:calendar-bold-duotone"
                        width={16}
                        height={16}
                        color={BP.text}
                      />
                    }
                    size="small"
                    style={{ padding: 0, fontFamily: BP.font, fontSize: 14 }}
                    format="DD-MM-YYYY"
                  />
                </div>
              )}
            </TabButton>
            <TabButton
              active={activeTab === "month"}
              onClick={() => setActiveTab("month")}
            >
              Дашборд за Месяц
              {activeTab === "month" && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "6px 8px",
                    borderRadius: 8,
                    background: BP.surface,
                    marginLeft: 8,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <DatePicker
                    picker="month"
                    value={selectedMonth}
                    onChange={(d) => d && setSelectedMonth(d)}
                    allowClear={false}
                    variant="borderless"
                    suffixIcon={
                      <Icon
                        icon="solar:calendar-bold-duotone"
                        width={16}
                        height={16}
                        color={BP.text}
                      />
                    }
                    size="small"
                    style={{ padding: 0, fontFamily: BP.font, fontSize: 14 }}
                    format="MM-YYYY"
                  />
                </div>
              )}
            </TabButton>
            <TabButton
              active={activeTab === "apps"}
              onClick={() => setActiveTab("apps")}
            >
              Приложения
            </TabButton>
            <TabButton
              active={activeTab === "files"}
              onClick={() => setActiveTab("files")}
            >
              Файлы
            </TabButton>
            <TabButton active={activeTab === "work"} onClick={() => setActiveTab("work")}>
              Проекты / Файлы
            </TabButton>
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

          {/* Tab content */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: 20,
            }}
          >
            {activeTab === "day" &&
              (loading ? (
                <div style={{ textAlign: "center", padding: 40 }}>
                  <Spin size="large" />
                </div>
              ) : (
                <DayTab
                  dailyData={dailyData}
                  formatDurationHM={formatDurationHM}
                  startInfo={startInfo}
                  endInfo={endInfo}
                  presencePct={presencePct}
                  inactivePct={inactivePct}
                  toggleFavorite={toggleFavorite}
                  getImageUrl={getImageUrl}
                  imageFallback={imageFallback}
                  onOpenAllScreenshots={() =>
                    navigate(
                      `/screenshots?clientId=${encodeURIComponent(id)}&date=${selectedDate.format("YYYY-MM-DD")}`,
                    )
                  }
                  i18n={i18n}
                />
              ))}

            {activeTab === "month" &&
              (monthlyLoading ? (
                <div style={{ textAlign: "center", padding: 40 }}>
                  <Spin size="large" />
                </div>
              ) : monthlyData ? (
                <MonthTab
                  monthlyData={monthlyData}
                  formatDurationHM={formatDurationHM}
                  combinedChartData={combinedChartData}
                  t={t}
                />
              ) : (
                <Empty description={t("common.noData")} />
              ))}

            {activeTab === "apps" && (
              <AppsTab clientId={id} t={t} i18n={i18n} />
            )}

            {activeTab === "files" && (
              <FilesTab clientId={id} t={t} i18n={i18n} />
            )}

            {activeTab === "work" && (
              <WorkTab
                clientId={id}
                date={selectedDate}
                getImageUrl={getImageUrl}
              />
            )}
          </div>
        </div>
      </div>

      {/* PDF Modal — preserved */}
      <Modal
        title={t("reports.downloadScreenshotsPdf")}
        open={pdfModalOpen}
        onCancel={() => setPdfModalOpen(false)}
        onOk={handleDownloadScreenshotsPdf}
        okButtonProps={{ loading: pdfDownloading }}
        okText={t("common.download")}
        cancelText={t("common.cancel")}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <div>
            <div style={{ marginBottom: 8 }}>{t("reports.selectDays")}:</div>
            <DatePicker.RangePicker
              value={pdfDateRange}
              onChange={(vals) => vals && setPdfDateRange(vals)}
              allowClear={false}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <div style={{ marginBottom: 8 }}>{t("reports.selectTimeRange")}:</div>
            <TimePicker.RangePicker
              value={pdfTimeRange}
              onChange={(vals) => setPdfTimeRange(vals)}
              format="HH:mm"
              minuteStep={1}
              allowClear
              style={{ width: "100%" }}
            />
          </div>
        </Space>
      </Modal>
    </div>
  );
};

/* ============ Sub-components ============ */
function TabButton({ active, onClick, children }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      className="bp-tab-button"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      style={{
        borderBottom: active ? `1px solid ${BP.green}` : "1px solid transparent",
        borderRadius: "10px 10px 0 0",
        padding: "12px 20px",
        cursor: "pointer",
        color: active ? BP.green : BP.light,
        fontFamily: BP.font,
        fontSize: 16,
        fontWeight: 510,
        display: "inline-flex",
        alignItems: "center",
        userSelect: "none",
      }}
    >
      {children}
    </div>
  );
}

function StatCard({ title, value, valueColor, sub }) {
  return (
    <div
      className="bp-interactive-card"
      style={{
        flex: 1,
        minWidth: 200,
        background: BP.white,
        border: `1px solid ${BP.stroke}`,
        borderRadius: 30,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 12,
        minHeight: 140,
      }}
    >
      <div
        style={{
          fontFamily: BP.font,
          fontSize: 20,
          fontWeight: 510,
          color: BP.text,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: BP.font,
          fontSize: 32,
          fontWeight: 400,
          lineHeight: 1,
          color: valueColor || BP.text,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: BP.font,
          fontSize: 16,
          color: BP.muted,
        }}
      >
        {sub}
      </div>
    </div>
  );
}

function ThumbnailGrid({
  screenshots,
  getImageUrl,
  imageFallback,
  toggleFavorite,
  onOpenAllScreenshots,
  i18n,
}) {
  if (!screenshots || screenshots.length === 0) {
    return (
      <div style={{ padding: 20 }}>
        <Empty description="Нет скриншотов" />
      </div>
    );
  }
  // Show up to 30 (6 rows of 5) — enough that "Показать все 118" doesn't feel like a tease.
  const PREVIEW_LIMIT = 30;
  const shown = screenshots.slice(0, PREVIEW_LIMIT);
  const rows = [];
  for (let i = 0; i < shown.length; i += 5) rows.push(shown.slice(i, i + 5));
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      {rows.map((row, ri) => (
        <div key={ri} style={{ display: "flex", gap: 10 }}>
          {row.map((s) => (
            <div
              key={s.id}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "16/9",
                  borderRadius: 10,
                  overflow: "hidden",
                  background: BP.surface,
                }}
              >
                <Image
                  alt={s.filename}
                  src={getImageUrl(s.url)}
                  fallback={imageFallback}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    borderRadius: 10,
                  }}
                />
                <button
                  type="button"
                  onClick={() => toggleFavorite(s.id, s.isFavorite)}
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    background: "rgba(255,255,255,0.85)",
                    border: "none",
                    borderRadius: 20,
                    width: 28,
                    height: 28,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon
                    icon={
                      s.isFavorite ? "solar:star-bold" : "solar:star-linear"
                    }
                    width={16}
                    height={16}
                    color={s.isFavorite ? "#F59E0B" : BP.muted}
                  />
                </button>
              </div>
              <div
                style={{
                  fontFamily: BP.font,
                  fontSize: 12,
                  color: BP.text,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {formatTashkent(s.timestamp, "HH:mm")}
              </div>
            </div>
          ))}
          {row.length < 5 &&
            Array.from({ length: 5 - row.length }).map((_, i) => (
              <div key={`empty-${i}`} style={{ flex: 1 }} />
            ))}
        </div>
      ))}
      {screenshots.length > PREVIEW_LIMIT && (
        <div style={{ textAlign: "right", marginTop: 4 }}>
          <button
            type="button"
            onClick={onOpenAllScreenshots}
            style={{
              background: "transparent",
              border: "none",
              color: BP.green,
              cursor: "pointer",
              fontFamily: BP.font,
              fontSize: 14,
            }}
          >
            Показать все ({screenshots.length}) →
          </button>
        </div>
      )}
    </div>
  );
}

function DayTab({
  dailyData,
  formatDurationHM,
  startInfo,
  endInfo,
  presencePct,
  inactivePct,
  toggleFavorite,
  getImageUrl,
  imageFallback,
  onOpenAllScreenshots,
  i18n,
}) {
  return (
    <>
      {/* Stats row */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatCard
          title="Активность за сегодня"
          value={formatDurationHM(dailyData.activeMs)}
          valueColor={BP.green}
          sub={`из ${formatDurationHM(8 * 3600 * 1000)}`}
        />
        <StatCard
          title="Присутствовал"
          value={formatDurationHM(dailyData.presenceMs)}
          valueColor={BP.text}
          sub={`${presencePct}% от нормы`}
        />
        <StatCard
          title="Неактивное время"
          value={formatDurationHM(dailyData.inactiveMs)}
          valueColor={BP.red}
          sub={`${inactivePct}% рабочего дня`}
        />
      </div>

      {/* Working day card */}
      <div
        style={{
          display: "flex",
          background: BP.white,
          border: `1px solid ${BP.stroke}`,
          borderRadius: 30,
          padding: 20,
          minHeight: 140,
          gap: 20,
        }}
      >
        {/* Start */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontFamily: BP.font,
              fontSize: 20,
              fontWeight: 510,
              color: BP.text,
            }}
          >
            Начало рабочего дня
          </div>
          <div
            style={{
              fontFamily: BP.font,
              fontSize: 32,
              fontWeight: 400,
              lineHeight: 1,
              color: startInfo.late ? BP.red : BP.green,
            }}
          >
            {startInfo.time}
          </div>
          <div
            style={{
              fontFamily: BP.font,
              fontSize: 16,
              color: startInfo.late ? BP.red : BP.muted,
            }}
          >
            {startInfo.sub}
          </div>
        </div>

        {/* Vertical divider */}
        <div
          style={{
            width: 1,
            background: BP.light,
            alignSelf: "stretch",
          }}
        />

        {/* End */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            alignItems: "flex-end",
            textAlign: "right",
          }}
        >
          <div
            style={{
              fontFamily: BP.font,
              fontSize: 20,
              fontWeight: 510,
              color: BP.text,
            }}
          >
            Конец рабочего дня
          </div>
          {endInfo.finished ? (
            <div
              style={{
                fontFamily: BP.font,
                fontSize: 32,
                fontWeight: 400,
                lineHeight: 1,
                color: BP.green,
              }}
            >
              {endInfo.time}
            </div>
          ) : (
            <div
              style={{
                fontFamily: BP.font,
                fontSize: 24,
                fontWeight: 400,
                color: BP.green,
              }}
            >
              Еще не закончил
            </div>
          )}
          <div
            style={{
              fontFamily: BP.font,
              fontSize: 16,
              color: BP.muted,
            }}
          >
            {endInfo.sub}
          </div>
        </div>
      </div>

      {/* Screenshots section */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontFamily: BP.font,
              fontSize: 24,
              fontWeight: 510,
              color: BP.text,
            }}
          >
            Скриншоты
          </div>
          <button
            type="button"
            onClick={onOpenAllScreenshots}
            style={{
              background: BP.white,
              border: `1px solid ${BP.light}`,
              borderRadius: 20,
              width: 36,
              height: 36,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon
              icon="solar:arrow-right-up-linear"
              width={18}
              height={18}
              color={BP.text}
            />
          </button>
        </div>
        <div
          style={{
            maxHeight: 540,
            overflowY: "auto",
            paddingRight: 4,
          }}
        >
          <ThumbnailGrid
            screenshots={dailyData.screenshots}
            getImageUrl={getImageUrl}
            imageFallback={imageFallback}
            toggleFavorite={toggleFavorite}
            onOpenAllScreenshots={onOpenAllScreenshots}
            i18n={i18n}
          />
        </div>
      </div>
    </>
  );
}

function MonthTab({ monthlyData, formatDurationHM, combinedChartData, t }) {
  return (
    <>
      {/* Stats row */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatCard
          title={t("reports.totalActive")}
          value={formatDurationHM(monthlyData.totalActiveMs)}
          valueColor={BP.green}
          sub={monthlyData.month}
        />
        <StatCard
          title={t("reports.totalInactive")}
          value={formatDurationHM(monthlyData.totalInactiveMs)}
          valueColor={BP.red}
          sub={monthlyData.month}
        />
        <StatCard
          title={t("reports.totalScreenshots")}
          value={monthlyData.totalScreenshots}
          valueColor={BP.text}
          sub={t("nav.screenshots")}
        />
      </div>

      {/* Chart */}
      <div
        style={{
          background: BP.white,
          border: `1px solid ${BP.stroke}`,
          borderRadius: 30,
          padding: 20,
        }}
      >
        <div
          style={{
            fontFamily: BP.font,
            fontSize: 20,
            fontWeight: 510,
            color: BP.text,
            marginBottom: 16,
          }}
        >
          {t("common.clientPerformance")}
        </div>
        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={combinedChartData}>
              <defs>
                <linearGradient id="colorActive" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={BP.greenBright}
                    stopOpacity={1}
                  />
                  <stop
                    offset="100%"
                    stopColor={BP.greenBright}
                    stopOpacity={0.2}
                  />
                </linearGradient>
                <linearGradient id="colorGlobal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8884d8" stopOpacity={0.7} />
                  <stop offset="100%" stopColor="#8884d8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={BP.stroke} />
              <XAxis dataKey="day" stroke={BP.muted} />
              <YAxis stroke={BP.muted} />
              <RechartsTooltip />
              <Legend />
              <Area
                type="monotone"
                dataKey="activeHours"
                name={t("common.activeHoursTitle")}
                stroke={BP.greenBright}
                strokeWidth={2}
                fill="url(#colorActive)"
              />
              <Area
                type="monotone"
                dataKey="globalTotalHours"
                name={t("common.globalActiveHours")}
                stroke="#8884d8"
                strokeWidth={1.5}
                fill="url(#colorGlobal)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Days table */}
      {monthlyData.days && monthlyData.days.length > 0 && (
        <div
          style={{
            background: BP.white,
            border: `1px solid ${BP.stroke}`,
            borderRadius: 30,
            overflow: "hidden",
          }}
        >
          <Table
            dataSource={monthlyData.days}
            rowKey="date"
            pagination={false}
            size="middle"
            scroll={{ y: 400 }}
            columns={[
              { title: t("csv.date"), dataIndex: "date" },
              {
                title: t("csv.activeTime"),
                dataIndex: "activeMs",
                render: (v) => formatDurationHM(v),
              },
              {
                title: t("csv.inactiveTime"),
                dataIndex: "inactiveMs",
                render: (v) => formatDurationHM(v),
              },
              {
                title: t("csv.screenshotsCount"),
                dataIndex: "screenshotsCount",
              },
            ]}
          />
        </div>
      )}
    </>
  );
}

function WorkTab({ clientId, date, getImageUrl }) {
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;
  const [summary, setSummary] = React.useState(null);
  const [sessions, setSessions] = React.useState([]);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const dateStr = date.format("YYYY-MM-DD");
      const from = date.startOf("day").toISOString();
      const to = date.endOf("day").toISOString();
      const [summaryRes, sessionsRes] = await Promise.all([
        authFetch(`${API_URL}/clients/${clientId}/work-summary?date=${dateStr}`),
        authFetch(`${API_URL}/clients/${clientId}/work-sessions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
      ]);
      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (sessionsRes.ok) {
        const json = await sessionsRes.json();
        setSessions(Array.isArray(json.data) ? json.data : []);
      }
    } catch (e) {
      console.error(e);
      message.error("Не удалось загрузить рабочие сессии");
    } finally {
      setLoading(false);
    }
  }, [API_URL, clientId, date]);

  React.useEffect(() => {
    load();
  }, [load]);

  const totals = summary?.totals || {};
  const projects = summary?.projects || [];
  const files = summary?.files || [];
  const folders = summary?.folders || [];
  const apps = summary?.apps || [];
  const screenshots = Array.isArray(summary?.screenshots) ? summary.screenshots : [];
  const sessionColumns = [
    { title: "Начало", dataIndex: "startedAt", render: fmtWorkDateTime, width: 150 },
    { title: "Приложение", dataIndex: "processName", render: renderWorkApp, width: 150 },
    { title: "Проект", dataIndex: "projectName", render: renderProjectName, width: 180 },
    { title: "Файл", dataIndex: "filePath", render: renderWorkPath, ellipsis: true },
    { title: "Открыто", dataIndex: "openedMs", render: formatWorkDuration, width: 110 },
    { title: "Фокус", dataIndex: "focusedMs", render: formatWorkDuration, width: 120 },
    { title: "Активно", dataIndex: "activeFocusedMs", render: formatWorkDuration, width: 120 },
    { title: "Точность", dataIndex: "confidence", render: renderConfidence, width: 130 },
    { title: "Завершение", dataIndex: "endReason", render: renderEndReason, width: 130 },
  ];

  return (
    <div className="bp-fade-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        className="bp-section-card bp-interactive-card"
        style={{
          borderRadius: 14,
          background: BP.white,
          padding: "14px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontFamily: BP.font, fontSize: 16, fontWeight: 510, color: BP.text }}>
            Работа с проектами и файлами
          </div>
          <div style={{ fontFamily: BP.font, fontSize: 13, color: BP.muted, marginTop: 3 }}>
            Данные за {date.format("DD.MM.YYYY")}: приложения, пути, проекты и связанные скриншоты.
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="bp-ghost-action"
          style={{
            border: `1px solid ${BP.stroke}`,
            background: BP.surface,
            color: BP.text,
            borderRadius: 10,
            padding: "8px 12px",
            cursor: loading ? "wait" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontFamily: BP.font,
            fontSize: 13,
          }}
        >
          <Icon
            icon="solar:refresh-linear"
            width={16}
            height={16}
            style={loading ? { animation: "bp-spin 1s linear infinite" } : undefined}
          />
          Обновить
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <MetricBox icon="solar:folder-open-bold-duotone" label="Открыто" value={formatWorkDuration(totals.openedMs)} />
        <MetricBox icon="solar:eye-bold-duotone" label="В фокусе" value={formatWorkDuration(totals.focusedMs)} />
        <MetricBox icon="solar:user-check-bold-duotone" label="Активно в фокусе" value={formatWorkDuration(totals.activeFocusedMs)} />
        <MetricBox icon="solar:clock-circle-bold-duotone" label="Сессии" value={String(sessions.length)} />
      </div>

      <LiveViewPanel clientId={clientId} apiUrl={API_URL} />

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: BP.muted }}>
          <Spin size="large" />
          <div style={{ marginTop: 12, fontFamily: BP.font, fontSize: 13 }}>
            Загружаю рабочие сессии...
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 12,
            }}
          >
            <MetricTable icon="solar:case-round-bold-duotone" title="Проекты" rows={projects} nameKey="projectName" emptyText="За день проекты не определены" />
            <MetricTable icon="solar:document-text-bold-duotone" title="Файлы" rows={files} nameKey="filePath" emptyText="Файлы пока не зафиксированы" />
            <MetricTable icon="solar:folder-bold-duotone" title="Папки" rows={folders} nameKey="folderPath" emptyText="Папки пока не зафиксированы" />
            <MetricTable icon="solar:widget-5-bold-duotone" title="Приложения" rows={apps} nameKey="processName" emptyText="Активность приложений пока пустая" />
          </div>

          <div className="bp-section-card bp-interactive-card" style={{ borderRadius: 14, overflow: "hidden", background: BP.white }}>
            <div
              style={{
                padding: "12px 14px",
                fontFamily: BP.font,
                fontSize: 16,
                fontWeight: 510,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span>Рабочие сессии</span>
              <span style={{ color: BP.muted, fontSize: 13, fontWeight: 400 }}>
                {sessions.length ? `${sessions.length} записей` : "Нет записей"}
              </span>
            </div>
            <Table
              size="small"
              rowKey="id"
              dataSource={sessions}
              columns={sessionColumns}
              pagination={{ pageSize: 10 }}
              scroll={{ x: 980 }}
              locale={{
                emptyText: (
                  <WorkEmptyState
                    icon="solar:calendar-search-bold-duotone"
                    title="Рабочих сессий за этот день нет"
                    description="Когда агент увидит работу в приложениях, строки появятся здесь."
                  />
                ),
              }}
            />
          </div>

          <div className="bp-section-card bp-interactive-card" style={{ borderRadius: 14, padding: 14, background: BP.white }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <div style={{ fontFamily: BP.font, fontSize: 16, fontWeight: 510 }}>Связанные скриншоты</div>
              <span style={{ color: BP.muted, fontFamily: BP.font, fontSize: 13 }}>
                {screenshots.length ? `Показано: ${Math.min(12, screenshots.length)}` : "Пока пусто"}
              </span>
            </div>
            {screenshots.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                {screenshots.slice(0, 12).map((shot) => (
                  <Image
                    key={shot.id || shot.filename}
                    src={getImageUrl(shot.url)}
                    style={{ width: "100%", height: 112, objectFit: "cover", borderRadius: 10, border: `1px solid ${BP.stroke}` }}
                    preview
                  />
                ))}
              </div>
            ) : (
              <WorkEmptyState
                icon="solar:gallery-minimalistic-bold-duotone"
                title="Скриншоты появятся после рабочих событий"
                description="Старт, переключение проекта и завершение сессии будут связываться с кадрами."
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MetricBox({ icon, label, value }) {
  return (
    <div
      className="bp-soft-panel bp-hover-row"
      style={{
        padding: 14,
        display: "flex",
        alignItems: "center",
        gap: 12,
        minHeight: 74,
      }}
    >
      <span
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          background: "rgba(38,126,38,0.09)",
          display: "inline-grid",
          placeItems: "center",
          color: BP.green,
          flex: "0 0 auto",
        }}
      >
        <Icon icon={icon} width={20} height={20} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: BP.muted, fontFamily: BP.font, fontSize: 13 }}>{label}</div>
        <div style={{ color: BP.text, fontFamily: BP.font, fontSize: 22, fontWeight: 510, marginTop: 2 }}>{value}</div>
      </div>
    </div>
  );
}

function MetricTable({ icon, title, rows, nameKey, emptyText }) {
  const data = (rows || []).slice(0, 8).map((row, idx) => ({ ...row, key: `${title}_${idx}` }));
  const isPath = nameKey === "filePath" || nameKey === "folderPath";
  return (
    <div className="bp-section-card bp-interactive-card" style={{ borderRadius: 14, overflow: "hidden", background: BP.white }}>
      <div style={{ padding: "11px 12px", fontFamily: BP.font, fontSize: 15, fontWeight: 510, display: "flex", alignItems: "center", gap: 8 }}>
        <Icon icon={icon} width={17} height={17} color={BP.green} />
        {title}
      </div>
      <Table
        size="small"
        dataSource={data}
        pagination={false}
        columns={[
          {
            title: "Название",
            dataIndex: nameKey,
            ellipsis: true,
            render: (v) => (isPath ? renderWorkPath(v) : renderProjectName(v)),
          },
          { title: "Активно", dataIndex: "activeFocusedMs", render: formatWorkDuration, width: 105 },
        ]}
        locale={{
          emptyText: (
            <WorkEmptyState
              icon="solar:inbox-bold-duotone"
              title={emptyText || "Нет данных"}
            />
          ),
        }}
      />
    </div>
  );
}

function LiveViewPanel({ clientId, apiUrl }) {
  const canvasRef = React.useRef(null);
  const fullscreenCanvasRef = React.useRef(null);
  const wsRef = React.useRef(null);
  const [status, setStatus] = React.useState("stopped");
  const [hasFrame, setHasFrame] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  const drawFrame = React.useCallback((image) => {
    [canvasRef.current, fullscreenCanvasRef.current].forEach((canvas) => {
      if (!canvas) return;
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(image, 0, 0);
    });
  }, []);

  const openFullscreen = React.useCallback(() => {
    const source = canvasRef.current;
    const target = fullscreenCanvasRef.current;
    if (source && target && source.width && source.height) {
      target.width = source.width;
      target.height = source.height;
      target.getContext("2d")?.drawImage(source, 0, 0);
    }
    setIsFullscreen(true);
  }, []);

  const closeFullscreen = React.useCallback(() => {
    setIsFullscreen(false);
  }, []);

  React.useEffect(() => {
    if (!isFullscreen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeFullscreen();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeFullscreen, isFullscreen]);

  React.useEffect(() => {
    if (!isFullscreen) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const source = canvasRef.current;
      const target = fullscreenCanvasRef.current;
      if (!source || !target || !source.width || !source.height) return;
      target.width = source.width;
      target.height = source.height;
      target.getContext("2d")?.drawImage(source, 0, 0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isFullscreen]);

  const stop = React.useCallback(() => {
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      wsRef.current.close();
    }
    wsRef.current = null;
    setHasFrame(false);
    setIsFullscreen(false);
    setStatus("stopped");
  }, []);

  React.useEffect(() => stop, [stop]);

  const start = React.useCallback(() => {
    stop();
    setHasFrame(false);
    const token = localStorage.getItem("token") || "";
    const base = apiUrl.replace(/\/api$/, "").replace(/^http/, "ws");
    const ws = new WebSocket(`${base}/ws/admin/stream/${encodeURIComponent(clientId)}?token=${encodeURIComponent(token)}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    setStatus("connecting");
    ws.onopen = () => setStatus("live");
    ws.onerror = () => setStatus("error");
    ws.onclose = () => setStatus((prev) => (prev === "error" ? "error" : "stopped"));
    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "stream.error") setStatus("error");
          if (msg.type === "stream.stopped") setStatus("stopped");
        } catch {
          setStatus("error");
        }
        return;
      }
      const blob = new Blob([event.data], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      const image = new window.Image();
      image.onload = () => {
        drawFrame(image);
        setHasFrame(true);
        URL.revokeObjectURL(url);
      };
      image.src = url;
    };
  }, [apiUrl, clientId, drawFrame, stop]);

  const statusLabel = {
    connecting: "Подключение",
    live: "В эфире",
    stopped: "Остановлено",
    error: "Ошибка",
  }[status];
  const statusMeta = {
    connecting: { color: BP.blue, bg: "rgba(34,64,140,0.1)", icon: "solar:refresh-linear" },
    live: { color: BP.green, bg: "rgba(38,126,38,0.1)", icon: "solar:translation-2-bold-duotone" },
    stopped: { color: BP.muted, bg: BP.surface, icon: "solar:stop-circle-bold-duotone" },
    error: { color: BP.red, bg: "rgba(220,38,38,0.09)", icon: "solar:danger-triangle-bold-duotone" },
  }[status];
  const placeholder = {
    connecting: {
      title: "Подключаюсь к экрану клиента",
      text: "Первый кадр появится автоматически.",
      icon: "solar:monitor-smartphone-bold-duotone",
    },
    live: {
      title: "Ожидание кадра",
      text: "Трансляция запущена, но кадр ещё не пришёл.",
      icon: "solar:gallery-wide-bold-duotone",
    },
    stopped: {
      title: "Просмотр экрана остановлен",
      text: "Запустите трансляцию, когда нужно посмотреть экран сотрудника.",
      icon: "solar:monitor-bold-duotone",
    },
    error: {
      title: "Не удалось открыть трансляцию",
      text: "Проверьте, что агент онлайн и просмотр экрана включён в настройках.",
      icon: "solar:danger-triangle-bold-duotone",
    },
  }[status];

  return (
    <div
      className="bp-section-card bp-interactive-card"
      style={{
        borderRadius: 14,
        padding: 14,
        display: "grid",
        gap: 12,
        background: BP.white,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: BP.font, fontSize: 16, fontWeight: 510 }}>Просмотр экрана</div>
          <div style={{ fontFamily: BP.font, fontSize: 13, color: BP.muted, marginTop: 3 }}>
            Просмотр экрана запускается только по команде администратора.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className="bp-status-pill"
            style={{
              color: statusMeta.color,
              background: statusMeta.bg,
            }}
          >
            <Icon
              icon={statusMeta.icon}
              width={14}
              height={14}
              style={status === "connecting" ? { animation: "bp-spin 1s linear infinite" } : undefined}
            />
            {statusLabel}
          </span>
          {status === "live" || status === "connecting" ? (
            <Button className="bp-ghost-action" onClick={stop} icon={<Icon icon="solar:stop-bold" />}>Остановить</Button>
          ) : (
            <Button className="bp-primary-action" type="primary" onClick={start} icon={<Icon icon="solar:play-bold" />}>Запустить</Button>
          )}
          <Button
            className="bp-ghost-action"
            onClick={openFullscreen}
            disabled={!hasFrame}
            icon={<Icon icon="solar:maximize-square-bold" />}
            title="Fullscreen"
          />
        </div>
      </div>
      <div
        style={{
          position: "relative",
          height: hasFrame ? "auto" : 240,
          minHeight: hasFrame ? 220 : 240,
          maxHeight: hasFrame ? 520 : 260,
          background: BP.surface,
          borderRadius: 12,
          overflow: "hidden",
          border: `1px solid ${BP.stroke}`,
          display: "grid",
          placeItems: "center",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: hasFrame ? "auto" : "100%",
            minHeight: hasFrame ? 220 : "100%",
            maxHeight: hasFrame ? 520 : "100%",
            objectFit: "contain",
            display: "block",
          }}
        />
        {!hasFrame && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              padding: 24,
              background: "linear-gradient(180deg, rgba(255,255,255,0.74), rgba(247,247,247,0.94))",
            }}
          >
            <div style={{ textAlign: "center", maxWidth: 360, fontFamily: BP.font }}>
              <span
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 16,
                  display: "inline-grid",
                  placeItems: "center",
                  background: statusMeta.bg,
                  color: statusMeta.color,
                  animation: status === "connecting" ? "bp-live-pulse 1.4s ease infinite" : undefined,
                }}
              >
                <Icon icon={placeholder.icon} width={25} height={25} />
              </span>
              <div style={{ marginTop: 12, color: BP.text, fontSize: 15, fontWeight: 510 }}>
                {placeholder.title}
              </div>
              <div style={{ marginTop: 4, color: BP.muted, fontSize: 13 }}>
                {placeholder.text}
              </div>
            </div>
          </div>
        )}
      </div>
      {isFullscreen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 3000,
            background: "#000",
            display: "grid",
            gridTemplateRows: "auto 1fr",
          }}
        >
          <div
            style={{
              height: 56,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 18px",
              background: "rgba(0,0,0,0.72)",
              color: BP.white,
              fontFamily: BP.font,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <Icon icon="solar:monitor-bold-duotone" width={20} height={20} />
              <span style={{ fontSize: 15, fontWeight: 510, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {clientId}
              </span>
            </div>
            <Button
              type="text"
              onClick={closeFullscreen}
              icon={<Icon icon="solar:minimize-square-bold" width={20} height={20} />}
              style={{ color: BP.white }}
              title="Exit fullscreen"
            />
          </div>
          <div
            onDoubleClick={closeFullscreen}
            style={{
              minHeight: 0,
              display: "grid",
              placeItems: "center",
              padding: 12,
            }}
          >
            <canvas
              ref={fullscreenCanvasRef}
              style={{
                width: "100%",
                height: "100%",
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                display: "block",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function WorkEmptyState({ icon, title, description }) {
  return (
    <div className="bp-empty-state" style={{ fontFamily: BP.font }}>
      <Icon icon={icon} width={24} height={24} color={BP.light} />
      <div style={{ fontSize: 13, color: BP.muted }}>{title}</div>
      {description && <div style={{ fontSize: 12, color: BP.light }}>{description}</div>}
    </div>
  );
}

function renderWorkPath(value) {
  if (!value) return <span style={{ color: BP.light }}>Не указан</span>;
  return (
    <span className="bp-path-text" title={value} style={{ display: "block", color: BP.text }}>
      {value}
    </span>
  );
}

function renderProjectName(value) {
  if (!value || value === "unknown/external") {
    return (
      <span className="bp-status-pill" style={{ background: BP.surface, color: BP.muted }}>
        Внешний / неизвестный
      </span>
    );
  }
  return <span style={{ fontWeight: 510 }}>{value}</span>;
}

function renderWorkApp(value) {
  if (!value) return <span style={{ color: BP.light }}>Неизвестно</span>;
  return (
    <span className="bp-status-pill" style={{ background: "rgba(34,64,140,0.08)", color: BP.blue }}>
      {value}
    </span>
  );
}

function renderConfidence(value) {
  const normalized = String(value || "low").toLowerCase();
  const map = {
    high: { label: "Высокая", color: BP.green, bg: "rgba(38,126,38,0.1)" },
    medium: { label: "Средняя", color: "#B45309", bg: "rgba(245,158,11,0.13)" },
    low: { label: "Низкая", color: BP.muted, bg: BP.surface },
  };
  const item = map[normalized] || map.low;
  return (
    <span className="bp-status-pill" style={{ color: item.color, background: item.bg }}>
      {item.label}
    </span>
  );
}

function renderEndReason(value) {
  const map = {
    timeout: "Таймаут",
    app_closed: "Приложение закрыто",
    process_exit: "Процесс завершён",
    switched: "Переключение",
    manual: "Вручную",
  };
  return <span style={{ color: BP.muted }}>{map[value] || value || "—"}</span>;
}

function formatWorkDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${h}ч ${m}м`;
}

function fmtWorkDateTime(value) {
  if (!value) return "—";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("DD.MM HH:mm") : "—";
}

function AppsTab({ clientId, t, i18n }) {
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;

  const [items, setItems] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const [browserHistoryOpen, setBrowserHistoryOpen] = React.useState(false);
  const [browserEvents, setBrowserEvents] = React.useState([]);
  const [browserLoading, setBrowserLoading] = React.useState(false);
  const pageSize = 50;

  React.useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      clientId,
    });
    authFetch(`${API_URL}/events?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!json) return;
        const raw = json.data || [];
        const data = raw.filter(
          (e) =>
            e.eventType !== "NetworkConnection" &&
            e.eventType !== "NetworkDisconnection",
        );
        setItems(data);
        setTotal(json.total || 0);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [API_URL, clientId, page]);

  const loadBrowserHistory = React.useCallback(async () => {
    setBrowserLoading(true);
    try {
      const params = new URLSearchParams({
        page: "1",
        pageSize: "1000",
        clientId,
      });
      const res = await authFetch(`${API_URL}/events?${params.toString()}`);
      const json = await res.json();
      const allEvents = json.data || [];
      const browserNames = new Set([
        "browser",
        "chrome",
        "msedge",
        "firefox",
        "opera",
        "opera_gx",
      ]);
      const history = allEvents.filter((e) => {
        if (e.eventType !== "AppUsage") return false;
        const name = (e.processName || "").toLowerCase();
        return browserNames.has(name);
      });
      setBrowserEvents(history);
    } catch (e) {
      console.error(e);
    } finally {
      setBrowserLoading(false);
    }
  }, [API_URL, clientId]);

  React.useEffect(() => {
    if (browserHistoryOpen) loadBrowserHistory();
  }, [browserHistoryOpen, loadBrowserHistory]);

  const translateDriveType = (type) => {
    if (!type) return "";
    const key = type.toLowerCase();
    if (key === "removable") return t("common.removable");
    if (key === "fixed") return t("common.fixed");
    if (key === "cdrom") return t("common.cdrom");
    if (key === "network") return t("common.networkDrive");
    if (key === "ram") return t("common.ram");
    return type;
  };

  // Collapse consecutive duplicates of the same (eventType, description, processName).
  // Each row gets `count`, `firstTimestamp`, `lastTimestamp`.
  const grouped = React.useMemo(() => {
    if (!items.length) return [];
    const out = [];
    let cur = null;
    for (const it of items) {
      const key = `${it.eventType}|${it.description || ""}|${it.processName || ""}|${JSON.stringify(it.additionalData || null)}`;
      if (cur && cur._key === key) {
        cur.count += 1;
        cur.lastTimestamp = it.timestamp;
      } else {
        if (cur) out.push(cur);
        cur = {
          ...it,
          _key: key,
          count: 1,
          firstTimestamp: it.timestamp,
          lastTimestamp: it.timestamp,
        };
      }
    }
    if (cur) out.push(cur);
    return out;
  }, [items]);

  const eventVisual = (eventType) => {
    switch (eventType) {
      case "AppUsage":
        return { icon: "solar:window-frame-bold-duotone", color: "#2563eb", label: "Приложение" };
      case "ProcessStarted":
        return { icon: "solar:play-circle-bold-duotone", color: "#16a34a", label: "Запуск" };
      case "ProcessStopped":
        return { icon: "solar:stop-circle-bold-duotone", color: "#64748b", label: "Остановка" };
      case "USBConnected":
        return { icon: "solar:usb-bold-duotone", color: "#f97316", label: "USB" };
      case "USBDisconnected":
        return { icon: "solar:usb-bold-duotone", color: "#94a3b8", label: "USB откл." };
      case "FileAccess":
        return { icon: "solar:document-text-bold-duotone", color: "#a855f7", label: "Файл" };
      case "PolicyViolation":
        return { icon: "solar:shield-warning-bold-duotone", color: "#dc2626", label: "Нарушение" };
      case "SystemError":
        return { icon: "solar:danger-triangle-bold-duotone", color: "#dc2626", label: "Ошибка" };
      default:
        return { icon: "solar:bell-bold-duotone", color: "#64748b", label: eventType || "—" };
    }
  };

  const cleanDescription = (text) => {
    if (!text) return "";
    return String(text)
      .replace(/^User opened:\s*/i, "")
      .replace(/^User launched:\s*/i, "")
      .replace(/^Process started:\s*/i, "");
  };

  return (
    <>
      <div
        style={{
          background: BP.white,
          border: `1px solid ${BP.stroke}`,
          borderRadius: 30,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 28px",
          }}
        >
          <div
            style={{
              fontFamily: BP.font,
              fontSize: 20,
              fontWeight: 510,
              color: BP.text,
            }}
          >
            События
          </div>
          <button
            type="button"
            onClick={() => setBrowserHistoryOpen(true)}
            style={{
              background: BP.surface,
              border: "none",
              borderRadius: 30,
              padding: "8px 16px",
              cursor: "pointer",
              fontFamily: BP.font,
              fontSize: 14,
              color: BP.muted,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Icon
              icon="solar:global-bold-duotone"
              width={16}
              height={16}
            />
            {t("common.browserHistory")}
          </button>
        </div>
        <div
          style={{
            height: 1,
            background: BP.stroke,
            opacity: 0.5,
          }}
        />
        <Table
          rowKey={(r) => r._key || r.id || `${r.timestamp}_${r.eventType}`}
          dataSource={grouped}
          loading={loading}
          size="small"
          scroll={{ y: 480 }}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p) => setPage(p),
            showSizeChanger: false,
            size: "small",
          }}
          columns={[
            {
              title: t("common.time"),
              dataIndex: "firstTimestamp",
              width: 95,
              render: (v, r) => (
                <div style={{ fontSize: 12, lineHeight: 1.2 }}>
                  <div style={{ fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                    {formatTashkent(v, "HH:mm:ss")}
                  </div>
                  <div style={{ color: BP.muted, fontSize: 10 }}>
                    {formatTashkent(v, "DD.MM")}
                  </div>
                </div>
              ),
            },
            {
              title: t("common.type"),
              dataIndex: "eventType",
              width: 140,
              render: (et) => {
                const v = eventVisual(et);
                return (
                  <span
                    title={et}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 8px 2px 6px",
                      borderRadius: 12,
                      background: v.color + "1A",
                      color: v.color,
                      fontSize: 11,
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      maxWidth: "100%",
                    }}
                  >
                    <Icon icon={v.icon} width={13} height={13} color={v.color} />
                    {v.label}
                  </span>
                );
              },
            },
            {
              title: t("common.description"),
              dataIndex: "description",
              width: 360,
              ellipsis: true,
              render: (text, record) => {
                if (record.eventType === "USBConnected" && record.additionalData) {
                  const { Label, Format, TotalSize, DriveType } = record.additionalData;
                  return (
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {t("common.usbConnected")}: {record.deviceId}
                      </div>
                      <div style={{ fontSize: 12, color: BP.muted }}>
                        {[Label, Format, TotalSize, translateDriveType(DriveType)]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  );
                }
                if (record.eventType === "USBDisconnected") {
                  return (
                    <div style={{ fontWeight: 600 }}>
                      {t("common.usbDisconnected")}: {record.deviceId}
                    </div>
                  );
                }
                if (record.eventType === "FileAccess" && record.additionalData) {
                  const { Action, Path, Drive } = record.additionalData;
                  if (Drive) {
                    return (
                      <div>
                        <div style={{ fontWeight: 600 }}>
                          {Action === "Created"
                            ? t("common.fileCopiedToUsb")
                            : Action === "Renamed"
                              ? t("common.fileRenamedOnUsb")
                              : cleanDescription(text)}
                        </div>
                        <div style={{ fontSize: 12, color: BP.muted }}>
                          {t("common.drive")}: {Drive} · {t("common.path")}: {Path}
                        </div>
                      </div>
                    );
                  }
                }
                const clean = cleanDescription(text);
                return (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                        minWidth: 0,
                      }}
                      title={clean || "—"}
                    >
                      {clean || "—"}
                    </div>
                    {record.count > 1 && (
                      <span
                        style={{
                          background: "#eff6ff",
                          color: "#2563eb",
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "1px 6px",
                          borderRadius: 8,
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                        title={`Повторялось ${record.count} раз подряд`}
                      >
                        ×{record.count}
                      </span>
                    )}
                  </div>
                );
              },
            },
            {
              title: t("common.process"),
              dataIndex: "processName",
              width: 130,
              render: (n) => (
                <span style={{ color: BP.muted, fontSize: 12 }}>
                  {n === "browser" ? "Yandex" : n || "—"}
                </span>
              ),
            },
          ]}
          locale={{ emptyText: t("common.noData") }}
        />
      </div>

      {/* Browser history modal */}
      <Modal
        title={`${t("common.browserHistory")}: ${clientId}`}
        open={browserHistoryOpen}
        onCancel={() => setBrowserHistoryOpen(false)}
        width={800}
        footer={null}
      >
        <Table
          loading={browserLoading}
          dataSource={browserEvents}
          rowKey="id"
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: t("common.time"),
              dataIndex: "timestamp",
              width: 180,
              render: (v) => formatTashkent(v),
            },
            {
              title: t("common.browser"),
              dataIndex: "processName",
              width: 120,
              render: (n) => (n === "browser" ? "Yandex" : n || "—"),
            },
            {
              title: t("common.titleUrl"),
              dataIndex: "additionalData",
              render: (data) => {
                const title = data?.WindowTitle || "—";
                const url = data?.Url;
                return (
                  <div>
                    <div style={{ fontWeight: 510 }}>{title}</div>
                    {url && (
                      <div style={{ fontSize: 12, color: "#1890ff" }}>
                        <a
                          href={url.startsWith("http") ? url : `https://${url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {url}
                        </a>
                      </div>
                    )}
                  </div>
                );
              },
            },
          ]}
        />
      </Modal>
    </>
  );
}

function formatFileSize(bytes) {
  if (typeof bytes !== "number" || isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FilesTab({ clientId, t, i18n }) {
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;

  const [driveOptions, setDriveOptions] = React.useState([]);
  const [drivesLoading, setDrivesLoading] = React.useState(true);
  const [drivesError, setDrivesError] = React.useState(null);
  const [rootPath, setRootPath] = React.useState("");
  const [currentPath, setCurrentPath] = React.useState("");
  const [dirItems, setDirItems] = React.useState([]);
  const [dirLoading, setDirLoading] = React.useState(false);
  const [dirError, setDirError] = React.useState(null);
  const [retryTrigger, setRetryTrigger] = React.useState(0);
  const [downloadStates, setDownloadStates] = React.useState({});
  const cancelRefs = React.useRef(new Set());

  // Probe drives — parallel, validate via fullPath prefix
  React.useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    // The C# client falls back to %LOCALAPPDATA%\BelfProctor for invalid paths,
    // so a 200 response is NOT proof of existence. We must verify that returned
    // items' fullPath actually start with the requested drive letter.
    const probeLetter = async (letter) => {
      const basePath = `${letter}:\\`;
      const expectedPrefix = `${letter.toLowerCase()}:`;
      try {
        const res = await authFetch(`${API_URL}/commands/list`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            basePath,
            pattern: "*",
            recursive: false,
            // Need more entries because we filter by attributes — root of a
            // real drive sometimes has only hidden/system files in the first few.
            maxEntries: 30,
            includeDirs: true,
          }),
        });
        if (!res.ok) {
          if (res.status === 404) {
            try {
              const j = await res.json();
              if (j?.message === "client not connected")
                return { offline: true };
            } catch {
              /* ignore */
            }
          }
          return null;
        }
        const json = await res.json();
        const id = json.id;
        if (!id) return null;
        // Poll up to 8 seconds
        for (let i = 0; i < 16; i++) {
          if (cancelled) return null;
          await new Promise((r) => setTimeout(r, 500));
          const r2 = await authFetch(`${API_URL}/commands/${id}/json`);
          if (r2.status === 404) continue;
          if (!r2.ok) return null;
          const j2 = await r2.json();
          const files = Array.isArray(j2.files) ? j2.files : [];
          const dirs = Array.isArray(j2.directories) ? j2.directories : [];
          if (files.length === 0 && dirs.length === 0) {
            // Either fallback to empty BelfProctor OR truly empty real drive.
            // We can't tell — treat as not-exists. False negatives only on
            // truly empty drives, which is rare in practice.
            return null;
          }
          // Verify: first item's fullPath must start with the requested letter.
          // C# uses backslashes — match `X:` prefix case-insensitively.
          const first =
            (files[0] && files[0].fullPath) ||
            (dirs[0] && dirs[0].fullPath) ||
            "";
          const fp = String(first).toLowerCase();
          if (fp.startsWith(expectedPrefix)) {
            return { path: basePath };
          }
          // Mismatch → C# resolved to fallback path (e.g. C:\Users\...\BelfProctor).
          // Drive doesn't exist on the client.
          return null;
        }
        return null;
      } catch {
        return null;
      }
    };

    const probe = async () => {
      setDrivesLoading(true);
      setDrivesError(null);

      const letters = Array.from({ length: 26 }, (_, i) =>
        String.fromCharCode(65 + i),
      );

      // First probe C:\ to detect offline clients without firing 26 failed
      // commands. If the agent is online, scan the rest in parallel.
      const first = await probeLetter("C");
      if (cancelled) return;
      if (first && first.offline) {
        setDrivesError(t("common.clientOffline"));
        setDriveOptions([]);
        setRootPath("");
        setCurrentPath("");
        setDrivesLoading(false);
        return;
      }

      const remainingLetters = letters.filter((l) => l !== "C");
      const remainingResults = await Promise.all(
        remainingLetters.map((l) => probeLetter(l)),
      );
      if (cancelled) return;

      const found = [];
      if (first && first.path) found.push("C:\\");
      remainingResults.forEach((r, idx) => {
        if (r && r.path) found.push(`${remainingLetters[idx]}:\\`);
      });

      setDriveOptions(found);
      setRootPath(found[0] || "");
      setCurrentPath(found[0] || "");
      setDrivesLoading(false);
      if (!found.length) {
        setDrivesError(t("common.noFiles"));
      }
    };

    probe();
    return () => {
      cancelled = true;
    };
  }, [API_URL, clientId, retryTrigger, t]);

  // Fetch directory contents
  React.useEffect(() => {
    if (!currentPath || !clientId) return;
    let cancelled = false;
    const fetchDir = async () => {
      setDirLoading(true);
      setDirError(null);
      try {
        const res = await authFetch(`${API_URL}/commands/list`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            basePath: currentPath,
            pattern: "*",
            recursive: false,
            maxEntries: 1000,
            includeDirs: true,
          }),
        });
        if (!res.ok) {
          let errMsg = `${t("common.requestError")}: ${res.status}`;
          try {
            const errJson = await res.json();
            if (
              res.status === 404 &&
              errJson.message === "client not connected"
            ) {
              errMsg = t("common.clientOffline");
            } else if (errJson.message) {
              errMsg = errJson.message;
            }
          } catch {
            /* ignore */
          }
          throw new Error(errMsg);
        }
        const json = await res.json();
        const cmdId = json.id;
        if (!cmdId) throw new Error(t("common.serverNoId"));

        let items = [];
        let success = false;
        for (let i = 0; i < 30; i++) {
          if (cancelled) return;
          await new Promise((r) => setTimeout(r, 1000));
          const r2 = await authFetch(`${API_URL}/commands/${cmdId}/json`);
          if (r2.status === 404) continue;
          if (r2.ok) {
            const j2 = await r2.json();
            const files = Array.isArray(j2.files) ? j2.files : [];
            const dirs = Array.isArray(j2.directories) ? j2.directories : [];
            items = [
              ...dirs.map((d) => ({ ...d, isDir: true, key: d.fullPath })),
              ...files.map((f) => ({ ...f, isDir: false, key: f.fullPath })),
            ];
            items.sort((a, b) => {
              if (a.isDir === b.isDir) return a.name.localeCompare(b.name);
              return a.isDir ? -1 : 1;
            });
            success = true;
            break;
          } else {
            throw new Error(`${t("common.resultError")}: ${r2.status}`);
          }
        }
        if (!success) throw new Error(t("common.timeout30s"));
        if (!cancelled) setDirItems(items);
      } catch (e) {
        console.error(e);
        if (!cancelled) setDirError(e.message || t("common.unknownError"));
      } finally {
        if (!cancelled) setDirLoading(false);
      }
    };
    fetchDir();
    return () => {
      cancelled = true;
    };
  }, [currentPath, API_URL, clientId, retryTrigger, t]);

  // Download polling
  React.useEffect(() => {
    const interval = setInterval(async () => {
      const pendingPaths = Object.keys(downloadStates);
      if (!pendingPaths.length) return;
      for (const dpath of pendingPaths) {
        const state = downloadStates[dpath];
        if (state.status !== "polling" || !state.cmdId) continue;
        if (cancelRefs.current.has(dpath)) {
          setDownloadStates((prev) => {
            const next = { ...prev };
            delete next[dpath];
            return next;
          });
          cancelRefs.current.delete(dpath);
          continue;
        }
        setDownloadStates((prev) => {
          if (!prev[dpath]) return prev;
          const current = prev[dpath].progress || 0;
          let next = current;
          if (current < 30) next += 5;
          else if (current < 70) next += 2;
          else if (current < 95) next += 0.5;
          return {
            ...prev,
            [dpath]: { ...prev[dpath], progress: Math.min(99, next) },
          };
        });
        try {
          const res = await authFetch(
            `${API_URL}/commands/${state.cmdId}/file/latest`,
          );
          if (res.ok && res.status === 200) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = state.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            setDownloadStates((prev) => {
              const next = { ...prev };
              delete next[dpath];
              return next;
            });
          } else if (res.status === 404) {
            setDownloadStates((prev) => {
              const next = { ...prev };
              delete next[dpath];
              return next;
            });
            message.error(`${t("common.requestError")} (404)`);
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [downloadStates, API_URL, t]);

  const handleDownload = async (record) => {
    const dpath = record.fullPath;
    if (downloadStates[dpath]) return;
    cancelRefs.current.delete(dpath);
    setDownloadStates((prev) => ({
      ...prev,
      [dpath]: { status: "init", progress: 0 },
    }));
    const isFolder = record.isDir;
    const endpoint = isFolder
      ? `${API_URL}/commands/folder`
      : `${API_URL}/commands/file`;
    try {
      const res = await authFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          path: record.fullPath,
        }),
      });
      if (!res.ok) throw new Error("Failed to send command");
      const { id: cmdId } = await res.json();
      const targetFilename = isFolder ? `${record.name}.zip` : record.name;
      setDownloadStates((prev) => ({
        ...prev,
        [dpath]: {
          status: "polling",
          cmdId,
          filename: targetFilename,
          progress: 5,
        },
      }));
    } catch (e) {
      console.error(e);
      message.error(t("common.requestError"));
      setDownloadStates((prev) => {
        const next = { ...prev };
        delete next[dpath];
        return next;
      });
    }
  };

  const handleCancelDownload = (dpath) => {
    cancelRefs.current.add(dpath);
    setDownloadStates((prev) => {
      const next = { ...prev };
      delete next[dpath];
      return next;
    });
  };

  // Breadcrumbs
  const breadcrumbs = React.useMemo(() => {
    if (!currentPath) return [];
    const normalized = currentPath.replace(/\\/g, "/");
    const parts = normalized.split("/").filter((p) => p);
    return parts.map((part, index) => {
      const pathParts = parts.slice(0, index + 1);
      let pp = pathParts.join("\\");
      if (pathParts.length === 1 && pp.includes(":")) pp += "\\";
      return { title: part, path: pp };
    });
  }, [currentPath]);
  const commandOffline =
    !drivesLoading &&
    driveOptions.length === 0 &&
    drivesError === t("common.clientOffline");
  const noDrives =
    !drivesLoading && driveOptions.length === 0 && !commandOffline;

  return (
    <div
      style={{
        background: BP.white,
        border: `1px solid ${BP.stroke}`,
        borderRadius: 30,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 28px",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            fontFamily: BP.font,
            fontSize: 20,
            fontWeight: 510,
            color: BP.text,
          }}
        >
          {t("common.clientFiles")}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: BP.muted, fontFamily: BP.font, fontSize: 14 }}>
            {t("common.disk")}:
          </span>
          {drivesLoading ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: BP.surface,
                borderRadius: 10,
                padding: "8px 14px",
                color: BP.muted,
                fontFamily: BP.font,
                fontSize: 14,
                minWidth: 140,
              }}
            >
              <Icon
                icon="solar:refresh-linear"
                width={14}
                height={14}
                style={{ animation: "bp-spin 1s linear infinite" }}
              />
              Поиск дисков...
            </div>
          ) : driveOptions.length === 0 ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: commandOffline ? BP.surface : "rgba(245,158,11,0.12)",
                borderRadius: 10,
                padding: "8px 14px",
                color: commandOffline ? BP.muted : "#B45309",
                fontFamily: BP.font,
                fontSize: 14,
                minWidth: 140,
              }}
            >
              <Icon
                icon={commandOffline ? "solar:cloud-cross-bold-duotone" : "solar:danger-triangle-bold-duotone"}
                width={15}
                height={15}
              />
              {commandOffline ? "Клиент оффлайн" : drivesError || "Нет доступных дисков"}
            </div>
          ) : (
            <select
              value={rootPath}
              onChange={(e) => {
                setRootPath(e.target.value);
                setCurrentPath(e.target.value);
              }}
              style={{
                background: BP.surface,
                border: "none",
                borderRadius: 10,
                padding: "8px 14px",
                fontFamily: BP.font,
                fontSize: 14,
                color: BP.text,
                cursor: "pointer",
                minWidth: 140,
              }}
            >
              {driveOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
          {!drivesLoading && (
            <button
              type="button"
              onClick={() => setRetryTrigger((p) => p + 1)}
              title={t("common.refresh")}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 4,
                display: "flex",
                alignItems: "center",
              }}
            >
              <Icon
                icon="solar:refresh-linear"
                width={16}
                height={16}
                color={BP.muted}
              />
            </button>
          )}
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

      {/* Breadcrumbs */}
      <div
        style={{
          display: commandOffline || noDrives ? "none" : "flex",
          alignItems: "center",
          gap: 6,
          padding: "12px 28px",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => setCurrentPath(rootPath)}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 4,
            display: "flex",
            alignItems: "center",
          }}
        >
          <Icon
            icon="solar:home-bold-duotone"
            width={18}
            height={18}
            color={BP.text}
          />
        </button>
        {breadcrumbs.map((item, idx) => (
          <React.Fragment key={item.path}>
            <Icon
              icon="solar:alt-arrow-right-linear"
              width={14}
              height={14}
              color={BP.light}
            />
            <button
              type="button"
              onClick={() => setCurrentPath(item.path)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "2px 6px",
                fontFamily: BP.font,
                fontSize: 14,
                color: idx === breadcrumbs.length - 1 ? BP.text : BP.muted,
                fontWeight: idx === breadcrumbs.length - 1 ? 510 : 400,
              }}
            >
              {item.title}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* Divider */}
      <div
        style={{
          display: commandOffline || noDrives ? "none" : "block",
          height: 1,
          background: BP.stroke,
          opacity: 0.5,
        }}
      />

      {/* Error / Content */}
      {commandOffline ? (
        <FileManagerState
          icon="solar:cloud-cross-bold-duotone"
          title="Клиент оффлайн"
          description="Файловый менеджер будет доступен, когда агент подключится к командному каналу."
          action={
            <Button
              size="small"
              onClick={() => setRetryTrigger((p) => p + 1)}
              icon={<Icon icon="solar:refresh-linear" width={14} height={14} />}
              style={{ borderRadius: 30 }}
            >
              Проверить снова
            </Button>
          }
        />
      ) : noDrives ? (
        <FileManagerState
          icon="solar:folder-error-bold-duotone"
          title="Диски не найдены"
          description="Агент ответил, но доступных дисков для просмотра сейчас нет."
          action={
            <Button
              size="small"
              onClick={() => setRetryTrigger((p) => p + 1)}
              icon={<Icon icon="solar:refresh-linear" width={14} height={14} />}
              style={{ borderRadius: 30 }}
            >
              Обновить
            </Button>
          }
        />
      ) : dirError ? (
        <div
          style={{
            margin: 20,
            padding: "12px 16px",
            background: "rgba(220,38,38,0.08)",
            borderRadius: 10,
            color: BP.red,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span style={{ fontFamily: BP.font, fontSize: 14 }}>
            {t("common.dirLoadError")}: <strong>{dirError}</strong>
          </span>
          <Button
            size="small"
            danger
            onClick={() => setRetryTrigger((p) => p + 1)}
            style={{ borderRadius: 30 }}
          >
            {t("common.retry")}
          </Button>
        </div>
      ) : (
        <Table
          dataSource={dirItems}
          loading={dirLoading}
          pagination={false}
          size="middle"
          rowKey="key"
          scroll={{ y: 500 }}
          onRow={(record) => ({
            onClick: () => {
              if (record.isDir) setCurrentPath(record.fullPath);
            },
            style: { cursor: record.isDir ? "pointer" : "default" },
          })}
          locale={{ emptyText: t("common.noFiles") }}
          columns={[
            {
              title: t("common.name"),
              dataIndex: "name",
              key: "name",
              render: (text, record) => (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <Icon
                    icon={
                      record.isDir
                        ? "solar:folder-bold-duotone"
                        : "solar:document-text-bold-duotone"
                    }
                    width={22}
                    height={22}
                    color={record.isDir ? BP.blue : BP.muted}
                  />
                  <span
                    style={{
                      fontFamily: BP.font,
                      fontSize: 14,
                      color: record.isDir ? BP.text : BP.text,
                      fontWeight: record.isDir ? 510 : 400,
                    }}
                  >
                    {text}
                  </span>
                </div>
              ),
            },
            {
              title: t("common.size"),
              dataIndex: "length",
              key: "length",
              width: 120,
              render: (val, record) => {
                if (record.isDir) return "—";
                return formatFileSize(val);
              },
            },
            {
              title: t("common.lastModified"),
              dataIndex: "lastWriteTime",
              key: "lastWriteTime",
              width: 200,
              render: (val) => {
                if (!val) return "—";
                return formatTashkent(val);
              },
            },
            {
              title: t("common.actions"),
              key: "actions",
              width: 160,
              align: "right",
              render: (_, record) => {
                const state = downloadStates[record.fullPath];
                if (state) {
                  return (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        justifyContent: "flex-end",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          color: BP.muted,
                          fontFamily: BP.font,
                        }}
                      >
                        {Math.floor(state.progress)}%
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancelDownload(record.fullPath);
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          padding: 4,
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        <Icon
                          icon="solar:close-circle-linear"
                          width={20}
                          height={20}
                          color={BP.red}
                        />
                      </button>
                    </div>
                  );
                }
                return (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(record);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: 4,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      color: BP.muted,
                      fontFamily: BP.font,
                      fontSize: 13,
                    }}
                  >
                    <Icon
                      icon="solar:file-download-linear"
                      width={18}
                      height={18}
                    />
                  </button>
                );
              },
            },
          ]}
        />
      )}
    </div>
  );
}

function FileManagerState({ icon, title, description, action }) {
  return (
    <div style={{ padding: 20 }}>
      <div
        className="bp-empty-state"
        style={{
          minHeight: 220,
          fontFamily: BP.font,
          borderStyle: "solid",
        }}
      >
        <span
          style={{
            width: 52,
            height: 52,
            borderRadius: 18,
            background: BP.surface,
            color: BP.muted,
            display: "inline-grid",
            placeItems: "center",
          }}
        >
          <Icon icon={icon} width={28} height={28} />
        </span>
        <div style={{ color: BP.text, fontSize: 16, fontWeight: 510 }}>
          {title}
        </div>
        <div style={{ color: BP.muted, fontSize: 13, maxWidth: 420 }}>
          {description}
        </div>
        {action && <div style={{ marginTop: 8 }}>{action}</div>}
      </div>
    </div>
  );
}

export default ClientDetail;
