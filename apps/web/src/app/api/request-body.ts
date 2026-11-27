export async function readBoundedBody(request: Request, limit: number): Promise<Buffer | null> {
  if (Number(request.headers.get("content-length")) > limit) return null;
  if (!request.body) return Buffer.alloc(0);

  const payload = Buffer.alloc(limit);
  const reader = request.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return payload.subarray(0, size);
      if (value.byteLength > limit - size) {
        void reader.cancel().catch(() => {});
        return null;
      }
      payload.set(value, size);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
}
