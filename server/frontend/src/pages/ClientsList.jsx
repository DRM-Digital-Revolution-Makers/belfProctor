import React from "react";
import { List } from "@refinedev/antd";
import { Table } from "antd";

export default function ClientsList() {
  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
  const [data, setData] = React.useState([]);
  React.useEffect(() => {
    fetch(`${API_URL}/clients`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then((r) => r.json())
      .then(setData);
  }, []);
  return (
    <List title="Клиенты">
      <Table rowKey="id" dataSource={data} pagination={false} columns={[
        { title: "ClientId", dataIndex: "id" },
        { title: "Создан", dataIndex: "createdAt" },
        { title: "Обновлён", dataIndex: "updatedAt" },
      ]} />
    </List>
  );
}