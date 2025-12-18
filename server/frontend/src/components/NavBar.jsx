import React from "react";
import { Layout, Menu, Select } from "antd";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function NavBar() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const key =
    location.pathname === "/"
      ? "/events"
      : "/" + location.pathname.split("/")[1];
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
          <Link to="/" style={{ color: "inherit" }}>
            BelfProctor
          </Link>
        </div>
        <Menu
          style={{ display: "flex", justifyContent: "center" }}
          mode="horizontal"
          selectedKeys={[key]}
          items={[
            {
              key: "/events",
              label: <Link to="/events">{t("nav.events")}</Link>,
            },
            {
              key: "/clients",
              label: <Link to="/clients">{t("nav.clients")}</Link>,
            },
            {
              key: "/activity",
              label: <Link to="/activity">{t("nav.activity")}</Link>,
            },
            {
              key: "/screenshots",
              label: <Link to="/screenshots">{t("nav.screenshots")}</Link>,
            },
          ]}
        />
        <div>
          <Select
            value={i18n.language}
            onChange={(value) => i18n.changeLanguage(value)}
            options={[
              { value: "ru", label: "Русский" },
              { value: "uz", label: "O'zbek" },
            ]}
            style={{ width: 100 }}
          />
        </div>
      </div>
    </Layout.Header>
  );
}
