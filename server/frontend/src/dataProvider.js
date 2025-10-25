export const customDataProvider = (apiUrl) => ({
  getList: async ({ resource, pagination }) => {
    const page = pagination?.current || 1;
    const pageSize = pagination?.pageSize || 20;
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    const res = await fetch(`${apiUrl}/${resource}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
    });
    const json = await res.json();
    return { data: json.data || [], total: json.total || 0 };
  },
  getOne: async ({ resource, id }) => {
    const res = await fetch(`${apiUrl}/${resource}/${id}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
    });
    const json = await res.json();
    return { data: json };
  },
});