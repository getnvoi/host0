import axios from "axios";

// One instance for the plane's /api. Every write carries X-Requested-With, which the plane requires of a browser:
// no cross-site form can set it. A 401 means the session ended; the app sends the reader to sign in again.
export const api = axios.create({
  baseURL: "/api",
  headers: { Accept: "application/json", "Content-Type": "application/json", "X-Requested-With": "nvoi" },
});

api.interceptors.response.use(undefined, (error) => {
  if (axios.isAxiosError(error) && error.response?.status === 401 && location.pathname !== "/login") {
    location.assign("/login");
  }
  return Promise.reject(error);
});
