export function screenshotHeaders(): Headers {
  return new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
}

export function screenshotResponse(body: object, status: number): Response {
  return Response.json(body, { status, headers: screenshotHeaders() });
}
