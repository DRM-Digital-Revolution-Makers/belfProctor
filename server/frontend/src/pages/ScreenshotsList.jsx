import React from "react";
import { List } from "@refinedev/antd";
import { Table, Button, Select, Checkbox, Space } from "antd";
import { StarOutlined, StarFilled } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { authFetch } from "../dataProvider.js";

export default function ScreenshotsList() {
  const { t, i18n } = useTranslation();
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;
  const [items, setItems] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [clients, setClients] = React.useState([]);
  const [filters, setFilters] = React.useState({
    clientId: null,
    category: null,
    isFavorite: false,
  });
  const pageSize = 50;

  const handleTableChange = (pagination, tableFilters) => {
    setPage(pagination.current);
    const newClientId =
      tableFilters.clientId && tableFilters.clientId.length > 0
        ? tableFilters.clientId[0]
        : null;
    const newIsFavorite =
      tableFilters.isFavorite && tableFilters.isFavorite.includes("true");

    setFilters({
      clientId: newClientId,
      category: filters.category,
      isFavorite: newIsFavorite,
    });
  };

  React.useEffect(() => {
    authFetch(`${API_URL}/clients`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setClients(data))
      .catch(() => setClients([]));
  }, [API_URL]);

  const load = React.useCallback(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      ts: String(Date.now()),
    });
    if (filters.clientId) params.append("clientId", filters.clientId);
    if (filters.category) params.append("category", filters.category);
    if (filters.isFavorite) params.append("isFavorite", "true");

    authFetch(`${API_URL}/screenshots?${params.toString()}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json) {
          setItems(json.data || []);
          setTotal(json.total || 0);
        }
      })
      .catch(() => {
        /* keep previous */
      });
  }, [API_URL, filters, page, pageSize]);
  React.useEffect(() => {
    load();
  }, [load]);

  const toggleFavorite = React.useCallback(
    async (id, currentStatus) => {
      const newStatus = !currentStatus;
      try {
        const res = await authFetch(`${API_URL}/screenshots/${id}/favorite`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isFavorite: newStatus }),
        });
        if (res.ok) {
          setItems((prev) =>
            prev.map((item) =>
              item.id === id ? { ...item, isFavorite: newStatus } : item,
            ),
          );
        }
      } catch (e) {
        console.error(e);
      }
    },
    [API_URL],
  );

  const openFile = React.useCallback(
    async (id) => {
      const url = `${API_URL}/screenshots/${id}/file?ts=${Date.now()}`;
      const res = await authFetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      window.open(objUrl, "_blank");
    },
    [API_URL],
  );

  const downloadFile = React.useCallback(
    async (id, filename) => {
      const url = `${API_URL}/screenshots/${id}/file?ts=${Date.now()}`;
      const res = await authFetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename || `screenshot_${id}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    },
    [API_URL],
  );

  const categoryOptions = React.useMemo(() => {
    const set = new Set();
    clients.forEach((c) => {
      const v = String(c?.category || "").trim();
      if (v) set.add(v);
    });
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
  }, [clients]);

  const visibleClients = React.useMemo(() => {
    if (!filters.category) return clients;
    return clients.filter(
      (c) => String(c?.category || "") === String(filters.category),
    );
  }, [clients, filters.category]);

  const columns = React.useMemo(
    () => [
      {
        title: "",
        key: "isFavorite",
        width: 50,
        filters: [
          { text: t("common.favorites") || "Favorites", value: "true" },
        ],
        filteredValue: filters.isFavorite ? ["true"] : null,
        render: (_, rec) => (
          <Button
            type="text"
            icon={
              rec.isFavorite ? (
                <StarFilled style={{ color: "#faad14" }} />
              ) : (
                <StarOutlined />
              )
            }
            onClick={() => toggleFavorite(rec.id, rec.isFavorite)}
          />
        ),
      },
      {
        title: t("common.time"),
        dataIndex: "timestamp",
        render: (value) =>
          new Date(value).toLocaleString(
            i18n.language === "uz" ? "uz-UZ" : "ru-RU",
            {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            },
          ),
      },
      {
        title: t("common.client"),
        dataIndex: "clientId",
        key: "clientId",
        filters: visibleClients.map((c) => ({
          text: c.id,
          value: c.id,
        })),
        filteredValue: filters.clientId ? [filters.clientId] : null,
        filterMultiple: false,
      },
      { title: t("common.file"), dataIndex: "filename" },
      {
        title: t("common.action"),
        render: (_, rec) => (
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={() => openFile(rec.id)}>{t("common.open")}</Button>
            <Button onClick={() => downloadFile(rec.id, rec.filename)}>
              {t("common.download")}
            </Button>
          </div>
        ),
      },
    ],
    [
      t,
      i18n.language,
      filters,
      visibleClients,
      downloadFile,
      openFile,
      toggleFavorite,
    ],
  );

  return (
    <List title={t("screenshots.title")}>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear
          style={{ minWidth: 240 }}
          placeholder={t("common.category")}
          value={filters.category}
          options={categoryOptions.map((c) => ({ label: c, value: c }))}
          onChange={(v) => {
            setPage(1);
            setFilters((prev) => ({
              ...prev,
              category: v || null,
              clientId: null,
            }));
          }}
        />
      </Space>
      <Table
        rowKey="id"
        dataSource={Array.isArray(items) ? items : []}
        size="large"
        onChange={handleTableChange}
        pagination={{
          current: page,
          pageSize,
          total,
        }}
        columns={columns}
      />
    </List>
  );
}
