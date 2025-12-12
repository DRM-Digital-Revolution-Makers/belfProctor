import React from "react";
import { List } from "@refinedev/antd";
import { Table, Button } from "antd";
import { useTranslation } from "react-i18next";
import { authFetch } from "../dataProvider.js";

export default function ReportsList() {
  const { t } = useTranslation();
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
    });
    authFetch(`${API_URL}/reports?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => {
        setItems(json.data || []);
        setTotal(json.total || 0);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      });
  };
  React.useEffect(load, [page]);

  const openFile = async (id, filename) => {
    const res = await authFetch(`${API_URL}/reports/${id}/csv`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      (filename ? filename.replace(/\.[^.]+$/, "") : `report_${id}`) + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <List title={t("reports.title")}>
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
          { title: t("common.time"), dataIndex: "timestamp" },
          { title: t("common.client"), dataIndex: "clientId" },
          { title: t("common.file"), dataIndex: "filename" },
          {
            title: t("common.action"),
            render: (_, rec) => (
              <Button onClick={() => openFile(rec.id, rec.filename)}>
                {t("common.downloadCsv")}
              </Button>
            ),
          },
        ]}
      />
    </List>
  );
}
