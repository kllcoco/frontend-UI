/* Small runtime shims for older Android System WebViews (Chrome < 92) that the build target allows. */
function at<T>(this: ArrayLike<T>, index: number): T | undefined {
  const n = Math.trunc(index) || 0;
  const i = n < 0 ? this.length + n : n;
  return i >= 0 && i < this.length ? this[i] : undefined;
}
for (const proto of [Array.prototype, String.prototype, Object.getPrototypeOf(Int8Array.prototype)] as { at?: unknown }[]) {
  if (typeof proto.at !== "function") Object.defineProperty(proto, "at", { value: at, writable: true, configurable: true });
}
if (typeof (Object as { hasOwn?: unknown }).hasOwn !== "function") {
  Object.defineProperty(Object, "hasOwn", { value: (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k), configurable: true, writable: true });
}
export {};
