import React from "react";
import { List } from "@refinedev/antd";
import { Table } from "antd";

export default function ClientsList() {
  const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8080/api`;
  const [data, setData] = React.useState([]);
  React.useEffect(() => {
    const token = localStorage.getItem("token");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`${API_URL}/clients`, { headers })
      .then(async (r) => {
        if (!r.ok) throw new Error("unauthorized");
        return r.json();
      })
      .then((json) => {
        setData(Array.isArray(json) ? json : []);
      })
      .catch(() => setData([]));
  }, []);
  return (
    <List title="Клиенты">
      <Table rowKey="id" dataSource={Array.isArray(data) ? data : []} pagination={false} size="small" columns={[
        { title: "ClientId", dataIndex: "id" },
        { title: "Создан", dataIndex: "createdAt" },
        { title: "Обновлён", dataIndex: "updatedAt" },
      ]} />
    </List>
  );
}