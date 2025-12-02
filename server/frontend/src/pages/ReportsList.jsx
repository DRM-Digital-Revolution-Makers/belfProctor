import React from "react";
import { List } from "@refinedev/antd";
import { Table, Button } from "antd";
import { authFetch } from "../dataProvider.js";

export default function ReportsList() {
  const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8080/api`;
  const [items, setItems] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const pageSize = 50;

  const load = () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    authFetch(`${API_URL}/reports?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => { setItems(json.data || []); setTotal(json.total || 0); })
      .catch(() => { setItems([]); setTotal(0); });
  };
  React.useEffect(load, [page]);

  const openFile = async (id) => {
    const res = await authFetch(`${API_URL}/reports/${id}/file`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  return (
    <List title="Отчёты">
      <Table
        rowKey="id"
        dataSource={Array.isArray(items) ? items : []}
        size="large"
        pagination={{ current: page, pageSize, total, onChange: (p) => setPage(p) }}
        columns={[
          { title: "Время", dataIndex: "timestamp" },
          { title: "Клиент", dataIndex: "clientId" },
          { title: "Файл", dataIndex: "filename" },
          { title: "Действие", render: (_, rec) => (<Button onClick={() => openFile(rec.id)}>Открыть</Button>) },
        ]}
      />
    </List>
  );
}
