/*
 * Compatibility shims for building Glyph against Ubuntu 20.04's libraries.
 *
 * The Rust bindings the Tauri stack uses are generated against newer GLib,
 * libsoup and WebKitGTK than focal ships, and reference a handful of symbols
 * that focal's libraries do not export. Every one of them sits on a code path
 * Glyph never takes, but the linker still has to resolve them.
 *
 * This is built as a static archive and appended to the link line, so a symbol
 * is only pulled in when it is genuinely missing.
 */
#include <glib.h>
#include <gio/gio.h>

/*
 * GLib 2.66 (focal has 2.64). The GUri error domain. glib-rs references it via
 * glib::UriError, which wry uses to build custom-protocol errors. Returning the
 * canonical quark name makes this behave exactly as GLib would.
 */
GQuark g_uri_error_quark(void) {
  return g_quark_from_static_string("g-uri-error-quark");
}

/*
 * libsoup 3. SoupMessageHeaders is reference counted in libsoup3 but only
 * heap-owned in libsoup 2.4, which offers _free() and no ref counting.
 *
 * wry creates exactly one MessageHeaders per response and hands ownership
 * straight to webkit_uri_scheme_response_set_http_headers() (transfer full), so
 * the object is never shared and single-owner semantics are correct: "ref" is
 * identity, "unref" frees. A caller that actually cloned the headers would need
 * real reference counting, which libsoup 2.4 cannot provide.
 */
extern void soup_message_headers_free(gpointer hdrs);

gpointer soup_message_headers_ref(gpointer hdrs) {
  return hdrs;
}

void soup_message_headers_unref(gpointer hdrs) {
  soup_message_headers_free(hdrs);
}

/*
 * WebKitGTK 2.40 (focal has 2.38.6). Used only by wry's WebView::cookies(),
 * which Glyph never calls. Fail cleanly through the normal GAsyncResult
 * machinery rather than crash, so the limitation surfaces as an error.
 */
void webkit_cookie_manager_get_all_cookies(gpointer manager,
                                           GCancellable *cancellable,
                                           GAsyncReadyCallback callback,
                                           gpointer user_data) {
  (void) cancellable;
  g_task_report_new_error(manager, callback, user_data,
                          (gpointer) webkit_cookie_manager_get_all_cookies,
                          G_IO_ERROR, G_IO_ERROR_NOT_SUPPORTED,
                          "webkit_cookie_manager_get_all_cookies() requires "
                          "WebKitGTK 2.40 or newer");
}

GList *webkit_cookie_manager_get_all_cookies_finish(gpointer manager,
                                                    GAsyncResult *result,
                                                    GError **error) {
  (void) manager;
  return g_task_propagate_pointer(G_TASK(result), error);
}
