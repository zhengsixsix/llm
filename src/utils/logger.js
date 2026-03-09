/**
 * 日志工具
 */
class Logger {
  info(message, ...args) {
    console.log(`[INFO] ${message}`, ...args);
  }

  error(message, ...args) {
    console.error(`[ERROR] ${message}`, ...args);
  }

  success(message, ...args) {
    console.log(`[SUCCESS] ✓ ${message}`, ...args);
  }
}

module.exports = new Logger();
