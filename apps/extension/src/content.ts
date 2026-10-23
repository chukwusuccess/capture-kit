import {
  serializeDocument,
  serializeElement,
  startElementPicker,
} from '@capture-kit/serializer';

interface WindowWithCaptureKit {
  __captureKitSerialize?: () => Promise<unknown>;
  __captureKitPickElement?: () => Promise<unknown>;
}

const customWindow = window as unknown as WindowWithCaptureKit;

customWindow.__captureKitSerialize = async (): Promise<unknown> => {
  return await serializeDocument(document);
};

customWindow.__captureKitPickElement = async (): Promise<unknown> => {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();

  startElementPicker(document, {
    onSelect: async (el: Element) => {
      try {
        const capture = await serializeElement(el);
        resolve(capture);
      } catch (err: unknown) {
        reject(err);
      }
    },
    onCancel: () => {
      reject(new Error('Element selection cancelled'));
    },
  });

  return promise;
};
