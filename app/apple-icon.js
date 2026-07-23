import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#08245B",
          color: "white",
          borderRadius: 38,
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ fontSize: 52, fontWeight: 900, letterSpacing: 5, lineHeight: 1 }}>ARK</div>
        <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, letterSpacing: 2, color: "#DCE6F7" }}>CLIENT CENTER</div>
      </div>
    ),
    size,
  );
}
