export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'bad_request', message, details);

export const unauthorized = (message = 'Требуется вход') =>
  new HttpError(401, 'unauthorized', message);

export const forbidden = (message = 'Недостаточно прав') =>
  new HttpError(403, 'forbidden', message);

export const notFound = (message = 'Не найдено') => new HttpError(404, 'not_found', message);

export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, 'conflict', message, details);
