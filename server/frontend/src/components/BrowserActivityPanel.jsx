import React, { useEffect, useState } from "react";
import { authFetch } from "../dataProvider";
import { formatTashkent } from "../utils/time";

const API_URL =
  import.meta.env.VITE_API_URL ||
  `http://${window.location.hostname}:8080/api`;

const BROWSERS = ["", "chrome", "edge", "yandex", "brave", "opera", "vivaldi", "firefox"];

export default function BrowserActivityPanel({ clientId }) {
  const [browser, setBrowser] = useState("");
  const [rows, setRows] = useState([]);
  const [topDomains, setTopDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const qs = new URLSearchParams({ clientId, limit: "200" });
    if (browser) qs.set("browser", browser);

    Promise.all([
      authFetch(`${API_URL}/browser-activity?${qs.toString()}`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      authFetch(
        `${API_URL}/browser-activity/top-domains?clientId=${encodeURIComponent(clientId)}&limit=10`,
      ).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    ])
      .then(([list, top]) => {
        if (cancelled) return;
        setRows(Array.isArray(list?.data) ? list.data : []);
        setTopDomains(Array.isArray(top?.data) ? top.data : []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || "Не удалось загрузить активность браузера");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, browser]);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <div style={{ fontWeight: 600 }}>Активность браузеров</div>
        <select
          value={browser}
          onChange={(e) => setBrowser(e.target.value)}
          style={{
            padding: "4px 8px",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
          }}
        >
          {BROWSERS.map((b) => (
            <option key={b || "all"} value={b}>
              {b || "Все браузеры"}
            </option>
          ))}
        </select>
      </div>

      {loading && <div style={{ color: "#888" }}>Загрузка…</div>}
      {error && <div style={{ color: "#dc2626" }}>{error}</div>}

      {!loading && !error && topDomains.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
            Топ доменов
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {topDomains.map((d) => (
              <span
                key={d.domain}
                style={{
                  background: "#f1f5f9",
                  padding: "2px 8px",
                  borderRadius: 12,
                  fontSize: 12,
                }}
              >
                {d.domain} · {d.count}
              </span>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div style={{ color: "#888" }}>Нет данных</div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div
          style={{
            maxHeight: 400,
            overflowY: "auto",
            border: "1px solid #f1f5f9",
            borderRadius: 8,
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead
              style={{
                position: "sticky",
                top: 0,
                background: "#fff",
                zIndex: 1,
              }}
            >
              <tr style={{ textAlign: "left", color: "#6b7280", fontSize: 12 }}>
                <th style={{ padding: "4px 8px" }}>Время</th>
                <th style={{ padding: "4px 8px" }}>Браузер</th>
                <th style={{ padding: "4px 8px" }}>Домен</th>
                <th style={{ padding: "4px 8px" }}>Заголовок / URL</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  style={{
                    borderTop: "1px solid #f1f5f9",
                    verticalAlign: "top",
                  }}
                >
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                    {formatTashkent(r.visitedAt, "DD.MM HH:mm:ss")}
                  </td>
                  <td style={{ padding: "6px 8px" }}>{r.browser}</td>
                  <td style={{ padding: "6px 8px" }}>{r.domain}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <div style={{ fontWeight: 500 }}>{r.title || "—"}</div>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: "#2563eb" }}
                    >
                      {r.url}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error && rows.length > 0 && (
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
          Показано {rows.length} записей — прокрутите внутри блока
        </div>
      )}
    </div>
  );
}
