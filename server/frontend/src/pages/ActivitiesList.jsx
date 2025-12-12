import React from "react";
import { List } from "@refinedev/antd";
import { Table, Tag, Button } from "antd";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authFetch } from "../dataProvider.js";

export default function ActivitiesList() {
  const { t } = useTranslation();
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;
  const [items, setItems] = React.useState([]);
  const [latestHeartbeats, setLatestHeartbeats] = React.useState([]);

  const fetchLatest = React.useCallback(async () => {
    const ts = Date.now();
    try {
      const [clientsRes, activityRes, heartbeatRes] = await Promise.all([
        authFetch(`${API_URL}/clients?ts=${ts}`),
        authFetch(`${API_URL}/activity/latest?ts=${ts}`),
        authFetch(`${API_URL}/heartbeat/latest?ts=${ts}`),
      ]);

      const clients = clientsRes.ok ? await clientsRes.json() : [];
      const activities = activityRes.ok
        ? (await activityRes.json()).data || []
        : [];
      const heartbeats = heartbeatRes.ok
        ? (await heartbeatRes.json()).data || []
        : [];

      setLatestHeartbeats(heartbeats);

      const merged = clients.map((c) => {
        const act = activities.find((a) => a.clientId === c.id) || {};
        return {
          clientId: c.id,
          timestamp: act.timestamp || new Date().toISOString(), // fallback
          isActive: Boolean(act.isActive),
          activeMilliseconds: act.activeMilliseconds || 0,
          inactiveMilliseconds: act.inactiveMilliseconds || 0,
          ...act, // keep original id etc if present
        };
      });

      setItems(merged);
    } catch (e) {
      console.error(e);
    }
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
      if (h > 0)
        return `${h} ${t("common.h")} ${mm} ${t("common.m")} ${ss} ${t(
          "common.s"
        )}`;
      if (m > 0) return `${m} ${t("common.m")} ${ss} ${t("common.s")}`;
      return `${ss} ${t("common.s")}`;
    };
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          {t("common.active")}: {fmt(activeMs)}
        </div>
        <div>
          {t("common.inactive")}: {fmt(inactiveMs)}
        </div>
      </div>
    );
  };

  return (
    <List title={t("activity.title")}>
      <Table
        rowKey="clientId"
        dataSource={Array.isArray(items) ? items : []}
        size="large"
        pagination={false}
        columns={[
          { title: "ClientId", dataIndex: "clientId" },
          {
            title: t("common.status"),
            render: (_, r) => {
              const online = isOnline(r.clientId);
              return online ? (
                <Tag color="green">{t("common.online")}</Tag>
              ) : (
                <Tag color="red">{t("common.offline")}</Tag>
              );
            },
          },
          {
            title: t("activity.title"),
            render: (_, r) => {
              const online = isOnline(r.clientId);
              const effectiveActive = online && r.isActive;
              return effectiveActive ? (
                <Tag color="green">{t("common.active")}</Tag>
              ) : (
                <Tag color="red">{t("common.inactive")}</Tag>
              );
            },
          },
          { title: t("common.timers"), render: (_, r) => renderDuration(r) },
          {
            title: t("common.action"),
            render: (_, r) => (
              <Link to={`/activity/${r.clientId}`}>
                <Button>{t("common.details")}</Button>
              </Link>
            ),
          },
        ]}
      />
    </List>
  );
}
