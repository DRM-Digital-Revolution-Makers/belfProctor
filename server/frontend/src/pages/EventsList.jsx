import React from "react";
import { List } from "@refinedev/antd";
import { Table } from "antd";
import { authFetch } from "../dataProvider.js";

export default function EventsList() {
  const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8080/api`;
  const [items, setItems] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const pageSize = 50;

  const load = () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    authFetch(`${API_URL}/events?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => { setItems(json.data || []); setTotal(json.total || 0); })
      .catch(() => { setItems([]); setTotal(0); });
  };
  React.useEffect(load, [page]);

  return (
    <List title="События">
      <Table
        rowKey="id"
        dataSource={Array.isArray(items) ? items : []}
        size="large"
        pagination={{ current: page, pageSize, total, onChange: (p) => setPage(p) }}
        columns={[
          { title: "Время", dataIndex: "timestamp" },
          { title: "Тип", dataIndex: "eventType" },
          { title: "Описание", dataIndex: "description" },
          { title: "Процесс", dataIndex: "processName" },
          { title: "Устройство", dataIndex: "deviceId" },
          { title: "Сеть", dataIndex: "networkAddress" },
        ]}
      />
    </List>
  );
}
