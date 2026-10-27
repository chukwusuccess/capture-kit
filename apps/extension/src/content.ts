import {
  serializeDocument,
  serializeElement,
  startElementPicker,
} from '@capture-kit/serializer';

interface WindowWithCaptureKit {
  __captureKitSerialize?: (opts?: { scrollStitch?: boolean }) => Promise<unknown>;
  __captureKitPickElement?: () => Promise<unknown>;
  __captureKitCancelPick?: () => void;
}

const customWindow = window as unknown as WindowWithCaptureKit;
let cancelPick: (() => void) | undefined;
customWindow.__captureKitCancelPick = () => cancelPick?.();

customWindow.__captureKitSerialize = async (opts?: { scrollStitch?: boolean }): Promise<unknown> => {
  return await serializeDocument(document, opts);
};

customWindow.__captureKitPickElement = async (): Promise<unknown> => {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  let cleanup: (() => void) | undefined;
  const cancel = (): void => {
    cleanup?.();
    if (cancelPick === cancel) cancelPick = undefined;
    reject(new Error('Element selection cancelled'));
  };

  cleanup = startElementPicker(document, {
    onSelect: async (el: Element) => {
      if (cancelPick === cancel) cancelPick = undefined;
      try {
        resolve(await serializeElement(el));
      } catch (err: unknown) {
        reject(err);
      }
    },
    onCancel: () => {
      if (cancelPick === cancel) cancelPick = undefined;
      reject(new Error('Element selection cancelled'));
    },
  });
  cancelPick = cancel;
  return promise;
};

