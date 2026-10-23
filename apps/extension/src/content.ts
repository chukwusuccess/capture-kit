import { serializeDocument } from '@capture-kit/serializer';

interface WindowWithCaptureKit {
  __captureKitSerialize?: () => Promise<unknown>;
}

const customWindow = window as unknown as WindowWithCaptureKit;

customWindow.__captureKitSerialize = async (): Promise<unknown> => {
  return await serializeDocument(document);
};
