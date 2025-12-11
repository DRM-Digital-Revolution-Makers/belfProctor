import React from "react";
import { List } from "@refinedev/antd";
import { Table, Tag, Button } from "antd";
import { Link } from "react-router-dom";
import { authFetch } from "../dataProvider.js";

export default function ActivitiesList() {
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;
  const [items, setItems] = React.useState([]);
  const [latestHeartbeats, setLatestHeartbeats] = React.useState([]);

  const fetchLatest = React.useCallback(() => {
    const ts = Date.now();
    authFetch(`${API_URL}/activity/latest?ts=${ts}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json) setItems(json.data || []);
      })
      .catch(() => {
        /* keep previous items */
      });
    authFetch(`${API_URL}/heartbeat/latest?ts=${ts}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json) setLatestHeartbeats(json.data || []);
      })
      .catch(() => {
        /* keep previous hb */
      });
    authFetch(`${API_URL}/activity?page=1&pageSize=50&ts=${ts}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json && (!items || items.length === 0)) {
          const arr = Array.isArray(json.data) ? json.data : [];
          const map = new Map();
          for (const rec of arr) {
            if (!map.has(rec.clientId)) map.set(rec.clientId, rec);
          }
          setItems(Array.from(map.values()));
        }
      })
      .catch(() => {
        /* keep previous items */
      });
  }, [API_URL]);

  React.useEffect(() => {
    fetchLatest();
    const id = setInterval(fetchLatest, 3000);
    return () => clearInterval(id);
  }, [fetchLatest]);

  const isOnline = (clientId) => {
    const hb = latestHeartbeats.find((h) => h.clientId === clientId);
    // Reduced timeout to 60 seconds to detect offline status faster
    return hb && Date.now() - new Date(hb.timestamp).getTime() < 60 * 1000;
  };

  const renderDuration = (record) => {
    const now = Date.now();
    const ts = new Date(record.timestamp).getTime();
    const online = isOnline(record.clientId);
    const isActive = online && record.isActive;

    let activeMs = record.activeMilliseconds;
    let inactiveMs = record.inactiveMilliseconds;

    if (online) {
      // If online, accumulate time based on current state
      if (isActive) {
        activeMs += now - ts;
      } else {
        inactiveMs += now - ts;
      }
    }
    // If offline, we do not add any time to active/inactive current counters
    // because the client stopped reporting.
    // Ideally, the time since last report is "Offline" time.

    const fmt = (ms) => {
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      const mm = m % 60;
      const ss = s % 60;
      if (h > 0) return `${h} ч ${mm} м ${ss} с`;
      if (m > 0) return `${m} м ${ss} с`;
      return `${ss} с`;
    };
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>Активен: {fmt(activeMs)}</div>
        <div>Неактивен: {fmt(inactiveMs)}</div>
      </div>
    );
  };

  return (
    <List title="Активность">
      <Table
        rowKey="clientId"
        dataSource={Array.isArray(items) ? items : []}
        size="large"
        pagination={false}
        columns={[
          { title: "ClientId", dataIndex: "clientId" },
          {
            title: "Статус",
            render: (_, r) => {
              const online = isOnline(r.clientId);
              return online ? (
                <Tag color="green">Подключен</Tag>
              ) : (
                <Tag color="red">Отключен</Tag>
              );
            },
          },
          {
            title: "Активность",
            render: (_, r) => {
              const online = isOnline(r.clientId);
              const effectiveActive = online && r.isActive;
              return effectiveActive ? (
                <Tag color="green">Активен</Tag>
              ) : (
                <Tag color="red">Неактивен</Tag>
              );
            },
          },
          { title: "Таймеры", render: (_, r) => renderDuration(r) },
          {
            title: "Действие",
            render: (_, r) => (
              <Link to={`/activity/${r.clientId}`}>
                <Button>Подробнее</Button>
              </Link>
            ),
          },
        ]}
      />
    </List>
  );
}
