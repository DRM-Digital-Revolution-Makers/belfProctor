import React from "react";
import { List } from "@refinedev/antd";
import { Table, Tag, Button, Select, Space } from "antd";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authFetch } from "../dataProvider.js";

export default function ActivitiesList() {
  const { t } = useTranslation();
  const API_URL =
    import.meta.env.VITE_API_URL ||
    "/api";
  const [items, setItems] = React.useState([]);
  const [categoryFilter, setCategoryFilter] = React.useState(null);
  const [latestHeartbeats, setLatestHeartbeats] = React.useState([]);
  const [serverTime, setServerTime] = React.useState(null);
  const isDebug =
    typeof window !== "undefined" && window.location.search.includes("debug=1");

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

      const hbJson = heartbeatRes.ok ? await heartbeatRes.json() : {};
      const heartbeats = hbJson.data || [];
      setServerTime(
        hbJson.serverTime ? new Date(hbJson.serverTime) : new Date(),
      );

      setLatestHeartbeats(heartbeats);

      const activityByClient = new Map(
        (Array.isArray(activities) ? activities : [])
          .filter((a) => a && a.clientId)
          .map((a) => [a.clientId, a]),
      );

      const merged = clients.map((c) => {
        const act = activityByClient.get(c.id);
        const ts = act?.timestamp || act?.Timestamp || null;
        const isActive =
          typeof act?.isActive === "boolean"
            ? act.isActive
            : typeof act?.IsActive === "boolean"
              ? act.IsActive
              : null;
        return {
          clientId: c.id,
          category: c.category || "",
          timestamp: ts,
          isActive,
          activeMilliseconds:
            typeof act?.activeMilliseconds === "number"
              ? act.activeMilliseconds
              : typeof act?.ActiveMilliseconds === "number"
                ? act.ActiveMilliseconds
                : 0,
          inactiveMilliseconds:
            typeof act?.inactiveMilliseconds === "number"
              ? act.inactiveMilliseconds
              : typeof act?.InactiveMilliseconds === "number"
                ? act.InactiveMilliseconds
                : 0,
          ...(act || {}),
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
    // lastHeartbeat from API = server-authoritative (from clients/X.json, updated on every heartbeat)
    const lastSeen =
      hb?.lastHeartbeat || hb?.lastSeen || hb?.timestamp || hb?.lastActivity;
    if (!lastSeen) return false;
    const now = serverTime ? serverTime.getTime() : Date.now();
    return now - new Date(lastSeen).getTime() < 3 * 60 * 1000;
  };

  const renderDuration = (record) => {
    if (!record.timestamp) {
      return "-";
    }

    const now = serverTime ? serverTime.getTime() : Date.now();
    const ts = new Date(record.timestamp).getTime();
    const online = isOnline(record.clientId);
    const isActive = online && record.isActive === true;

    let activeMs = record.activeMilliseconds;
    let inactiveMs = record.inactiveMilliseconds;

    if (online) {
      // If online, accumulate time based on current state
      if (isActive) {
        activeMs += Math.max(0, now - ts);
      } else {
        inactiveMs += Math.max(0, now - ts);
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
          "common.s",
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

  const categories = React.useMemo(() => {
    const set = new Set();
    (Array.isArray(items) ? items : []).forEach((it) => {
      const v = String(it?.category || "").trim();
      if (v) set.add(v);
    });
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
  }, [items]);

  const filteredItems = React.useMemo(() => {
    const arr = Array.isArray(items) ? items : [];
    if (!categoryFilter) return arr;
    return arr.filter((it) => String(it?.category || "") === String(categoryFilter));
  }, [items, categoryFilter]);

  return (
    <List title={t("activity.title")}>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear
          style={{ minWidth: 240 }}
          placeholder={t("common.category")}
          value={categoryFilter}
          options={categories.map((c) => ({ label: c, value: c }))}
          onChange={(v) => setCategoryFilter(v || null)}
        />
      </Space>
      <Table
        rowKey="clientId"
        dataSource={filteredItems}
        size="large"
        pagination={false}
        columns={[
          { title: "ClientId", dataIndex: "clientId" },
          { title: t("common.category"), dataIndex: "category" },
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
              if (!online) return <Tag color="red">{t("common.inactive")}</Tag>;
              if (r.isActive === true)
                return <Tag color="green">{t("common.active")}</Tag>;
              if (r.isActive === false)
                return <Tag color="red">{t("common.inactive")}</Tag>;
              return <Tag color="default">-</Tag>;
            },
          },
          { title: t("common.timers"), render: (_, r) => renderDuration(r) },
          ...(isDebug
            ? [
                {
                  title: "Debug",
                  render: (_, r) => {
                    const hb = latestHeartbeats.find(
                      (h) => h.clientId === r.clientId,
                    );
                    const lastHeartbeat =
                      hb?.lastHeartbeat ||
                      hb?.lastSeen ||
                      hb?.timestamp ||
                      null;
                    const lastActivity = hb?.lastActivity || null;
                    return (
                      <div
                        style={{
                          fontSize: 10,
                          maxWidth: 420,
                          wordBreak: "break-all",
                        }}
                      >
                        <div>timestamp: {String(r.timestamp || "")}</div>
                        <div>isActive: {String(r.isActive)}</div>
                        <div>lastHeartbeat: {String(lastHeartbeat || "")}</div>
                        <div>lastActivity: {String(lastActivity || "")}</div>
                      </div>
                    );
                  },
                },
              ]
            : []),
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
