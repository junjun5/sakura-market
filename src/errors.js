// Errors that the HTTP layer turns into a JSON response: { error: { code, message } }.
export class AppError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} code snake_case error code
   * @param {string} message
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

/** @param {string} code @param {string} message */
export const badRequest = (code, message) => new AppError(400, code, message);
export const unauthorized = (message = 'Send an X-User-Id header for a known user.') =>
  new AppError(401, 'unauthorized', message);
/** @param {string} code @param {string} message */
export const forbidden = (code, message) => new AppError(403, code, message);
/** @param {string} code @param {string} message */
export const notFound = (code, message) => new AppError(404, code, message);
/** @param {string} code @param {string} message */
export const conflict = (code, message) => new AppError(409, code, message);
