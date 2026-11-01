export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  constructor(
    message: string,
    status = 0,
    code = "NETWORK_ERROR",
    requestId?: string,
  ) {
    super(message + (requestId ? ` (Request ID: ${requestId})` : ""));
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}
const messages: Record<number, string> = {
  401: "Session expired. Enter your token again.",
  403: "Permission denied. Your current access does not allow this action.",
  404: "Workspace or resource unavailable. It may be missing or no longer accessible.",
  422: "Invalid request. Check the objective, sources and entity identifier.",
  500: "An internal server error occurred. The investigation was not automatically retried.",
  503: "The model gateway or database is unavailable. Check the backend configuration.",
  504: "Backend processing timed out. The backend may still be running; do not resubmit automatically.",
};
export async function responseError(response: Response): Promise<ApiError> {
  let requestId = response.headers.get("x-request-id") ?? undefined;
  let code = `HTTP_${response.status}`;
  let message =
    messages[response.status] ??
    `Request unavailable (HTTP ${response.status}).`;
  try {
    const data: unknown = await response.json();
    if (
      data &&
      typeof data === "object" &&
      "error" in data &&
      data.error &&
      typeof data.error === "object"
    ) {
      const error = data.error as Record<string, unknown>;
      if (
        typeof error.request_id === "string" &&
        /^[a-zA-Z0-9_.:-]{1,160}$/.test(error.request_id)
      )
        requestId = error.request_id;
      if (
        typeof error.code === "string" &&
        /^[A-Z_0-9]{1,80}$/.test(error.code)
      )
        code = error.code;
      // The server's public envelope is safe to present; never render raw HTML or exception bodies.
      if (
        typeof error.message === "string" &&
        error.message.length <= 500 &&
        !/traceback|stack trace|api[_ -]?key|bearer\s/i.test(error.message)
      )
        message += ` ${error.message}`;
    }
  } catch {
    /* Non-JSON proxy errors use the safe status message. */
  }
  return new ApiError(message, response.status, code, requestId);
}
