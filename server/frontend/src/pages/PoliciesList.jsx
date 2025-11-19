import React from "react";
import { List } from "@refinedev/antd";
import { Table } from "antd";

export default function PoliciesList() {
  const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8080/api`;
  const [items, setItems] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const pageSize = 200;

  const load = () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    const token = localStorage.getItem("token");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`${API_URL}/policies?${params.toString()}`, { headers })
      .then((r) => r.json())
      .then((json) => { setItems(json.data || []); setTotal(json.total || 0); })
      .catch(() => { setItems([]); setTotal(0); });
  };
  React.useEffect(load, [page]);

  return (
    <List title="Политики">
      <Table
        rowKey="id"
        dataSource={Array.isArray(items) ? items : []}
        size="large"
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