import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  eventToShortcutBinding,
  normalizeKeyboardShortcutSettings,
  shortcutBindingSignature,
  type KeyboardShortcutSettings,
  type ShortcutActionId,
} from "./keyboardShortcuts";

type ShortcutHandler = (event: KeyboardEvent) => void | boolean;

type ShortcutLayer = {
  priority: number;
  enabled?: boolean;
  allowInEditable?: boolean;
  handlers: Partial<Record<ShortcutActionId, ShortcutHandler>>;
};

type ShortcutLayerGetter = () => ShortcutLayer | null;

type ShortcutRouterContextValue = {
  bindings: KeyboardShortcutSettings;
  setBindings: (value: unknown) => void;
  registerLayer: (getter: ShortcutLayerGetter) => () => void;
};

type ShortcutRouterProviderProps = {
  children: React.ReactNode;
};

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

const ShortcutRouterContext = createContext<ShortcutRouterContextValue | null>(null);

export function ShortcutRouterProvider({ children }: ShortcutRouterProviderProps) {
  const [bindings, setBindingsState] = useState<KeyboardShortcutSettings>(() => normalizeKeyboardShortcutSettings(null));
  const gettersRef = useRef<Array<{ order: number; getter: ShortcutLayerGetter }>>([]);
  const nextOrderRef = useRef(1);

  const setBindings = (value: unknown) => {
    setBindingsState(normalizeKeyboardShortcutSettings(value));
  };

  const registerLayer = (getter: ShortcutLayerGetter) => {
    const entry = { order: nextOrderRef.current++, getter };
    gettersRef.current = [...gettersRef.current, entry];
    return () => {
      gettersRef.current = gettersRef.current.filter((item) => item !== entry);
    };
  };

  const bindingIndex = useMemo(() => {
    const next = new Map<string, ShortcutActionId[]>();
    for (const [actionId, binding] of Object.entries(bindings.bindings) as Array<[ShortcutActionId, KeyboardShortcutSettings["bindings"][ShortcutActionId]]>) {
      const signature = shortcutBindingSignature(binding);
      if (!signature) continue;
      const list = next.get(signature) || [];
      list.push(actionId);
      next.set(signature, list);
    }
    return next;
  }, [bindings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const binding = eventToShortcutBinding(event);
      if (!binding) return;
      const matchedActionIds = bindingIndex.get(shortcutBindingSignature(binding));
      if (!matchedActionIds?.length) return;

      const editable = isEditableTarget(event.target);
      const activeLayers = gettersRef.current
        .map((entry) => ({ order: entry.order, layer: entry.getter() }))
        .reduce<Array<{ order: number; layer: ShortcutLayer }>>((acc, entry) => {
          if (!entry.layer || entry.layer.enabled === false) return acc;
          acc.push({ order: entry.order, layer: entry.layer });
          return acc;
        }, [])
        .sort((left, right) => right.layer.priority - left.layer.priority || right.order - left.order);

      for (const entry of activeLayers) {
        if (editable && !entry.layer.allowInEditable) continue;
        for (const actionId of matchedActionIds) {
          const handler = entry.layer.handlers[actionId];
          if (!handler) continue;
          const result = handler(event);
          if (result === false) continue;
          event.preventDefault();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bindingIndex]);

  const value = useMemo<ShortcutRouterContextValue>(
    () => ({
      bindings,
      setBindings,
      registerLayer,
    }),
    [bindings]
  );

  return <ShortcutRouterContext.Provider value={value}>{children}</ShortcutRouterContext.Provider>;
}

export function useShortcutRouter(): ShortcutRouterContextValue {
  const context = useContext(ShortcutRouterContext);
  if (!context) {
    throw new Error("useShortcutRouter must be used inside ShortcutRouterProvider");
  }
  return context;
}

export function useShortcutLayer(layer: ShortcutLayer | null): void {
  const router = useShortcutRouter();
  const layerRef = useRef<ShortcutLayer | null>(layer);
  layerRef.current = layer;

  useEffect(() => {
    return router.registerLayer(() => layerRef.current);
  }, [router]);
}
