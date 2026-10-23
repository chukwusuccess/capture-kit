declare const chrome: {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: unknown,
          sendResponse: (response?: unknown) => void
        ) => boolean | void
      ): void;
    };
  };
  tabs: {
    query(queryInfo: {
      active: boolean;
      currentWindow: boolean;
    }): Promise<Array<{ id?: number; windowId?: number; width?: number; url?: string }>>;
    get(tabId: number): Promise<{ id?: number; windowId?: number; url?: string; width?: number }>;
    update(tabId: number, props: { url?: string; active?: boolean }): Promise<unknown>;
    setZoom(tabId: number, zoomFactor: number): Promise<void>;
    setZoomSettings(tabId: number, settings: { scope?: 'per-origin' | 'per-tab'; mode?: 'automatic' }): Promise<void>;
    create(createProperties: { url: string; active?: boolean }): Promise<{ id?: number }>;
    remove(tabId: number): Promise<void>;
    onUpdated: {
      addListener(
        callback: (tabId: number, changeInfo: { status?: string }) => void
      ): void;
      removeListener(
        callback: (tabId: number, changeInfo: { status?: string }) => void
      ): void;
    };
  };
  windows: {
    create(options: {
      url?: string;
      focused?: boolean;
      type?: 'normal' | 'popup';
      width?: number;
      height?: number;
    }): Promise<{ id?: number; tabs?: Array<{ id?: number }> }>;
    remove(windowId: number): Promise<void>;
    get(windowId: number): Promise<{
      id?: number;
      width?: number;
      height?: number;
      state?: 'normal' | 'minimized' | 'maximized' | 'fullscreen' | 'anchored';
    }>;
    update(
      windowId: number,
      update: {
        width?: number;
        height?: number;
        state?: 'normal' | 'minimized' | 'maximized' | 'fullscreen' | 'anchored';
      }
    ): Promise<unknown>;
  };
  scripting: {
    executeScript<T = unknown>(injection: {
      target: { tabId: number };
      files?: string[];
      args?: unknown[];
      func?: (...args: unknown[]) => T | Promise<T>;
    }): Promise<Array<{ result: T }>>;
  };
  downloads: {
    download(options: {
      url: string;
      filename: string;
      saveAs?: boolean;
    }): Promise<number>;
  };
  storage: {
    local: {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
};
