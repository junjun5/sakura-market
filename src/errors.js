// Errors that the HTTP layer turns into a JSON response: { error: { code, message } }.
export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (code, message) => new AppError(400, code, message);
export const unauthorized = (message = 'Send an X-User-Id header for a known user.') =>
  new AppError(401, 'unauthorized', message);
export const notFound = (code, message) => new AppError(404, code, message);
export const conflict = (code, message) => new AppError(409, code, message);
