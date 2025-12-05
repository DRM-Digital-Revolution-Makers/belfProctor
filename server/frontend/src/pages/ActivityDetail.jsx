import React from "react";
import { List } from "@refinedev/antd";
import { Button, Segmented, Select, Breadcrumb, Table } from "antd";
import {
  FolderFilled,
  FileTextOutlined,
  DownloadOutlined,
  HomeOutlined,
} from "@ant-design/icons";
import { authFetch } from "../dataProvider.js";
import { useParams } from "react-router-dom";
import ApexCharts from "apexcharts";
import _ from "lodash";
import "flyonui/dist/helper-apexcharts.js";

export default function ActivityDetail() {
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
  const [dirError, setDirError] = React.useState(false);
  const [range, setRange] = React.useState("7d");
  const [authToken, setAuthToken] = React.useState(
    () => localStorage.getItem("token") || ""
  );
  const [imgTs, setImgTs] = React.useState(() => Date.now());
  const [driveOptions, setDriveOptions] = React.useState([]);
  const [rootPath, setRootPath] = React.useState("%SYSTEMDRIVE%\\");

  const headersAuth = React.useMemo(() => {
    return authToken ? { Authorization: `Bearer ${authToken}` } : {};
  }, [authToken]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    let cancelled = false;
    const fetchDir = async () => {
      setDirLoading(true);
      setDirError(false);
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
        if (!res.ok) throw new Error("Failed to list");
        const json = await res.json();
        const cmdId = json.id;
        if (!cmdId) throw new Error("No command ID");

        let items = [];
        for (let i = 0; i < 15; i++) {
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
            break;
          }
        }
        if (!cancelled) setDirItems(items);
      } catch (e) {
        if (!cancelled) setDirError(true);
      } finally {
        if (!cancelled) setDirLoading(false);
      }
    };
    fetchDir();
    return () => {
      cancelled = true;
    };
  }, [currentPath, API_URL, clientId, headersAuth]);

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

  const handleDownload = async (record) => {
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
      if (!res.ok) return;
      const { id: cmdId } = await res.json();
      const targetFilename = isFolder ? `${record.name}.zip` : record.name;

      // Poll for file result
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const r2 = await authFetch(`${API_URL}/commands/${cmdId}/file/latest`);
        if (r2.ok) {
          const blob = await r2.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = targetFilename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          break;
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const columns = [
    {
      title: "Имя",
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
      title: "Размер",
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
      title: "Дата изменения",
      dataIndex: "lastWriteTime",
      key: "lastWriteTime",
      width: 200,
      render: (text) => (text ? new Date(text).toLocaleString("ru-RU") : "-"),
    },
    {
      title: "Действия",
      key: "actions",
      width: 100,
      align: "right",
      render: (_, record) => (
        <Button
          type="text"
          icon={<DownloadOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            handleDownload(record);
          }}
        />
      ),
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
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i];
      const nxt = sorted[i + 1];
      if (cur.isActive)
        sum +=
          new Date(nxt.timestamp).getTime() - new Date(cur.timestamp).getTime();
    }
    const last = sorted[sorted.length - 1];
    const dayDate = new Date(last.timestamp);
    const isToday = new Date().toDateString() === dayDate.toDateString();
    if (isToday && last.isActive)
      sum += now - new Date(last.timestamp).getTime();
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
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i];
      const nxt = sorted[i + 1];
      if (!cur.isActive)
        sum +=
          new Date(nxt.timestamp).getTime() - new Date(cur.timestamp).getTime();
    }
    const last = sorted[sorted.length - 1];
    const dayDate = new Date(last.timestamp);
    const isToday = new Date().toDateString() === dayDate.toDateString();
    if (isToday && !last.isActive)
      sum += now - new Date(last.timestamp).getTime();
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
        name: "Активность за день",
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
      yaxis: { min: 0, labels: { formatter: (v) => `${v} ч` } },
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
        name: "Неактивность за день",
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
      yaxis: { min: 0, labels: { formatter: (v) => `${v} ч` } },
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
    <List title={`Клиент ${clientId}`}>
      <div
        style={{
          marginBottom: 8,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontWeight: 600 }}>График активности</div>
        <Segmented
          value={range}
          onChange={setRange}
          options={[
            { label: "Неделя", value: "7d" },
            { label: "Месяц", value: "30d" },
          ]}
        />
      </div>
      <div id={chartElId} />
      <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 600 }}>
        График неактивности
      </div>
      <div id={chartElIdInactive} />
      <div style={{ marginTop: 24, marginBottom: 8, fontWeight: 600 }}>
        Последние скриншоты
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
                Нет доступа
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 12 }}>
              {new Date(s.timestamp).toLocaleString("ru-RU", {
                timeZone: "Asia/Tashkent",
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 24, marginBottom: 8, fontWeight: 600 }}>
        Файлы клиента
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <span style={{ color: "#666" }}>Диск:</span>
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
        <div style={{ color: "#999" }}>
          рабочие директории клиента не отображаются
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
            locale={{ emptyText: "Нет файлов" }}
          />
        </>
      )}
    </List>
  );
}
