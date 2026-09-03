export const customDataProvider = (apiUrl) => ({
  getList: async ({ resource, pagination }) => {
    const page = pagination?.current || 1;
    const pageSize = pagination?.pageSize || 20;
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    const res = await authFetch(`${apiUrl}/${resource}?${params.toString()}`);
    const json = await res.json();
    return { data: json.data || [], total: json.total || 0 };
  },
  getOne: async ({ resource, id }) => {
    const res = await authFetch(`${apiUrl}/${resource}/${id}`);
    const json = await res.json();
    return { data: json };
  },
});

export const authFetch = async (url, options = {}) => {
  const headers = options.headers || {};
  const res = await fetch(url, { credentials: "same-origin", ...options, headers });
  if (res.status === 401) {
    window.dispatchEvent(new Event("auth:changed"));
  }
  return res;
};
