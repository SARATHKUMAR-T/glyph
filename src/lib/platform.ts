/** True inside the macOS app, where the window uses native traffic lights. */
export const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
