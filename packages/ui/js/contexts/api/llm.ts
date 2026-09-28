import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/contexts/api/client";
import type { LlmConfig, Provider } from "@/contexts/api/types";

export const configsKey = ["llm", "configs"] as const;
const path = (name: string) => `/llm/configs/${encodeURIComponent(name)}`;

export function useProviders() {
  return useQuery({ queryKey: ["llm", "providers"], queryFn: async () => (await api.get<Provider[]>("/llm/providers")).data, staleTime: Infinity });
}

export function useConfigs() {
  return useQuery({ queryKey: configsKey, queryFn: async () => (await api.get<LlmConfig[]>("/llm/configs")).data });
}

// Every write changes which row is in use, so the list is read again after each.
function useWrite<T>(fn: (input: T) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => client.invalidateQueries({ queryKey: configsKey }) });
}

export const useAddConfig = () =>
  useWrite((c: { name: string; provider: string; values: Record<string, string> }) => api.post<LlmConfig>("/llm/configs", c));
export const useUpdateConfig = () =>
  useWrite((c: { name: string; values: Record<string, string> }) => api.put<LlmConfig>(path(c.name), { values: c.values }));
export const useUseConfig = () => useWrite((name: string) => api.post(`${path(name)}/main`));
export const useArchiveConfig = () => useWrite((name: string) => api.delete(path(name)));
export const useRestoreConfig = () => useWrite((name: string) => api.post(`${path(name)}/restore`));
export const useRemoveConfig = () => useWrite((name: string) => api.delete(path(name), { params: { remove: 1 } }));
