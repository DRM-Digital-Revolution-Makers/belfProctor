import React from "react";
import { List } from "@refinedev/antd";
import { Table, Button } from "antd";

export default function ScreenshotsList() {
  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
  const [items, setItems] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const pageSize = 20;

  const load = () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    fetch(`${API_URL}/screenshots?${params.toString()}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then((r) => r.json())
      .then((json) => { setItems(json.data || []); setTotal(json.total || 0); });
  };
  React.useEffect(load, [page]);

  const openFile = async (id) => {
    const res = await fetch(`${API_URL}/screenshots/${id}/file`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  return (
    <List title="Скриншоты">
      <Table
        rowKey="id"
        dataSource={items}
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