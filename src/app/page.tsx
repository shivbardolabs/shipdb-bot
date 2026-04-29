export default function Home() {
  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 600,
        margin: "80px auto",
        padding: "0 20px",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "2rem", marginBottom: 8 }}>📦 ShipDB Bot</h1>
      <p style={{ color: "#666", fontSize: "1.1rem" }}>
        Slack bot for querying the ShipOS Pro database.
      </p>
      <p style={{ color: "#999", fontSize: "0.9rem", marginTop: 32 }}>
        Use <code>/shipdb help</code> in Slack to get started.
      </p>
    </div>
  );
}
