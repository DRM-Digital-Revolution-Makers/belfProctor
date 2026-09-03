import React from "react";
import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/react-router";
import { RefineThemes } from "@refinedev/antd";
import { ConfigProvider, Layout } from "antd";
import ruRU from "antd/locale/ru_RU";
import { Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "./components/Sidebar.jsx";

import ClientsList from "./pages/ClientsList.jsx";
import ClientDetail from "./pages/ClientDetail.jsx";
import EventsList from "./pages/EventsList.jsx";
import ScreenshotsList from "./pages/ScreenshotsList.jsx";
import ActivitiesList from "./pages/ActivitiesList.jsx";
import ActivityDetail from "./pages/ActivityDetail.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import Timesheet from "./pages/Timesheet.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import { customDataProvider } from "./dataProvider.js";

const API_URL =
  import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8080/api`;

const bpTheme = {
  ...RefineThemes.Blue,
  token: {
    ...(RefineThemes.Blue?.token || {}),
    colorPrimary: "#267E26",
    colorInfo: "#22408C",
    colorSuccess: "#267E26",
    colorWarning: "#F59E0B",
    colorError: "#DC2626",
    colorBgBase: "#FFFFFF",
    colorBgContainer: "#FFFFFF",
    colorBgLayout: "#FFFFFF",
    colorText: "#000000",
    colorTextSecondary: "#707070",
    borderRadius: 12,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "SF Pro", "Helvetica Neue", Arial, sans-serif',
    fontSize: 15,
  },
  components: {
    ...(RefineThemes.Blue?.components || {}),
    Layout: {
      bodyBg: "#FFFFFF",
      headerBg: "#FFFFFF",
      siderBg: "#F7F7F7",
    },
    Menu: {
      itemBg: "transparent",
      itemSelectedBg: "transparent",
      itemSelectedColor: "#267E26",
      itemHoverBg: "rgba(0,0,0,0.04)",
      itemColor: "#707070",
      itemBorderRadius: 50,
    },
    Button: {
      borderRadius: 50,
    },
    Card: {
      borderRadiusLG: 16,
    },
  },
};

export default function App() {
  const [authed, setAuthed] = React.useState(
    Boolean(localStorage.getItem("token")),
  );
  React.useEffect(() => {
    const handler = () => setAuthed(Boolean(localStorage.getItem("token")));
    window.addEventListener("auth:changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("auth:changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  if (!authed) {
    return (
      <ConfigProvider theme={bpTheme} locale={ruRU}>
        <Layout style={{ minHeight: "100vh", background: "#FFFFFF" }}>
          <Layout.Content style={{ padding: 24 }}>
            <LoginPage onSuccess={() => setAuthed(true)} />
          </Layout.Content>
        </Layout>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider theme={bpTheme} locale={ruRU}>
      <Refine
        routerProvider={routerProvider}
        dataProvider={customDataProvider(API_URL)}
        options={{
          disableTelemetry: true,
          syncWithLocation: true,
          warnWhenUnsavedChanges: true,
          useNewQueryKeys: true,
          projectId: "some-id",
        }}
        resources={[
          { name: "home", list: "/" },
          { name: "clients", list: "/clients" },
          { name: "screenshots", list: "/screenshots" },
          { name: "report", list: "/report" },
          { name: "settings", list: "/settings" },
        ]}
      >
        <Layout
          className="bp-app-shell"
          style={{
            minHeight: "100vh",
            background: "#FFFFFF",
            padding: 32,
            gap: 20,
          }}
        >
          <Sidebar />
          <Layout className="bp-main-shell" style={{ background: "#FFFFFF" }}>
            <Layout.Content className="bp-main-content" style={{ background: "#FFFFFF" }}>
              <Routes>
                <Route path="/" element={<EventsList />} />
                <Route path="clients" element={<ClientsList />} />
                <Route path="clients/:id" element={<ClientDetail />} />
                <Route path="events" element={<Navigate to="/" replace />} />
                <Route path="activity" element={<ActivitiesList />} />
                <Route path="activity/:clientId" element={<ActivityDetail />} />
                <Route path="screenshots" element={<ScreenshotsList />} />
                <Route path="report" element={<Timesheet />} />
                <Route path="timesheet" element={<Navigate to="/report" replace />} />
                <Route path="settings" element={<SettingsPage />} />
              </Routes>
            </Layout.Content>
          </Layout>
        </Layout>
      </Refine>
    </ConfigProvider>
  );
}
