import React from "react";
import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/react-router";
//
import { RefineThemes } from "@refinedev/antd";
import { ConfigProvider, Layout } from "antd";
import { Routes, Route } from "react-router-dom";
import NavBar from "./components/NavBar.jsx";

import ClientsList from "./pages/ClientsList.jsx";
import ClientDetail from "./pages/ClientDetail.jsx";
import EventsList from "./pages/EventsList.jsx";
import ScreenshotsList from "./pages/ScreenshotsList.jsx";
import ActivitiesList from "./pages/ActivitiesList.jsx";
import ActivityDetail from "./pages/ActivityDetail.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import { customDataProvider } from "./dataProvider.js";

const API_URL =
  import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8080/api`;

export default function App() {
  const [authed, setAuthed] = React.useState(
    Boolean(localStorage.getItem("token"))
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
      <ConfigProvider theme={RefineThemes.Blue}>
        <Layout style={{ minHeight: "100vh" }}>
          <Layout.Content style={{ padding: 24 }}>
            <LoginPage onSuccess={() => setAuthed(true)} />
          </Layout.Content>
        </Layout>
      </ConfigProvider>
    );
  }
  return (
    <ConfigProvider theme={RefineThemes.Blue}>
      <Refine
        routerProvider={routerProvider}
        dataProvider={customDataProvider(API_URL)}
        // authProvider disabled to skip login temporarily
        resources={[
          { name: "clients", list: "/clients" },
          { name: "events", list: "/events" },
          { name: "activity", list: "/activity" },
          { name: "screenshots", list: "/screenshots" },
        ]}
      >
        <Layout style={{ minHeight: "100vh" }}>
          <NavBar />
          <Layout.Content style={{ padding: 24 }}>
            <Routes>
              <Route path="/" element={<EventsList />} />
              <Route path="clients" element={<ClientsList />} />
              <Route path="clients/:id" element={<ClientDetail />} />
              <Route path="events" element={<EventsList />} />
              <Route path="activity" element={<ActivitiesList />} />
              <Route path="activity/:clientId" element={<ActivityDetail />} />
              <Route path="screenshots" element={<ScreenshotsList />} />
            </Routes>
          </Layout.Content>
        </Layout>
      </Refine>
    </ConfigProvider>
  );
}
