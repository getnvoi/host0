import axios from "axios";
import { transport } from "@/contexts/api/transport";

// One instance for the plane's api, wherever the transport says it is. A 401 means the session ended.
export const api = axios.create({ headers: { Accept: "application/json", "Content-Type": "application/json" } });

api.interceptors.request.use((config) => {
  const t = transport();
  config.baseURL ??= t.base;
  for (const [k, v] of Object.entries(t.headers())) config.headers.set(k, v);
  if (t.fetch) {
    config.adapter = "fetch";
    config.env = { ...config.env, fetch: t.fetch };
  }
  return config;
});

api.interceptors.response.use(undefined, (error) => {
  if (axios.isAxiosError(error) && error.response?.status === 401) transport().signedOut();
  return Promise.reject(error);
});
