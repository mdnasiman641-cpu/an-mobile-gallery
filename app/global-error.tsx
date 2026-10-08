"use client";

// Last-resort error screen (when even the root layout fails).
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "64px 16px", textAlign: "center", color: "#17212b" }}>
        <h1 style={{ fontSize: 24 }}>Something went wrong</h1>
        <p style={{ color: "#4a5866" }}>Please try again in a moment.</p>
        <button
          onClick={reset}
          style={{ marginTop: 16, padding: "10px 18px", borderRadius: 10, border: 0, background: "#0e7c66", color: "#fff", fontWeight: 600 }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
