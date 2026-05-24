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
                      `/screenshots?clientId=${encodeURIComponent(id)}`,
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
  // Show max 10 (2 rows of 5)
  const shown = screenshots.slice(0, 10);
  // Split into chunks of 5
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
                {new Date(s.timestamp).toLocaleTimeString(
                  i18n.language === "uz" ? "uz-UZ" : "ru-RU",
                  { hour: "2-digit", minute: "2-digit" },
                )}
              </div>
            </div>
          ))}
          {row.length < 5 &&
            Array.from({ length: 5 - row.length }).map((_, i) => (
              <div key={`empty-${i}`} style={{ flex: 1 }} />
            ))}
        </div>
      ))}
      {screenshots.length > 10 && (
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
        <ThumbnailGrid
          screenshots={dailyData.screenshots}
          getImageUrl={getImageUrl}
          imageFallback={imageFallback}
          toggleFavorite={toggleFavorite}
          onOpenAllScreenshots={onOpenAllScreenshots}
          i18n={i18n}
        />
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
          rowKey={(r) => r.id || `${r.timestamp}_${r.eventType}`}
          dataSource={items}
          loading={loading}
          size="middle"
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p) => setPage(p),
            showSizeChanger: false,
          }}
          columns={[
            {
              title: t("common.time"),
              dataIndex: "timestamp",
              width: 160,
              render: (v) => {
                if (!v) return "—";
                try {
                  const d = new Date(v);
                  if (isNaN(d.getTime())) return "—";
                  d.setHours(d.getHours() - 2);
                  return d.toLocaleString(
                    i18n.language === "uz" ? "uz-UZ" : "ru-RU",
                    {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    },
                  );
                } catch {
                  return "—";
                }
              },
            },
            { title: t("common.type"), dataIndex: "eventType", width: 140 },
            {
              title: t("common.description"),
              dataIndex: "description",
              render: (text, record) => {
                if (
                  record.eventType === "USBConnected" &&
                  record.additionalData
                ) {
                  const { Label, Format, TotalSize, DriveType } =
                    record.additionalData;
                  return (
                    <div>
                      <div style={{ fontWeight: 510 }}>
                        {t("common.usbConnected")}: {record.deviceId}
                      </div>
                      <div
                        style={{ fontSize: 12, color: BP.muted }}
                      >
                        {[Label, Format, TotalSize, translateDriveType(DriveType)]
                          .filter(Boolean)
                          .join(" | ")}
                      </div>
                    </div>
                  );
                }
                if (record.eventType === "USBDisconnected") {
                  return (
                    <div style={{ fontWeight: 510 }}>
                      {t("common.usbDisconnected")}: {record.deviceId}
                    </div>
                  );
                }
                if (record.eventType === "FileAccess" && record.additionalData) {
                  const { Action, Path, Drive } = record.additionalData;
                  if (Drive) {
                    return (
                      <div>
                        <div style={{ fontWeight: 510 }}>
                          {Action === "Created"
                            ? t("common.fileCopiedToUsb")
                            : Action === "Renamed"
                              ? t("common.fileRenamedOnUsb")
                              : text}
                        </div>
                        <div style={{ fontSize: 12, color: BP.muted }}>
                          <div>
                            {t("common.drive")}: {Drive}
                          </div>
                          <div>
                            {t("common.path")}: {Path}
                          </div>
                        </div>
                      </div>
                    );
                  }
                }
                return text;
              },
            },
            {
              title: t("common.process"),
              dataIndex: "processName",
              width: 120,
              render: (n) => (n === "browser" ? "Yandex" : n || "—"),
            },
            { title: t("common.device"), dataIndex: "deviceId", width: 140 },
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
              render: (v) => {
                if (!v) return "—";
                try {
                  const d = new Date(v);
                  if (isNaN(d.getTime())) return "—";
                  d.setHours(d.getHours() - 2);
                  return d.toLocaleString(
                    i18n.language === "uz" ? "uz-UZ" : "ru-RU",
                  );
                } catch {
                  return "—";
                }
              },
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

      // Probe all 26 letters in parallel.
      const letters = Array.from({ length: 26 }, (_, i) =>
        String.fromCharCode(65 + i),
      );
      const results = await Promise.all(letters.map((l) => probeLetter(l)));
      if (cancelled) return;

      // Offline detection — if ALL results say offline, client is offline.
      const offline = results.every((r) => r && r.offline);
      if (offline) {
        setDrivesError(t("common.clientOffline"));
        setDriveOptions([]);
        setRootPath("");
        setCurrentPath("");
        setDrivesLoading(false);
        return;
      }

      const found = [];
      results.forEach((r, idx) => {
        if (r && r.path) found.push(`${letters[idx]}:\\`);
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
                background: "rgba(220,38,38,0.08)",
                borderRadius: 10,
                padding: "8px 14px",
                color: BP.red,
                fontFamily: BP.font,
                fontSize: 14,
                minWidth: 140,
              }}
            >
              {drivesError || "Нет доступных дисков"}
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
          display: "flex",
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
          height: 1,
          background: BP.stroke,
          opacity: 0.5,
        }}
      />

      {/* Error / Content */}
      {dirError ? (
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
                try {
                  const d = new Date(val);
                  if (isNaN(d.getTime())) return "—";
                  return d.toLocaleString(
                    i18n.language === "uz" ? "uz-UZ" : "ru-RU",
                  );
                } catch {
                  return "—";
                }
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

export default ClientDetail;
