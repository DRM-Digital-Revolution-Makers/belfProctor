import React from "react";
import { List } from "@refinedev/antd";
import { Button, Tree, Segmented } from "antd";
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
  const [dirTree, setDirTree] = React.useState([]);
  const [dirError, setDirError] = React.useState(false);
  const [range, setRange] = React.useState("7d");
  const [authToken, setAuthToken] = React.useState(
    () => localStorage.getItem("token") || ""
  );
  const [imgTs, setImgTs] = React.useState(() => Date.now());

  const headersAuth = React.useMemo(() => {
    return authToken ? { Authorization: `Bearer ${authToken}` } : {};
  }, [authToken]);

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
    } catch {}
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

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        setDirError(false);
        const headers = { "Content-Type": "application/json" };
        const res = await authFetch(`${API_URL}/commands/send`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            clientId,
            type: "listDir",
            payload: { path: "~" },
          }),
        });
        const json = await res.json();
        const cmdId = json.id;
        let got = false;
        for (let i = 0; i < 15; i++) {
          if (cancelled) return;
          await new Promise((r) => setTimeout(r, 1000));
          const r2 = await authFetch(`${API_URL}/commands/${cmdId}/result`);
          if (r2.ok) {
            const j2 = await r2.json();
            const tree = Array.isArray(j2.tree) ? j2.tree : [];
            if (tree.length) {
              setDirTree(tree);
              got = true;
              break;
            }
          }
        }
        if (!got) setDirError(true);
      } catch {
        setDirError(true);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [API_URL, clientId, headersAuth]);

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
            <div style={{ marginTop: 8, fontSize: 12 }}>{s.timestamp}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 24, marginBottom: 8, fontWeight: 600 }}>
        Файлы клиента
      </div>
      {dirError ? (
        <div style={{ color: "#999" }}>
          рабочие директории клиента не отображаются
        </div>
      ) : (
        <Tree
          treeData={dirTree}
          titleRender={(node) => (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>{node.title}</span>
              {node.isLeaf && (
                <Button
                  size="small"
                  onClick={async () => {
                    const headers = { "Content-Type": "application/json" };
                    const res = await authFetch(`${API_URL}/commands/send`, {
                      method: "POST",
                      headers,
                      body: JSON.stringify({
                        clientId,
                        type: "fetchFile",
                        payload: { path: node.path },
                      }),
                    });
                    const { id: cmdId } = await res.json();
                    for (let i = 0; i < 20; i++) {
                      await new Promise((r) => setTimeout(r, 1000));
                      const r2 = await authFetch(
                        `${API_URL}/commands/${cmdId}/result`
                      );
                      if (r2.ok) {
                        const j2 = await r2.json();
                        const b64 = j2.base64 || "";
                        const fname = j2.filename || node.title;
                        if (b64) {
                          const bin = atob(b64);
                          const arr = new Uint8Array(bin.length);
                          for (let i2 = 0; i2 < bin.length; i2++)
                            arr[i2] = bin.charCodeAt(i2);
                          const blob = new Blob([arr]);
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = fname;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          URL.revokeObjectURL(url);
                        }
                        break;
                      }
                    }
                  }}
                >
                  Скачать
                </Button>
              )}
            </div>
          )}
        />
      )}
    </List>
  );
}
