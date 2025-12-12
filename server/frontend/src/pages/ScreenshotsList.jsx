import React from "react";
import { List } from "@refinedev/antd";
import { Table, Button } from "antd";
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
  const pageSize = 50;

  const load = () => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      ts: String(Date.now()),
    });
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
  };
  React.useEffect(load, [page]);

  const openFile = async (id) => {
    const url = `${API_URL}/screenshots/${id}/file?ts=${Date.now()}`;
    const res = await authFetch(url, { cache: "no-store" });
    if (!res.ok) return;
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    window.open(objUrl, "_blank");
  };

  const downloadFile = async (id, filename) => {
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
  };

  return (
    <List title={t("screenshots.title")}>
      <Table
        rowKey="id"
        dataSource={Array.isArray(items) ? items : []}
        size="large"
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: (p) => setPage(p),
        }}
        columns={[
          {
            title: t("common.time"),
            dataIndex: "timestamp",
            render: (value) =>
              new Date(value).toLocaleString(
                i18n.language === "uz" ? "uz-UZ" : "ru-RU",
                {
                  timeZone: "Asia/Tashkent",
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }
              ),
          },
          { title: t("common.client"), dataIndex: "clientId" },
          { title: t("common.file"), dataIndex: "filename" },
          {
            title: t("common.action"),
            render: (_, rec) => (
              <div style={{ display: "flex", gap: 8 }}>
                <Button onClick={() => openFile(rec.id)}>
                  {t("common.open")}
                </Button>
                <Button onClick={() => downloadFile(rec.id, rec.filename)}>
                  {t("common.download")}
                </Button>
              </div>
            ),
          },
        ]}
      />
    </List>
  );
}
