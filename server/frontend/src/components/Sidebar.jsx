import React from "react";
import { Layout, Tooltip } from "antd";
import { Icon } from "@iconify/react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

const COLLAPSED_KEY = "bp_sidebar_collapsed";

function NavItem({ to, icon, label, active, collapsed }) {
  const content = (
    <Link
      to={to}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: 12,
        borderRadius: 50,
        color: active ? "var(--bp-accent-strong)" : "var(--bp-text-muted)",
        textDecoration: "none",
        fontSize: 16,
        fontWeight: 510,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "SF Pro", "Helvetica Neue", Arial, sans-serif',
        whiteSpace: "nowrap",
        overflow: "hidden",
        justifyContent: collapsed ? "center" : "flex-start",
        transition: "color 0.12s ease, background 0.12s ease",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "rgba(0,0,0,0.04)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <Icon icon={icon} width={30} height={30} />
      {!collapsed && <span>{label}</span>}
    </Link>
  );
  if (collapsed) {
    return (
      <Tooltip title={label} placement="right">
        {content}
      </Tooltip>
    );
  }
  return content;
}

export default function Sidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const [collapsed, setCollapsed] = React.useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "1",
  );

  React.useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const path = location.pathname;
  const isHome = path === "/" || path.startsWith("/events");
  const isClients =
    path.startsWith("/clients") || path.startsWith("/screenshots");
  const isReport =
    path.startsWith("/report") ||
    path.startsWith("/timesheet") ||
    path.startsWith("/activity");
  const isSettings = path.startsWith("/settings");

  return (
    <Layout.Sider
      collapsible
      collapsed={collapsed}
      onCollapse={setCollapsed}
      trigger={null}
      width={240}
      collapsedWidth={80}
      className="bp-sidebar"
      style={{
        background: "var(--bp-sidebar-bg)",
        padding: collapsed ? "28px 12px" : 28,
        boxShadow: "var(--bp-shadow-card)",
        borderRadius: 50,
        position: "sticky",
        top: 32,
        height: "calc(100vh - 64px)",
        overflowY: "auto",
        transition: "padding 0.2s ease, width 0.2s ease",
        marginRight: 0,
        flex: "0 0 auto",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "space-between",
        }}
      >
        {/* Top: Logo + Menu */}
        <div
          style={{ display: "flex", flexDirection: "column", gap: 52 }}
        >
          {/* Logo */}
          <div
            style={{
              display: "flex",
              justifyContent: collapsed ? "center" : "flex-start",
            }}
          >
            <Link
              to="/"
              className="bp-sidebar-logo"
              style={{
                color: "inherit",
                textDecoration: "none",
                whiteSpace: "nowrap",
                overflow: "hidden",
              }}
            >
              {collapsed ? "BP" : "BelfProctor"}
            </Link>
          </div>

          {/* Menu group: label + items */}
          <div
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {!collapsed && (
              <div
                style={{
                  padding: "0 12px",
                  fontSize: 16,
                  fontFamily: "inherit",
                  fontVariantCaps: "small-caps",
                  fontWeight: 400,
                  color: "var(--bp-text-muted)",
                }}
              >
                {t("nav.menu")}
              </div>
            )}
            <div
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <NavItem
                to="/"
                icon="solar:home-bold-duotone"
                label={t("nav.home")}
                active={isHome}
                collapsed={collapsed}
              />
              <NavItem
                to="/clients"
                icon="solar:users-group-two-rounded-bold-duotone"
                label={t("nav.clients")}
                active={isClients}
                collapsed={collapsed}
              />
              <NavItem
                to="/report"
                icon="solar:document-bold-duotone"
                label={t("nav.report")}
                active={isReport}
                collapsed={collapsed}
              />
            </div>
          </div>
        </div>

        {/* Bottom: Collapse + General */}
        <div
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          {/* Collapse toggle */}
          <Tooltip
            title={collapsed ? t("nav.expand") : ""}
            placement="right"
          >
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: 12,
                borderRadius: 50,
                border: "none",
                background: "transparent",
                color: "var(--bp-accent-strong)",
                fontSize: 16,
                fontWeight: 510,
                fontFamily: "inherit",
                cursor: "pointer",
                whiteSpace: "nowrap",
                justifyContent: collapsed ? "center" : "flex-start",
              }}
            >
              <Icon
                icon="solar:send-square-bold-duotone"
                width={30}
                height={30}
                style={{
                  transform: collapsed ? "rotate(180deg)" : "none",
                  transition: "transform 0.2s ease",
                }}
              />
              {!collapsed && <span>{t("nav.collapse")}</span>}
            </button>
          </Tooltip>

          {/* General group */}
          <div
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {!collapsed && (
              <div
                style={{
                  padding: "0 12px",
                  fontSize: 16,
                  fontFamily: "inherit",
                  fontVariantCaps: "small-caps",
                  fontWeight: 400,
                  color: "var(--bp-text-muted)",
                }}
              >
                {t("nav.general")}
              </div>
            )}
            <div
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <NavItem
                to="/settings"
                icon="solar:settings-bold-duotone"
                label={t("nav.settings")}
                active={isSettings}
                collapsed={collapsed}
              />
            </div>
          </div>
        </div>
      </div>
    </Layout.Sider>
  );
}
