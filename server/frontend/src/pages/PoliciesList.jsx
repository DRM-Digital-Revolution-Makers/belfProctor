import React from "react";
import { List } from "@refinedev/antd";
import { Table } from "antd";

export default function PoliciesList() {
  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
  const [items, setItems] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const pageSize = 20;

  const load = () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    fetch(`${API_URL}/policies?${params.toString()}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then((r) => r.json())
      .then((json) => { setItems(json.data || []); setTotal(json.total || 0); });
  };
  React.useEffect(load, [page]);

  return (
    <List title="Политики">
      <Table
        rowKey="id"
        dataSource={items}
        pagination={{ current: page, pageSize, total, onChange: (p) => setPage(p) }}
        columns={[
          { title: "Тип", dataIndex: "policyType" },
          { title: "Версия", dataIndex: "version" },
          { title: "Обновлено", dataIndex: "updatedAt" },
        ]}
      />
    </List>
  );
}