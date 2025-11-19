import React from "react";
import { Layout, Menu } from "antd";
import { Link, useLocation } from "react-router-dom";

export default function NavBar() {
  const location = useLocation();
  const key = location.pathname === "/" ? "/events" : "/" + location.pathname.split("/")[1];
  return (
    <Layout.Header style={{ background: "#fff", paddingInline: 24 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          alignItems: "center",
          gap: 24,
        }}
      >
        <div style={{ fontWeight: 600 }}>
          <Link to="/" style={{ color: "inherit" }}>BelfProctor</Link>
        </div>
          <Menu
          style={{ display: "flex", justifyContent: "center" }}
            mode="horizontal"
            selectedKeys={[key]}
            items={[
              { key: "/events", label: <Link to="/events">События</Link> },
              { key: "/clients", label: <Link to="/clients">Клиенты</Link> },
              { key: "/screenshots", label: <Link to="/screenshots">Скриншоты</Link> },
              { key: "/reports", label: <Link to="/reports">Отчёты</Link> },
              { key: "/policies", label: <Link to="/policies">Политики</Link> },
            ]}
          />
        <div/>
      </div>
    </Layout.Header>
  );
}