/**
 * 错误处理工具函数
 */

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public isOperational: boolean = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}

export function handleServiceError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  
  const message = error instanceof Error ? error.message : '未知错误';
  return new AppError(message, 500);
}
