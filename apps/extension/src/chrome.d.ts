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
    get(tabId: number): Promise<{ id?: number; windowId?: number; url?: string }>;
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
