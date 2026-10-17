"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { API_URL, api, type Config } from "./api";

export interface LiveEvent {
  id: number;
  name: string;
  data: unknown;
}

interface LiveState {
  config: Config | null;
  connected: boolean;
  subscribe: (fn: (e: LiveEvent) => void) => () => void;
}

const Ctx = createContext<LiveState>({ config: null, connected: false, subscribe: () => () => {} });

export function LiveProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set<(e: LiveEvent) => void>());

  useEffect(() => {
    let alive = true;
    const loadConfig = () => api<Config>("/config").then((c) => alive && setConfig(c)).catch(() => alive && setTimeout(loadConfig, 3000));
    loadConfig();
    const es = new EventSource(`${API_URL}/events`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    const names = ["intent.updated", "trace.step", "approval.created", "approval.updated", "audit.appended", "mandate.updated", "chat.message", "attack.progress", "system"];
    for (const name of names) {
      es.addEventListener(name, (ev) => {
        const me = ev as MessageEvent<string>;
        let data: unknown = me.data;
        try {
          data = JSON.parse(me.data);
        } catch {
          // plain text event
        }
        const e: LiveEvent = { id: Number(me.lastEventId), name, data };
        for (const fn of listeners.current) fn(e);
      });
    }
    return () => {
      alive = false;
      es.close();
    };
  }, []);

  const subscribe = (fn: (e: LiveEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  };

  return <Ctx.Provider value={{ config, connected, subscribe }}>{children}</Ctx.Provider>;
}

export function useConfig(): Config | null {
  return useContext(Ctx).config;
}

export function useConnected(): boolean {
  return useContext(Ctx).connected;
}

/** Re-runs `fn` when any of the named events arrives. */
export function useLive(names: string[], fn: (e: LiveEvent) => void): void {
  const { subscribe } = useContext(Ctx);
  const ref = useRef(fn);
  ref.current = fn;
  const key = names.join(",");
  useEffect(() => {
    const off = subscribe((e) => {
      if (names.includes(e.name)) ref.current(e);
    });
    return () => {
      off();
    };
  }, [subscribe, key]); // eslint-disable-line react-hooks/exhaustive-deps
}
