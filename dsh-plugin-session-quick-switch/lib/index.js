/**
 * Host half of `dsh-plugin-session-quick-switch`.
 *
 * The plugin is a browser-side surface: the palette, its keyboard command and
 * its data (the Host session list plus live running state) all live in the Web
 * GUI, reaching the Host only through the remote namespaces the client already
 * exposes. This file therefore owns nothing — no storage, no RPC, no UI.
 *
 * Its only job is to be a mounted package: the Host Loader knows the package,
 * and the `dsh.client` declaration in package.json is what makes
 * `lib/client.js` reach the browser.
 *
 * @module dsh-plugin-session-quick-switch
 */

/** Host plugin body: nothing to register in the Host process. */
export function apply() {}
