// dsh-token-pill — host half.
//
// Purely local and reactive: tokenUsage and sessionStats projections are already
// pushed down to the client via DSH's native reactive projection channel.
// No host endpoints or background pollers required.

export const name = 'dsh-token-pill'

export function apply(ctx) {
  // Client-only plugin. Host half is a no-op marker.
}
