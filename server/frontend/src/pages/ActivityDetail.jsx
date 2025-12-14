import React from "react";
import { List } from "@refinedev/antd";
import {
  Button,
  Segmented,
  Select,
  Breadcrumb,
  Table,
  message,
  Progress,
} from "antd";
import {
  FolderFilled,
  FileTextOutlined,
  DownloadOutlined,
  HomeOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { authFetch } from "../dataProvider.js";
import { useParams } from "react-router-dom";
import ApexCharts from "apexcharts";
import _ from "lodash";
import "flyonui/dist/helper-apexcharts.js";

export default function ActivityDetail() {
  const { t, i18n } = useTranslation();
  const { clientId } = useParams();
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;
  const [activity, setActivity] = React.useState([]);
  const [shots, setShots] = React.useState([]);
  const chartRef = React.useRef(null);
  const [chartElId] = React.useState(
    () => `chart_${Math.random().toString(36).slice(2)}`
  );
  const inactChartRef = React.useRef(null);
  const [chartElIdInactive] = React.useState(
    () => `chart_inact_${Math.random().toString(36).slice(2)}`
  );
  const [currentPath, setCurrentPath] = React.useState("");
  const [dirItems, setDirItems] = React.useState([]);
  const [dirLoading, setDirLoading] = React.useState(false);
  const [dirError, setDirError] = React.useState(null);
  const [retryTrigger, setRetryTrigger] = React.useState(0);
  const [range, setRange] = React.useState("7d");
  const [authToken, setAuthToken] = React.useState(
    () => localStorage.getItem("token") || ""
  );
  const [imgTs, setImgTs] = React.useState(() => Date.now());
  const [driveOptions, setDriveOptions] = React.useState([]);
  const [rootPath, setRootPath] = React.useState("%SYSTEMDRIVE%\\");
  const [downloadStates, setDownloadStates] = React.useState(() => {
    try {
      const saved = localStorage.getItem("belf_downloads");
      const parsed = saved ? JSON.parse(saved) : {};
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  });
  const cancelRefs = React.useRef(new Set());

  const headersAuth = React.useMemo(() => {
    return authToken ? { Authorization: `Bearer ${authToken}` } : {};
  }, [authToken]);

  // Persist download states
  React.useEffect(() => {
    localStorage.setItem("belf_downloads", JSON.stringify(downloadStates));
  }, [downloadStates]);

  // Polling effect for downloads
  React.useEffect(() => {
    const interval = setInterval(async () => {
      const pendingPaths = Object.keys(downloadStates);
      if (!pendingPaths.length) return;

      for (const path of pendingPaths) {
        const state = downloadStates[path];
        // Skip if not polling or no cmdId
        if (state.status !== "polling" || !state.cmdId) continue;

        // Check if cancelled
        if (cancelRefs.current.has(path)) {
          setDownloadStates((prev) => {
            const next = { ...prev };
            delete next[path];
            return next;
          });
          cancelRefs.current.delete(path);
          continue;
        }

        // Simulate progress
        setDownloadStates((prev) => {
          if (!prev[path]) return prev;
          const current = prev[path].progress || 0;
          let next = current;
          if (current < 30) next += 5;
          else if (current < 70) next += 2;
          else if (current < 95) next += 0.5;
          return {
            ...prev,
            [path]: { ...prev[path], progress: Math.min(99, next) },
          };
        });

        try {
          const res = await authFetch(
            `${API_URL}/commands/${state.cmdId}/file/latest`
          );
          if (res.ok && res.status === 200) {
            // Download ready
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = state.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            // Remove from state
            setDownloadStates((prev) => {
              const next = { ...prev };
              delete next[path];
              return next;
            });
          } else if (res.status === 404 || res.status === 500) {
            // If error persists (not pending 202), maybe increment error count?
            // For now, we trust 202 for pending. 404 might mean server restart lost the file.
            // Let's remove it if it's 404 to avoid infinite loop of 404s
            if (res.status === 404) {
              setDownloadStates((prev) => {
                const next = { ...prev };
                delete next[path];
                return next;
              });
              message.error(`${t("common.requestError")} (404)`);
            }
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [downloadStates, API_URL, headersAuth, t]);

  // Initialize currentPath when rootPath is determined
  React.useEffect(() => {
    if (rootPath && !currentPath) {
      setCurrentPath(rootPath);
    }
  }, [rootPath, currentPath]);

  // Reset currentPath when drive changes manually
  const handleDriveChange = (newRoot) => {
    setRootPath(newRoot);
    setCurrentPath(newRoot);
  };

  React.useEffect(() => {
    if (!authToken) return;
    try {
      const parts = authToken.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]));
        const exp = typeof payload.exp === "number" ? payload.exp : 0;
        const nowSec = Math.floor(Date.now() / 1000);
        if (exp && exp <= nowSec) {
          localStorage.removeItem("token");
          setAuthToken("");
          window.dispatchEvent(new Event("auth:changed"));
        }
      }
    } catch (e) {
      void e;
    }
  }, [authToken]);

  const loadData = React.useCallback(async () => {
    const aParams = new URLSearchParams({
      page: "1",
      pageSize: "300",
      clientId,
    });
    const aRes = await fetch(`${API_URL}/activity?${aParams.toString()}`, {
      headers: headersAuth,
      cache: "no-store",
    });
    if (aRes.status === 401) {
      localStorage.removeItem("token");
      setAuthToken("");
      window.dispatchEvent(new Event("auth:changed"));
      return;
    }
    const aJson = await aRes.json().catch(() => ({}));
    const aData = Array.isArray(aJson.data) ? aJson.data : [];
    setActivity(aData);
    const sParams = new URLSearchParams({ page: "1", pageSize: "6", clientId });
    const sRes = await fetch(`${API_URL}/screenshots?${sParams.toString()}`, {
      headers: headersAuth,
      cache: "no-store",
    });
    if (sRes.status === 401) {
      localStorage.removeItem("token");
      setAuthToken("");
      window.dispatchEvent(new Event("auth:changed"));
      return;
    }
    const sJson = await sRes.json().catch(() => ({}));
    const sData = Array.isArray(sJson.data) ? sJson.data : [];
    setShots(sData);
    setImgTs(Date.now());
  }, [API_URL, clientId, headersAuth]);

  React.useEffect(() => {
    loadData();
    return () => {};
  }, [loadData]);

  React.useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      const candidates = ["%SYSTEMDRIVE%\\", "C:\\", "D:\\", "E:\\"];
      const headers = { ...headersAuth, "Content-Type": "application/json" };
      const found = [];
      for (const basePath of candidates) {
        try {
          const res = await authFetch(`${API_URL}/commands/list`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              clientId,
              basePath,
              pattern: "*",
              recursive: false,
              maxEntries: 1,
              includeDirs: true,
            }),
          });
          if (!res.ok) continue;
          const json = await res.json();
          const id = json.id;
          if (!id) continue;
          let ok = false;
          for (let i = 0; i < 10; i++) {
            await new Promise((r) => setTimeout(r, 500));
            const r2 = await authFetch(`${API_URL}/commands/${id}/json`);
            if (!r2.ok) continue;
            const j2 = await r2.json();
            const files = Array.isArray(j2.files) ? j2.files : [];
            const dirs = Array.isArray(j2.directories) ? j2.directories : [];
            if (files.length || dirs.length) {
              ok = true;
              break;
            }
          }
          if (ok) found.push(basePath);
        } catch (e) {
          void e;
        }
      }
      if (!cancelled) {
        setDriveOptions(found.length ? found : candidates);
        const newRoot = found.length ? found[0] : candidates[0];
        // Only set root/current if not already set or invalid
        setRootPath((prev) => {
          const valid = found.length ? found : candidates;
          if (valid.includes(prev)) return prev;
          return valid[0];
        });
      }
    };
    probe();
    return () => {
      cancelled = true;
    };
  }, [API_URL, clientId, headersAuth]);

  // Fetch directory contents when currentPath changes
  React.useEffect(() => {
    if (!currentPath) return;
    if (!clientId) {
      console.warn("Missing clientId in ActivityDetail");
      return;
    }
    let cancelled = false;
    const fetchDir = async () => {
      setDirLoading(true);
      setDirError(null);
      console.log(`Fetching dir for client=${clientId} path=${currentPath}`);
      try {
        const headers = { ...headersAuth, "Content-Type": "application/json" };
        const res = await authFetch(`${API_URL}/commands/list`, {
          method: "POST",
          headers,
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
          } catch {}
          throw new Error(errMsg);
        }
        const json = await res.json();
        const cmdId = json.id;
        if (!cmdId) throw new Error(t("common.serverNoId"));

        let items = [];
        let success = false;
        // Poll for up to 30 seconds
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
            // Sort: directories first, then files
            items.sort((a, b) => {
              if (a.isDir === b.isDir) return a.name.localeCompare(b.name);
              return a.isDir ? -1 : 1;
            });
            success = true;
            break;
          } else {
            // If error other than 404
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
  }, [currentPath, API_URL, clientId, headersAuth, retryTrigger]);

  // Helper to parse path into breadcrumbs
  const breadcrumbs = React.useMemo(() => {
    if (!currentPath) return [];
    // Handle Windows paths primarily as per context
    // Split by \ or / but keep the drive letter attached to the first part if possible
    const normalized = currentPath.replace(/\\/g, "/");
    const parts = normalized.split("/").filter((p) => p);

    // Reconstruct paths for each breadcrumb
    return parts.map((part, index) => {
      // Reconstruct the path up to this part
      // If it's a Windows drive (e.g. "C:"), ensure trailing slash for root
      // Actually, we can just join with backslashes since backend handles it
      const pathParts = parts.slice(0, index + 1);
      let path = pathParts.join("\\");
      if (pathParts.length === 1 && path.includes(":")) {
        path += "\\"; // Ensure C: becomes C:\
      }
      return { title: part, path };
    });
  }, [currentPath]);

  const handleCancelDownload = (path) => {
    cancelRefs.current.add(path);
    setDownloadStates((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
  };

  const handleDownload = async (record) => {
    const path = record.fullPath;
    if (downloadStates[path]) return;

    cancelRefs.current.delete(path);
    // Initialize state
    setDownloadStates((prev) => ({
      ...prev,
      [path]: { status: "init", progress: 0 },
    }));

    const headers = {
      ...headersAuth,
      "Content-Type": "application/json",
    };
    const isFolder = record.isDir;
    const endpoint = isFolder
      ? `${API_URL}/commands/folder`
      : `${API_URL}/commands/file`;
    try {
      const res = await authFetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          clientId,
          path: record.fullPath,
        }),
      });
      if (!res.ok) throw new Error("Failed to send command");
      const { id: cmdId } = await res.json();
      const targetFilename = isFolder ? `${record.name}.zip` : record.name;

      // Update state to start polling
      setDownloadStates((prev) => ({
        ...prev,
        [path]: {
          status: "polling",
          cmdId,
          filename: targetFilename,
          progress: 5,
        },
      }));
    } catch (e) {
      if (e.message !== "Cancelled") {
        console.error(e);
        message.error(t("common.requestError"));
      }
      // Clean up on error
      setDownloadStates((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
    }
  };

  const columns = [
    {
      title: t("common.name"),
      dataIndex: "name",
      key: "name",
      render: (text, record) => (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            cursor: record.isDir ? "pointer" : "default",
            gap: 8,
          }}
          onClick={() => record.isDir && setCurrentPath(record.fullPath)}
        >
          {record.isDir ? (
            <FolderFilled style={{ color: "#54aeff", fontSize: 18 }} />
          ) : (
            <FileTextOutlined style={{ color: "#666", fontSize: 18 }} />
          )}
          <span
            style={{
              color: record.isDir ? "#1677ff" : "inherit",
              fontWeight: record.isDir ? 500 : 400,
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
      width: 100,
      render: (text, record) => {
        if (record.isDir) return "-";
        if (typeof text !== "number") return "-";
        if (text < 1024) return `${text} B`;
        if (text < 1024 * 1024) return `${(text / 1024).toFixed(1)} KB`;
        return `${(text / (1024 * 1024)).toFixed(1)} MB`;
      },
    },
    {
      title: t("common.lastModified"),
      dataIndex: "lastWriteTime",
      key: "lastWriteTime",
      width: 200,
      render: (text) =>
        text
          ? new Date(text).toLocaleString(
              i18n.language === "uz" ? "uz-UZ" : "ru-RU"
            )
          : "-",
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 150,
      align: "right",
      render: (_, record) => {
        const state = downloadStates[record.fullPath];
        if (state) {
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Progress
                percent={Math.floor(state.progress)}
                size="small"
                steps={5}
                showInfo={false}
                strokeColor="#1677ff"
              />
              <span style={{ fontSize: 12, color: "#666" }}>
                {Math.floor(state.progress)}%
              </span>
              {state.progress >= 95 && (
                <span style={{ fontSize: 10, color: "#faad14" }}>
                  {t("common.processingWait")}
                </span>
              )}
              <Button
                type="text"
                danger
                icon={<CloseCircleOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCancelDownload(record.fullPath);
                }}
              />
            </div>
          );
        }
        return (
          <Button
            type="text"
            icon={<DownloadOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              handleDownload(record);
            }}
          />
        );
      },
    },
  ];

  const now = Date.now();
  const spanMs =
    { "7d": 7 * 24 * 60 * 60 * 1000, "30d": 30 * 24 * 60 * 60 * 1000 }[range] ||
    7 * 24 * 60 * 60 * 1000;
  const filtered = activity.filter(
    (d) => new Date(d.timestamp).getTime() >= now - spanMs
  );
  const groups = (() => {
    const map = new Map();
    for (const rec of filtered) {
      const dt = new Date(rec.timestamp);
      const key = new Date(
        dt.getFullYear(),
        dt.getMonth(),
        dt.getDate()
      ).toISOString();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(rec);
    }
    const entries = Array.from(map.entries()).sort(
      (a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime()
    );
    return entries;
  })();
  const daily = groups.map(([key, arr]) => {
    const sorted = arr
      .slice()
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    let sum = 0;
    const MAX_GAP = 2 * 60 * 1000;
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i];
      const nxt = sorted[i + 1];
      const diff =
        new Date(nxt.timestamp).getTime() - new Date(cur.timestamp).getTime();
      const duration = Math.min(diff, MAX_GAP);
      if (cur.isActive) sum += duration;
    }
    const last = sorted[sorted.length - 1];
    const dayDate = new Date(last.timestamp);
    const isToday = new Date().toDateString() === dayDate.toDateString();
    const timeSinceLast = now - new Date(last.timestamp).getTime();

    if (isToday && last.isActive && timeSinceLast < MAX_GAP)
      sum += timeSinceLast;

    const hours = Math.max(0, sum / (60 * 60 * 1000));
    const label = dayDate.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
    });
    return { key, hours, label };
  });
  const dailyInactive = groups.map(([key, arr]) => {
    const sorted = arr
      .slice()
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    let sum = 0;
    const MAX_GAP = 2 * 60 * 1000;
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i];
      const nxt = sorted[i + 1];
      const diff =
        new Date(nxt.timestamp).getTime() - new Date(cur.timestamp).getTime();

      if (!cur.isActive) {
        sum += diff;
      } else {
        if (diff > MAX_GAP) {
          sum += diff - MAX_GAP;
        }
      }
    }
    const last = sorted[sorted.length - 1];
    const dayDate = new Date(last.timestamp);
    const isToday = new Date().toDateString() === dayDate.toDateString();
    const timeSinceLast = now - new Date(last.timestamp).getTime();

    if (isToday && !last.isActive) {
      sum += timeSinceLast;
    } else if (isToday && last.isActive && timeSinceLast > MAX_GAP) {
      sum += timeSinceLast - MAX_GAP;
    }

    const hours = Math.max(0, sum / (60 * 60 * 1000));
    const label = dayDate.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
    });
    return { key, hours, label };
  });
  React.useEffect(() => {
    // expose globals for FlyonUI helper
    // @ts-ignore
    window._ = _;
    // @ts-ignore
    window.ApexCharts = ApexCharts;
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }
    if (!daily.length) return;
    const series = [
      {
        name: t("common.dayActivity"),
        data: daily.map((d) => Number(d.hours.toFixed(1))),
      },
    ];
    const options = {
      chart: { type: "area", height: 360, animations: { enabled: true } },
      dataLabels: { enabled: false },
      stroke: { curve: "smooth" },
      fill: {
        type: "gradient",
        gradient: {
          shadeIntensity: 0.4,
          opacityFrom: 0.5,
          opacityTo: 0.1,
          stops: [0, 90, 100],
        },
      },
      xaxis: { categories: daily.map((d) => d.label) },
      yaxis: { min: 0, labels: { formatter: (v) => `${v} ${t("common.h")}` } },
      colors: ["#1677ff"],
      tooltip: { enabled: true },
    };
    const el = document.querySelector(`#${chartElId}`);
    if (el) {
      // Prefer FlyonUI helper if available
      const buildChart = window.buildChart;
      if (typeof buildChart === "function") {
        const chart = buildChart(`#${chartElId}`, () => ({
          series,
          ...options,
        }));
        chartRef.current = chart;
      } else {
        const chart = new ApexCharts(el, { series, ...options });
        chart.render();
        chartRef.current = chart;
      }
    }
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [daily, chartElId]);

  React.useEffect(() => {
    window._ = _;
    window.ApexCharts = ApexCharts;
    if (inactChartRef.current) {
      inactChartRef.current.destroy();
      inactChartRef.current = null;
    }
    if (!dailyInactive.length) return;
    const series = [
      {
        name: t("common.dayInactivity"),
        data: dailyInactive.map((d) => Number(d.hours.toFixed(1))),
      },
    ];
    const options = {
      chart: { type: "area", height: 240, animations: { enabled: true } },
      dataLabels: { enabled: false },
      stroke: { curve: "smooth" },
      fill: {
        type: "gradient",
        gradient: {
          shadeIntensity: 0.4,
          opacityFrom: 0.5,
          opacityTo: 0.1,
          stops: [0, 90, 100],
        },
      },
      xaxis: { categories: dailyInactive.map((d) => d.label) },
      yaxis: { min: 0, labels: { formatter: (v) => `${v} ${t("common.h")}` } },
      colors: ["#ff4d4f"],
      tooltip: { enabled: true },
    };
    const el = document.querySelector(`#${chartElIdInactive}`);
    if (el) {
      const buildChart = window.buildChart;
      if (typeof buildChart === "function") {
        const chart = buildChart(`#${chartElIdInactive}`, () => ({
          series,
          ...options,
        }));
        inactChartRef.current = chart;
      } else {
        const chart = new ApexCharts(el, { series, ...options });
        chart.render();
        inactChartRef.current = chart;
      }
    }
    return () => {
      inactChartRef.current?.destroy();
      inactChartRef.current = null;
    };
  }, [dailyInactive, chartElIdInactive]);

  return (
    <List title={`${t("common.client")} ${clientId}`}>
      <div
        style={{
          marginBottom: 8,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontWeight: 600 }}>{t("common.activeChart")}</div>
        <Segmented
          value={range}
          onChange={setRange}
          options={[
            { label: t("common.week"), value: "7d" },
            { label: t("common.month"), value: "30d" },
          ]}
        />
      </div>
      <div id={chartElId} />
      <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 600 }}>
        {t("common.inactiveChart")}
      </div>
      <div id={chartElIdInactive} />
      <div style={{ marginTop: 24, marginBottom: 8, fontWeight: 600 }}>
        {t("common.lastScreenshots")}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
        }}
      >
        {shots.map((s) => (
          <div key={s.id} style={{ border: "1px solid #eee", padding: 8 }}>
            {authToken ? (
              <img
                src={`${API_URL}/screenshots/${s.id}/file?token=${authToken}&ts=${imgTs}`}
                alt={s.filename}
                loading="lazy"
                decoding="async"
                fetchPriority="low"
                style={{ width: "100%", height: 180, objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  height: 180,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#999",
                }}
              >
                {t("common.accessDenied")}
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 12 }}>
              {new Date(s.timestamp).toLocaleString(
                i18n.language === "uz" ? "uz-UZ" : "ru-RU",
                {
                  timeZone: "Asia/Tashkent",
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }
              )}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 24, marginBottom: 8, fontWeight: 600 }}>
        {t("common.clientFiles")}
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <span style={{ color: "#666" }}>{t("common.disk")}:</span>
        <Select
          style={{ minWidth: 160 }}
          value={rootPath}
          options={(driveOptions.length ? driveOptions : [rootPath]).map(
            (d) => ({ label: d, value: d })
          )}
          onChange={handleDriveChange}
        />
      </div>
      {dirError ? (
        <div
          style={{
            padding: "12px 16px",
            marginBottom: 16,
            background: "#fff2f0",
            border: "1px solid #ffccc7",
            borderRadius: 6,
            color: "#cf1322",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>
            {t("common.dirLoadError")}: <strong>{dirError}</strong>
          </span>
          <Button
            size="small"
            onClick={() => setRetryTrigger((p) => p + 1)}
            type="primary"
            danger
          >
            {t("common.retry")}
          </Button>
        </div>
      ) : (
        <>
          <Breadcrumb
            style={{ marginBottom: 16 }}
            items={[
              {
                title: (
                  <HomeOutlined
                    onClick={() => setCurrentPath(rootPath)}
                    style={{ cursor: "pointer" }}
                  />
                ),
              },
              ...breadcrumbs.map((item) => ({
                title: (
                  <span
                    style={{ cursor: "pointer" }}
                    onClick={() => setCurrentPath(item.path)}
                  >
                    {item.title}
                  </span>
                ),
              })),
            ]}
          />
          <Table
            dataSource={dirItems}
            columns={columns}
            rowKey="key"
            loading={dirLoading}
            pagination={false}
            size="small"
            onRow={(record) => ({
              onClick: () => {
                if (record.isDir) setCurrentPath(record.fullPath);
              },
              style: { cursor: record.isDir ? "pointer" : "default" },
            })}
            locale={{ emptyText: t("common.noFiles") }}
          />
        </>
      )}
    </List>
  );
}
