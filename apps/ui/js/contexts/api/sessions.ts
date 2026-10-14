import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/contexts/api/client";
import type { Approval, Changes, Environment, LogSource, Me, PreviewStatus, Session, Summary, Terminal, Usage } from "@/contexts/api/types";

export const sessionsKey = ["sessions"] as const;
export const sessionKey = (id: string) => ["session", id] as const;
export const queueKey = (id: string) => ["queue", id] as const;
export const approvalsKey = ["approvals"] as const;
export const environmentsKey = ["environments"] as const;
export const changesKey = (id: string) => ["changes", id] as const;
export const terminalsKey = (id: string) => ["terminals", id] as const;

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: async () => (await api.get<Me>("/me")).data, staleTime: Infinity });
}

export function useSessions() {
  return useQuery({ queryKey: sessionsKey, queryFn: async () => (await api.get<Summary[]>("/sessions")).data });
}

export function useSession(id: string) {
  return useQuery({ queryKey: sessionKey(id), queryFn: async () => (await api.get<Session>(`/sessions/${id}`)).data });
}

export function useQueue(id: string) {
  return useQuery({ queryKey: queueKey(id), queryFn: async () => (await api.get<string[]>(`/sessions/${id}/queue`)).data });
}

// Every pending approval: the board needs them all, a session filters its own.
export function useApprovals() {
  return useQuery({ queryKey: approvalsKey, queryFn: async () => (await api.get<Approval[]>("/approvals")).data });
}

export function useEnvironments() {
  return useQuery({ queryKey: environmentsKey, queryFn: async () => (await api.get<Environment[]>("/environments")).data });
}

export function useChanges(id: string) {
  return useQuery({
    queryKey: changesKey(id),
    queryFn: async () => (await api.get<Changes>(`/sessions/${id}/changes`, { timeout: 120_000 })).data,
    staleTime: 0,
  });
}

export function useLogSources(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["logs", id],
    queryFn: async () => (await api.get<LogSource[]>(`/sessions/${id}/logs`)).data,
    enabled,
  });
}

export async function readLog(id: string, name: string, offset: number) {
  const res = await api.get<string>(`/sessions/${id}/logs/${encodeURIComponent(name)}`, {
    params: { offset },
    responseType: "text",
    transformResponse: (d) => d,
  });
  return { text: res.data, next: Number(res.headers["x-offset"] ?? offset + res.data.length) };
}

export function useTerminals(id: string) {
  return useQuery({
    queryKey: terminalsKey(id),
    queryFn: async () => (await api.get<Terminal[]>(`/sessions/${id}/terminals`)).data,
    staleTime: 0,
  });
}

export async function killTerminal(id: string, tid: string) {
  await api.delete(`/sessions/${id}/terminals/${tid}`);
}

export function useStart() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { env: string; prompt: string }) => (await api.post<Session>("/sessions", input)).data,
    onSuccess: () => client.invalidateQueries({ queryKey: sessionsKey }),
  });
}

export function useSay(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { prompt: string; to?: string }) => {
      await api.post(`/sessions/${id}/turns`, input);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: queueKey(id) }),
  });
}

export function useUnqueue(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ index, text }: { index: number; text: string }) => {
      await api.delete(`/sessions/${id}/queue/${index}`, { data: { text } });
    },
    onSettled: () => client.invalidateQueries({ queryKey: queueKey(id) }),
  });
}

export function useStop(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.post(`/sessions/${id}/stop`);
    },
    // What was queued stays queued after a stop: the list is read again so it can be withdrawn.
    onSettled: () => {
      client.invalidateQueries({ queryKey: queueKey(id) });
      client.invalidateQueries({ queryKey: sessionKey(id) });
    },
  });
}

// Any 2xx is taken, 202 with no body included: the approvals are read again rather than taken from the reply.
export function useDecide() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      await api.post(`/approvals/${id}/${approve ? "approve" : "deny"}`);
    },
    onSettled: () => client.invalidateQueries({ queryKey: approvalsKey }),
  });
}

export async function previewLink(host: string) {
  return (await api.post<{ url: string }>("/previews", { host })).data.url;
}

export async function signOut() {
  await api.post("/logout", undefined, { baseURL: "/api" }).catch(() => {});
  location.assign("/login");
}

export function useUsage(days: number, by?: string) {
  return useQuery({
    queryKey: ["usage", days, by ?? ""],
    queryFn: async () => (await api.get<Usage>("/usage", { params: { days, by: by || undefined } })).data,
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  });
}

// Whether the session's app answers: every 10 seconds until it does, every minute after. The check wakes a paused
// sandbox, and stops while the page is hidden.
export function usePreviewStatus(id: string) {
  return useQuery({
    queryKey: ["preview", id],
    queryFn: async () => (await api.get<PreviewStatus>(`/sessions/${id}/preview`, { timeout: 60_000 })).data,
    refetchInterval: (q) => (q.state.data?.up ? 60_000 : 10_000),
    staleTime: 0,
  });
}
