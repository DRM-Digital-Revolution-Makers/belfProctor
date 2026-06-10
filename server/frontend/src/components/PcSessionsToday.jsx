import React, { useEffect, useState } from "react";
import { authFetch } from "../dataProvider";
import { formatTashkent, tashkentDateKey } from "../utils/time";

const API_URL =
  import.meta.env.VITE_API_URL ||
  `http://${window.location.hostname}:8080/api`;

/**
 * Per-client list of "PC was on" intervals for a given day in Asia/Tashkent.
 * Source tag distinguishes explicit boot/shutdown events from server-side
 * heartbeat-gap inference so operators can spot less-trusted rows.
 */
export default function PcSessionsToday({ clientId, date }) {
  const dateStr = date || tashkentDateKey(new Date());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    authFetch(
      `${API_URL}/pc-session?clientId=${encodeURIComponent(clientId)}&date=${dateStr}`,
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((body) => {
        if (cancelled) return;
        setRows(Array.isArray(body?.data) ? body.data : []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || "Не удалось загрузить сессии ПК");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, dateStr]);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 16,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        Сессии ПК сегодня
      </div>
      {loading && <div style={{ color: "#888" }}>Загрузка…</div>}
      {error && <div style={{ color: "#dc2626" }}>{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div style={{ color: "#888" }}>Нет данных за {dateStr}</div>
      )}
      {!loading && !error && rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#6b7280", fontSize: 12 }}>
              <th style={{ padding: "4px 8px" }}>Включен</th>
              <th style={{ padding: "4px 8px" }}>Выключен</th>
              <th style={{ padding: "4px 8px" }}>Источник</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                <td style={{ padding: "6px 8px" }}>
                  {formatTashkent(s.bootAt, "HH:mm")}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  {s.shutdownAt
                    ? formatTashkent(s.shutdownAt, "HH:mm")
                    : "сейчас"}
                </td>
                <td style={{ padding: "6px 8px", fontSize: 12 }}>
                  {sourceLabel(s.source)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function sourceLabel(source) {
  switch (source) {
    case "explicit":
      return "событие клиента";
    case "explicit_with_gap_close":
      return "клиент + автозакрытие";
    case "heartbeat_gap":
      return "по разрыву связи";
    default:
      return source || "—";
  }
}
