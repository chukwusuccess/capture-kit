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
    query(queryInfo: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number }>>;
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
